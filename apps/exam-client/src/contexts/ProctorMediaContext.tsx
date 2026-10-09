import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { Device } from "mediasoup-client";
import type { Transport } from "mediasoup-client/types";
import { MEDIA, simulcastEncodings, applyProducerDegradation, logProducerLayerStats, logCaptureSettings, type ProducedSender } from "@/lib/media-config";
import { getSfuBase, type SfuProducerInfo } from "@/lib/sfu";
import {
  recordingStorageKey,
  startSfuRecording,
  stopSfuRecording,
} from "@/lib/sfu-recording";
import { isScreenShareSupported } from "@/lib/device";

type Status = "idle" | "requesting" | "granted" | "denied" | "unsupported";

const SFU_BASE = getSfuBase();

function logPub(tag: string, msg: string, fields?: Record<string, unknown>) {
  console.info(`[SAT:${tag}] ${msg}`, fields ?? "");
}

interface Value {
  cameraStatus: Status;
  screenStatus: Status;
  /** False on phones/tablets where getDisplayMedia doesn't exist. */
  screenShareSupported: boolean;
  cameraError: string | null;
  screenError: string | null;
  cameraStream: MediaStream | null;
  screenStream: MediaStream | null;
  requestCameraMic: () => Promise<void>;
  requestScreen: () => Promise<void>;
  requestAll: () => Promise<void>;
  stopAll: () => void;
  publishToSFU: (examId: string | number, sessionId: string | number) => Promise<void>;
  unpublishFromSFU: () => void;
  sfuConnected: boolean;
  proctorAudioStream: MediaStream | null;
  proctorMuted: boolean;
  /** True when the proctor stream exists but the <audio> element is paused by
      the browser (mobile autoplay policy). UI should offer a tap-to-enable. */
  audioBlocked: boolean;
  /** Call from a user-gesture handler to (re)start proctor audio. */
  unlockProctorAudio: () => void;
  /** Fire-and-forget realtime flag alert to watching proctors (SFU room
      broadcast). The HTTP report stays the persistence path. */
  emitExamFlag: (flagTitle: string) => void;
  /** Start server-side exam recording (camera+mic, screen) right after
      publishToSFU. Non-blocking for the exam — warns on failure. */
  startExamRecording: (examId: string | number, sessionId: string | number) => Promise<string | null>;
  /** Finalize the exam recording (exam submit / time-up). Queues S3 + DB. */
  stopExamRecording: (sessionId?: string | number) => Promise<void>;
  examRecording: boolean;
}

/** One-shot request over the event-based signalling (no ACKs server-side). */
function emitOnce<T>(
  socket: Socket,
  emitEvent: string,
  payload: unknown,
  okEvents: string[],
  timeoutMs = 10000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${emitEvent} timed out waiting for ${okEvents.join("/")}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("error", onError);
      for (const e of okEvents) socket.off(e, onOk);
    };
    const onOk = (data: T) => {
      cleanup();
      resolve(data);
    };
    const onError = (err: { event?: string; message?: string }) => {
      if (err?.event === emitEvent) {
        cleanup();
        reject(new Error(err?.message || `${emitEvent} failed`));
      }
    };
    for (const e of okEvents) socket.once(e, onOk);
    socket.on("error", onError);
    socket.emit(emitEvent, payload);
  });
}

const Ctx = createContext<Value | null>(null);
export function useProctorMedia(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProctorMedia must be inside ProctorMediaProvider");
  return v;
}

export function ProctorMediaProvider({ children }: { children: ReactNode }) {
  const [screenShareSupported] = useState(() => isScreenShareSupported());
  const [cameraStatus, setCameraStatus] = useState<Status>("idle");
  const [screenStatus, setScreenStatus] = useState<Status>(() =>
    isScreenShareSupported() ? "idle" : "unsupported",
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [sfuConnected, setSfuConnected] = useState(false);
  const [proctorAudioStream, setProctorAudioStream] = useState<MediaStream | null>(null);
  const [proctorMuted, setProctorMuted] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [examRecording, setExamRecording] = useState(false);

  const camRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const sendTransportRef = useRef<Transport[]>([]);
  const recvTransportRef = useRef<Transport | null>(null);
  const peerIdRef = useRef<string>("");
  const examIdRef = useRef<string>("");
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const proctorPlaySeq = useRef(0);
  // Serialises transport.consume() calls (see consumeProctorMic).
  const consumeQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Tracks the currently-consumed proctor mic so pause/resume/close
  // broadcasts can toggle the "Proctor speaking" banner accurately.
  const proctorProducerIdRef = useRef<string | null>(null);
  const proctorConsumerRef = useRef<{ id: string; close: () => void } | null>(null);
  // Exam recording (server-side ffmpeg tap of our published RTP — the portal
  // only triggers start/stop; no MediaRecorder runs in the browser). Lives in
  // this provider so start/stop survive verify -> take navigation.
  const examRecordingIdRef = useRef<string | null>(null);
  const examSessionRef = useRef<string>("");

  useEffect(() => {
    camRef.current = cameraStream;
  }, [cameraStream]);
  useEffect(() => {
    screenRef.current = screenStream;
  }, [screenStream]);

  // Serializes proctor-audio play() across rapid mute/unmute signals. Mobile
  // browsers (Android Chrome, iOS Safari) pause <audio> without a user gesture
  // (NotAllowedError) — so besides the immediate attempt we retry on every
  // interaction while the stream is live, and surface `audioBlocked` for UI.
  useEffect(() => {
    const el = audioElRef.current;
    if (!el) return;
    if (proctorAudioStream && proctorAudioStream.getAudioTracks().length > 0) {
      el.srcObject = proctorAudioStream;
      el.muted = false;
      el.volume = 1;
      const seq = ++proctorPlaySeq.current;
      let cancelled = false;
      const attempt = () => {
        if (cancelled || seq !== proctorPlaySeq.current) return;
        const p = el.play();
        if (!p) {
          if (!el.paused) setAudioBlocked(false);
          return;
        }
        p.then(() => {
          if (!cancelled && seq === proctorPlaySeq.current) setAudioBlocked(false);
        }).catch(() => {
          if (!cancelled && seq === proctorPlaySeq.current) setAudioBlocked(el.paused);
        });
      };
      attempt();
      const onInteract = () => {
        if (el.paused) attempt();
        else setAudioBlocked(false);
      };
      document.addEventListener("pointerdown", onInteract);
      document.addEventListener("touchend", onInteract);
      document.addEventListener("keydown", onInteract);
      return () => {
        cancelled = true;
        document.removeEventListener("pointerdown", onInteract);
        document.removeEventListener("touchend", onInteract);
        document.removeEventListener("keydown", onInteract);
      };
    } else {
      proctorPlaySeq.current++;
      el.srcObject = null;
      el.pause();
      setAudioBlocked(false);
    }
  }, [proctorAudioStream]);

  const unlockProctorAudio = useCallback(() => {
    const el = audioElRef.current;
    if (!el) return;
    if (el.srcObject && el.paused) {
      el.play()
        ?.then(() => setAudioBlocked(false))
        .catch(() => setAudioBlocked(true));
    } else if (!el.paused) {
      setAudioBlocked(false);
    }
  }, []);

  const emitExamFlag = useCallback((flagTitle: string) => {
    const socket = socketRef.current;
    if (!flagTitle) return;
    if (!socket || !socket.connected) {
      logPub("FLAG", `not emitted (sfu ${socket ? "disconnected" : "missing"}): ${flagTitle}`);
      return;
    }
    try {
      socket.emit("flag:raise", { flagTitle });
      logPub("FLAG", `emitted flag:raise: ${flagTitle}`);
    } catch {
      /* non-fatal: the HTTP report is the persistence path */
    }
  }, []);

  const stopExamRecording = useCallback(
    async (sessionId?: string | number) => {
      const sid = sessionId ?? examSessionRef.current;
      let id = examRecordingIdRef.current;
      if (!id && sid) {
        try {
          id = sessionStorage.getItem(recordingStorageKey(sid));
        } catch {
          /* non-fatal */
        }
      }
      examRecordingIdRef.current = null;
      setExamRecording(false);
      if (sid) {
        try {
          sessionStorage.removeItem(recordingStorageKey(sid));
        } catch {
          /* non-fatal */
        }
      }
      if (!id) return;
      // Best effort over the live socket first (instant), then REST which
      // guarantees finalize + S3/DB queue even if the socket is gone.
      const socket = socketRef.current;
      if (socket && socket.connected) {
        try {
          await emitOnce(socket, "stopRecording", { recordingId: id }, ["recordingStopped"], 5000);
          logPub("REC", `recording stopped exam=${examIdRef.current} session=${examSessionRef.current} id=${id} (socket)`);
          return;
        } catch {
          /* fall through to REST */
        }
      }
      try {
        await stopSfuRecording(id);
        logPub("REC", `recording stopped exam=${examIdRef.current} session=${examSessionRef.current} id=${id}`);
      } catch (e) {
        logPub("REC", `stop failed (local files kept on SFU): ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [],
  );

  const startExamRecording = useCallback(
    async (examId: string | number, sessionId: string | number): Promise<string | null> => {
      const cam = camRef.current;
      const screen = screenRef.current;
      const kinds: ("camera" | "screen")[] = [];
      if (cam && cam.getTracks().some((t) => t.readyState === "live")) kinds.push("camera");
      if (screen && screen.getVideoTracks().some((t) => t.readyState === "live")) kinds.push("screen");
      if (kinds.length === 0) {
        logPub("REC", "no live tracks — skipping recording");
        return null;
      }
      // Server-side tap: the SFU consumes our published RTP into ffmpeg.
      // Prefer the live socket (waits for producers server-side); fall back
      // to REST when the socket is unavailable.
      let recordingId: string | null = null;
      const socket = socketRef.current;
      if (socket && socket.connected) {
        try {
          const res = await emitOnce<{ recordingId: string }>(
            socket,
            "startRecording",
            { examId: String(examId), sessionId: String(sessionId) },
            ["recordingStarted"],
            15000,
          );
          recordingId = res.recordingId;
        } catch (e) {
          logPub("REC", `socket start failed, trying REST: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (!recordingId) {
        const res = await startSfuRecording(examId, sessionId, { kinds });
        recordingId = res.recordingId;
      }
      examRecordingIdRef.current = recordingId;
      examSessionRef.current = String(sessionId);
      try {
        sessionStorage.setItem(recordingStorageKey(sessionId), recordingId);
      } catch {
        /* non-fatal */
      }
      setExamRecording(true);
      logPub("REC", `recording exam=${examId} session=${sessionId} id=${recordingId} kinds=${kinds.join("+")}`);
      return recordingId;
    },
    [],
  );

  const teardownConnection = useCallback(() => {
    const socket = socketRef.current;
    if (socket) {
      try {
        socket.emit("leave", {});
      } catch {
        /* non-fatal */
      }
      socket.disconnect();
      socketRef.current = null;
    }
    for (const t of sendTransportRef.current) {
      try {
        t.close();
      } catch {
        /* non-fatal */
      }
    }
    try {
      recvTransportRef.current?.close();
    } catch {
      /* non-fatal */
    }
    sendTransportRef.current = [];
    recvTransportRef.current = null;
    deviceRef.current = null;
    setSfuConnected(false);
  }, []);

  const stopAll = useCallback(() => {
    teardownConnection();
    camRef.current?.getTracks().forEach((t) => t.stop());
    screenRef.current?.getTracks().forEach((t) => t.stop());
    camRef.current = null;
    screenRef.current = null;
    setCameraStream(null);
    setScreenStream(null);
    proctorProducerIdRef.current = null;
    proctorConsumerRef.current = null;
    setProctorAudioStream(null);
    setProctorMuted(true);
    if (audioElRef.current) audioElRef.current.srcObject = null;
    setCameraStatus((p) => (p === "granted" ? "idle" : p));
    setScreenStatus((p) => (p === "granted" ? "idle" : p));
  }, [teardownConnection]);

  // Now wired: drops the SFU connection but keeps local preview tracks alive
  // (previously a dead stub that still referenced the removed plain-WS).
  const unpublishFromSFU = useCallback(() => {
    teardownConnection();
    proctorProducerIdRef.current = null;
    proctorConsumerRef.current = null;
    setProctorAudioStream(null);
    setProctorMuted(true);
  }, [teardownConnection]);

  const requestCameraMic = useCallback(async () => {
    setCameraStatus("requesting");
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: MEDIA.camWidth }, height: { ideal: MEDIA.camHeight }, frameRate: { ideal: MEDIA.camFps } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      camRef.current = stream;
      setCameraStream(stream);
      setCameraStatus("granted");
      logPub("CAM", `granted ${stream.getVideoTracks()[0]?.getSettings().width}x${stream.getVideoTracks()[0]?.getSettings().height}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Camera/mic denied";
      setCameraError(message);
      setCameraStatus("denied");
      throw e;
    }
  }, []);

  const requestScreen = useCallback(async () => {
    // getDisplayMedia doesn't exist on phones/tablets — mark unsupported
    // (no throw) so requestAll/verification treat it as "not required".
    if (!isScreenShareSupported()) {
      setScreenStatus("unsupported");
      setScreenError("Screen sharing is not supported on this device or browser. Camera-only monitoring will be used.");
      return;
    }
    setScreenStatus("requesting");
    setScreenError(null);
    try {
      // No web API can remove the Window/Tab tabs from the browser picker,
      // so: (1) hint displaySurface "monitor" to preselect Entire Screen, and
      // (2) enforce it after grant — anything else is rejected with retry.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: MEDIA.screenWidth },
          height: { ideal: MEDIA.screenHeight },
          frameRate: { ideal: MEDIA.screenFps },
          displaySurface: "monitor",
        },
        audio: true,
      });
      const track = stream.getVideoTracks()[0];
      const surface = track?.getSettings()?.displaySurface;
      if (surface && surface !== "monitor") {
        stream.getTracks().forEach((t) => t.stop());
        // Name the wrong choice back to the candidate: "browser" = tab.
        const picked = surface === "browser" ? "browser tab" : surface === "window" ? "window" : "application";
        const message = `Wrong option selected — you shared a ${picked}. Please click Try Again and choose Entire Screen.`;
        setScreenError(message);
        setScreenStatus("denied");
        logPub("SCR", `rejected surface=${surface}, need monitor`);
        throw new Error(message);
      }
      screenRef.current = stream;
      setScreenStream(stream);
      setScreenStatus("granted");
      logPub("SCR", `screen granted surface=${surface ?? "unknown"}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Screen share denied";
      // Preserve the entire-screen message set above instead of overwriting.
      setScreenError((prev) => prev ?? message);
      setScreenStatus("denied");
      throw e;
    }
  }, []);

  const requestAll = useCallback(async () => {
    await requestCameraMic();
    // Screen share is desktop-only; on mobile this no-ops to "unsupported".
    await requestScreen();
  }, [requestCameraMic, requestScreen]);

  const consumeProctorMic = useCallback(
    async (socket: Socket, info: SfuProducerInfo) => {
      // Serialise with any in-flight consume: overlapping transport.consume()
      // calls on the shared recv PC fail with "Duplicate a=msid lines detected".
      const prev = consumeQueueRef.current;
      let release!: () => void;
      consumeQueueRef.current = new Promise<void>((r) => {
        release = r;
      });
      await prev;
      try {
        const device = deviceRef.current;
        if (!device) return;
        let recv = recvTransportRef.current;
        if (!recv || recv.closed) {
          const created = await emitOnce<{
            id: string;
            iceParameters: unknown;
            iceCandidates: unknown;
            dtlsParameters: unknown;
          }>(socket, "createTransport", { examId: examIdRef.current, peerId: peerIdRef.current, direction: "recv" }, ["createdTransport"]);
          recv = device.createRecvTransport({
            id: created.id,
            iceParameters: created.iceParameters as never,
            iceCandidates: created.iceCandidates as never,
            dtlsParameters: created.dtlsParameters as never,
          });
          recv.on("connect", ({ dtlsParameters }: { dtlsParameters: unknown }, callback: () => void, errback: (e: Error) => void) => {
            emitOnce(socket, "connectTransport", { transportId: recv!.id, dtlsParameters }, ["transportConnected"])
              .then(() => callback())
              .catch((e: unknown) => errback(e instanceof Error ? e : new Error(String(e))));
          });
          recvTransportRef.current = recv;
        }
        const consumed = await emitOnce<{
          consumerId: string;
          kind: "audio" | "video";
          rtpParameters: unknown;
        }>(
          socket,
          "consume",
          { examId: examIdRef.current, peerId: peerIdRef.current, consumerTransportId: recv.id, producerId: info.producerId },
          ["consumed"],
        );
        const consumer = await recv.consume({
          id: consumed.consumerId,
          producerId: info.producerId,
          kind: consumed.kind,
          rtpParameters: consumed.rtpParameters as never,
        }).catch((e: unknown) => {
          // SDP apply failed but the server-side consumer exists — close it.
          if (socket.connected) socket.emit("closeConsumer", { consumerId: consumed.consumerId });
          throw e;
        });
        await emitOnce(socket, "resume", { consumerId: consumer.id }, ["resumed"]).catch(() => {});
        const stream = new MediaStream([consumer.track]);
        proctorProducerIdRef.current = info.producerId;
        proctorConsumerRef.current = consumer;
        setProctorAudioStream(stream);
        setProctorMuted(false);
        logPub("MIC", `proctor speaking peer=${info.peerId}`);
        // Server-side pause stops RTP: the local track stays live+enabled,
        // so also hide the banner when the track goes mute as a fallback
        // in case a pause broadcast is missed.
        try {
          consumer.track.addEventListener("mute", () => {
            if (proctorProducerIdRef.current === info.producerId) setProctorMuted(true);
          });
          consumer.track.addEventListener("unmute", () => {
            if (proctorProducerIdRef.current === info.producerId) setProctorMuted(false);
          });
        } catch {
          /* non-fatal — MediaStreamTrack events optional */
        }
        consumer.on("transportclose", () => {
          if (proctorProducerIdRef.current === info.producerId) {
            proctorProducerIdRef.current = null;
            proctorConsumerRef.current = null;
            setProctorAudioStream(null);
            setProctorMuted(true);
          }
        });
      } catch (e) {
        logPub("MIC", "consume proctor mic failed", { error: e instanceof Error ? e.message : String(e) });
      } finally {
        release();
      }
    },
    [],
  );

  const publishToSFU = useCallback(
    async (examId: string | number, sessionId: string | number) => {
      const exam = String(examId);
      // SFU peer id MUST equal the exam-server session id: admin panels key
      // tiles, toasts and subscriptions by String(session.id).
      const peerId = String(sessionId);
      examIdRef.current = exam;
      peerIdRef.current = peerId;
      // Session header: one block that characterizes the whole attempt, using
      // the same keys the SFU logs (exam + peer/session) so both logs join.
      logPub("SES", `open exam=${exam} session=${peerId} ua=${navigator.userAgent.split(" ").slice(-2).join(" ")}`);
      // Some embedded webviews (e.g. Linux WebKitGTK builds without WebRTC)
      // have no RTCPeerConnection at all — fail here with a clear message
      // instead of a cryptic ReferenceError deep in mediasoup-client.
      if (typeof RTCPeerConnection === "undefined") {
        throw new Error("Live media needs WebRTC, which this browser/app build lacks — use Chrome or the Windows desktop client");
      }
      const token = localStorage.getItem("token") || "";
      const cam = camRef.current;
      const screen = screenRef.current;
      if (!cam && !screen) throw new Error("Grant camera and screen before publishing");

      teardownConnection();
      const socket: Socket = io(SFU_BASE, {
        path: "/signaling",
        transports: ["websocket"],
        auth: token ? { token } : undefined,
        query: token ? { token } : undefined,
      });
      socketRef.current = socket;

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("SFU join timed out")), 15000);
        socket.once("joined", (data: { rtpCapabilities: unknown }) => {
          clearTimeout(timer);
          void (async () => {
            try {
              const device = new Device();
              await device.load({ routerRtpCapabilities: data.rtpCapabilities as never });
              deviceRef.current = device;
              resolve();
            } catch (e) {
              reject(e instanceof Error ? e : new Error(String(e)));
            }
          })();
        });
        socket.once("error", (err: { message?: string }) => {
          clearTimeout(timer);
          reject(new Error(err?.message || "SFU join failed"));
        });
        socket.on("connect", () => {
          socket.emit("join", { examId: exam, peerId, role: "candidate", displayName: `Candidate ${sessionId}`, token: token || undefined });
        });
      });

      const device = deviceRef.current;
      if (!device) throw new Error("mediasoup device not ready");

      // One send transport per video source. Chrome splits a transport's BWE
      // across its senders, so camera+screen on one transport halves each
      // video's budget and the high-res BASE simulcast layer never reaches full
      // encoding (seen: r0 bytes far below r1 for a full exam at bwe~1Mbps).
      // Separate transports give each video its own estimator, so both
      // high-res base layers fit. Mic rides with the camera transport.
      const createSendTransport = async (label: "cam" | "screen"): Promise<Transport> => {
        const created = await emitOnce<{
          id: string;
          iceParameters: unknown;
          iceCandidates: unknown;
          dtlsParameters: unknown;
        }>(socket, "createTransport", { examId: exam, peerId, direction: "send" }, ["createdTransport"]);
        const transport = device.createSendTransport({
          id: created.id,
          iceParameters: created.iceParameters as never,
          iceCandidates: created.iceCandidates as never,
          dtlsParameters: created.dtlsParameters as never,
        });
        transport.on("connect", ({ dtlsParameters }: { dtlsParameters: unknown }, callback: () => void, errback: (e: Error) => void) => {
          emitOnce(socket, "connectTransport", { transportId: transport.id, dtlsParameters }, ["transportConnected"])
            .then(() => callback())
            .catch((e: unknown) => errback(e instanceof Error ? e : new Error(String(e))));
        });
        transport.on("produce", ({ kind, rtpParameters }: { kind: string; rtpParameters: unknown }, callback: (r: { id: string }) => void, errback: (e: Error) => void) => {
          const pending = (transport as unknown as { __pendingSource?: SfuProducerInfo["source"] }).__pendingSource ?? "camera";
          emitOnce<{ producerId: string }>(
            socket,
            "produce",
            { transportId: transport.id, examId: exam, peerId, source: pending, kind, rtpParameters },
            ["produced"],
          )
            .then((r) => callback({ id: r.producerId }))
            .catch((e: unknown) => errback(e instanceof Error ? e : new Error(String(e))));
        });
        logPub("PUB", `send transport ready via=${label} id=${created.id.slice(0, 8)}`);
        return transport;
      };

      const produceTrack = async (transport: Transport, via: string, track: MediaStreamTrack, source: SfuProducerInfo["source"]) => {
        (transport as unknown as { __pendingSource?: string }).__pendingSource = source;
        try {
          // Bitrates/RIDs come from media-config (VITE_CAM_*/VITE_SCREEN_*),
          // never hardcoded here.
          const encodings =
            track.kind === "video"
              ? source === "screen"
                ? simulcastEncodings(MEDIA.screenBaseBitrate, MEDIA.screenSurplusBitrate, MEDIA.screenFps)
                : simulcastEncodings(MEDIA.camBaseBitrate, MEDIA.camSurplusBitrate, MEDIA.camFps)
              : undefined;
          const producer = await transport.produce({ track, encodings });
          // Full id: the SFU logs full producer ids, so both sides join.
          logPub("PUB", `produced ${source}/${track.kind} id=${producer.id} via=${via} simulcast=${track.kind === "video" ? "720p base + 360p premium" : "n/a"}`);
          return producer;
        } finally {
          (transport as unknown as { __pendingSource?: string }).__pendingSource = undefined;
        }
      };

      const camVideo = cam?.getVideoTracks()[0];
      const camAudio = cam?.getAudioTracks()[0];
      const screenVideo = screen?.getVideoTracks()[0];
      const sendTransports: Transport[] = [];
      const produced: ProducedSender[] = [];
      if (camVideo || camAudio) {
        const sendCam = await createSendTransport("cam");
        sendTransports.push(sendCam);
        if (camVideo) {
          const p = await produceTrack(sendCam, "cam", camVideo, "camera");
          if (p) produced.push({ producer: p, source: "camera-video", isVideo: true });
        }
        if (camAudio) {
          const p = await produceTrack(sendCam, "cam", camAudio, "camera");
          if (p) produced.push({ producer: p, source: "camera-audio", isVideo: false });
        }
      }
      if (screenVideo) {
        const sendScreen = await createSendTransport("screen");
        sendTransports.push(sendScreen);
        const p = await produceTrack(sendScreen, "screen", screenVideo, "screen");
        if (p) produced.push({ producer: p, source: "screen-video", isVideo: true });
      }
      sendTransportRef.current = sendTransports;
      // Pin encoders to maintain-resolution so Chrome doesn't shed the high-res
      // BASE simulcast layer (recordings + focus stage need it), then log
      // per-RID stats now and 15s in to prove which layers actually leave the
      // device.
      void applyProducerDegradation(produced);
      logCaptureSettings(produced);
      void logProducerLayerStats(produced, "publish");
      setTimeout(() => {
        void logProducerLayerStats(produced, "t+15s");
      }, 15000);

      // Proctor talk-back: staff mic producers announced live.
      const isStaffMic = (info: { role?: string; source?: string }) =>
        (info.role === "proctor" || info.role === "admin") && info.source === "mic";
      socket.on("newProducer", (info: SfuProducerInfo) => {
        if (isStaffMic(info)) {
          void consumeProctorMic(socket, info);
        }
      });
      const handleMicPaused = (msg: { producerId: string }) => {
        if (!msg?.producerId) return;
        if (proctorProducerIdRef.current && msg.producerId !== proctorProducerIdRef.current) return;
        proctorProducerIdRef.current = msg.producerId;
        setProctorMuted(true);
        logPub("MIC", `proctor muted producer=${msg.producerId.slice(0, 8)}`);
      };
      const handleMicResumed = (msg: SfuProducerInfo & { producerId: string }) => {
        if (!msg?.producerId) return;
        // Resume for the mic we're already consuming → just unhide banner.
        if (proctorProducerIdRef.current === msg.producerId) {
          setProctorMuted(false);
          logPub("MIC", `proctor unmuted producer=${msg.producerId.slice(0, 8)}`);
          return;
        }
        // Resume for an unconsumed staff mic (e.g. missed newProducer) → consume now.
        if (!proctorConsumerRef.current && isStaffMic(msg)) {
          void consumeProctorMic(socket, msg as SfuProducerInfo);
        } else if (!proctorConsumerRef.current && (msg.role === "proctor" || msg.role === "admin" || !msg.role)) {
          void consumeProctorMic(socket, msg as SfuProducerInfo);
        }
      };
      const handleMicClosed = (msg: { producerId: string }) => {
        if (!msg?.producerId) return;
        if (proctorProducerIdRef.current !== msg.producerId) return;
        try {
          proctorConsumerRef.current?.close();
        } catch {
          /* non-fatal */
        }
        proctorProducerIdRef.current = null;
        proctorConsumerRef.current = null;
        setProctorAudioStream(null);
        setProctorMuted(true);
        logPub("MIC", `proctor mic closed producer=${msg.producerId.slice(0, 8)}`);
      };
      // Canonical broadcast names (server) + legacy ack names (robustness).
      socket.on("producer:paused", handleMicPaused);
      socket.on("producerPaused", handleMicPaused);
      socket.on("producer:resumed", handleMicResumed);
      socket.on("producerResumed", handleMicResumed);
      socket.on("producer:closed", handleMicClosed);
      socket.on("disconnect", () => setSfuConnected(false));
      socket.on("error", (err: { message?: string }) => logPub("SIG", `sfu error ${err?.message ?? ""}`));
      setSfuConnected(true);
      logPub("PUB", `publishing exam=${exam} peer=${peerId} transports=${sendTransports.length}`);
    },
    [consumeProctorMic, teardownConnection],
  );

  useEffect(
    () => () => {
      try {
        socketRef.current?.disconnect();
      } catch {
        /* non-fatal */
      }
    },
    [],
  );

  return (
    <Ctx.Provider
      value={{
        cameraStatus,
        screenStatus,
        screenShareSupported,
        cameraError,
        screenError,
        cameraStream,
        screenStream,
        requestCameraMic,
        requestScreen,
        requestAll,
        stopAll,
        publishToSFU,
        unpublishFromSFU,
        sfuConnected,
        proctorAudioStream,
        proctorMuted,
        audioBlocked,
        unlockProctorAudio,
        emitExamFlag,
        startExamRecording,
        stopExamRecording,
        examRecording,
      }}
    >
      {children}
      {/* Hidden element for proctor talk-back audio */}
      <audio ref={audioElRef} autoPlay preload="auto" style={{ display: "none" }} />
    </Ctx.Provider>
  );
}
