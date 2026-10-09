import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useProctorMedia } from "@/contexts/ProctorMediaContext";
import { candidateExamApi } from "@/services/api";
import {
  FACE_DISTANCE_THRESHOLD,
  FLAG_PROOF_SOURCE,
  OBJECT_FRAME_MAX_DIM,
  PHONE_SCORE_THRESHOLD,
  cropFaceToCanvas,
  describeFace,
  estimateGaze,
  faceDistance,
  frameToCanvas,
  loadAiProctorModels,
  loadFaceApiModels,
  loadImage,
  snapshotVideo,
  type AiProctorModels,
  type FaceDescriptor,
} from "@/lib/ai-proctor";
import { consumePreloadedAiModels } from "@/lib/preload-proctor";

export type AiProctorStatus = "idle" | "loading" | "active" | "error";

interface Options {
  /** True only for AI-proctored exams with a live session. */
  enabled: boolean;
  sessionId?: number;
  verificationImageUrl?: string | null;
}

type FlagTitle =
  | "No Face Detected"
  | "Look Into the Screen"
  | "Unauthorized Person Detected"
  | "Looking away from the screen"
  | "Cell Phone Detected"
  | "Multiple face detected";

const TICK_MS = 1_000;

/** Yields the main thread so React can paint (toasts!) between heavy
    inference stages. Without this, a toast raised mid-tick only appears
    after the remaining detectors finish — seconds late on modest hardware. */
const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0));

interface ViolationPolicy {
  /** Consecutive bad ticks before firing (× TICK_MS = sustain time). */
  confirmTicks: number;
  toastCooldownMs: number;
  reportCooldownMs: number;
}

const POLICIES: Record<FlagTitle, ViolationPolicy> = {
  // Instant (1 tick ≈ 1s), re-fires 10s after the last one while present.
  "Cell Phone Detected": { confirmTicks: 1, toastCooldownMs: 10_000, reportCooldownMs: 10_000 },
  // 2s sustained presence, then 10s cooldown.
  "No Face Detected": { confirmTicks: 2, toastCooldownMs: 10_000, reportCooldownMs: 10_000 },
  "Looking away from the screen": { confirmTicks: 2, toastCooldownMs: 10_000, reportCooldownMs: 10_000 },
  "Unauthorized Person Detected": { confirmTicks: 2, toastCooldownMs: 10_000, reportCooldownMs: 10_000 },
  "Multiple face detected": { confirmTicks: 2, toastCooldownMs: 10_000, reportCooldownMs: 10_000 },
  // Mild off-centre nudge — unchanged (3 ticks, 12s toast / 30s report).
  "Look Into the Screen": { confirmTicks: 3, toastCooldownMs: 12_000, reportCooldownMs: 30_000 },
};

const TOAST_IDS: Record<FlagTitle, string> = {
  "No Face Detected": "ai-no-face",
  "Look Into the Screen": "ai-look-at-screen",
  "Unauthorized Person Detected": "ai-unauthorized",
  "Looking away from the screen": "ai-looking-away",
  "Cell Phone Detected": "ai-cell-phone",
  "Multiple face detected": "ai-multi-face",
};

/** Toast color per flag: hard violations render red, the mild gaze nudge amber. */
const TOAST_KIND: Record<FlagTitle, "warning" | "error"> = {
  "Cell Phone Detected": "error",
  "No Face Detected": "error",
  "Looking away from the screen": "error",
  "Unauthorized Person Detected": "error",
  "Multiple face detected": "error",
  "Look Into the Screen": "warning",
};

/**
 * On-device AI proctoring for `ai-proctor` exams. Consumes the camera stream
 * from ProctorMediaContext (same stream published to the SFU — no second
 * getUserMedia needed):
 * - MediaPipe FaceDetector → no-face / multi-face counts
 * - MediaPipe FaceLandmarker → gaze (look-into-screen / looking-away)
 * - MediaPipe ObjectDetector (cell-phone allowlist) → phone detection
 * - face-api 128-d descriptors → live face vs verification-step webcam photo
 *   for "Unauthorized Person Detected"
 *
 * Violations surface as candidate-facing toasts (throttled), realtime SFU
 * `flag:raise` alerts to watching proctors, fast POST
 * /candidate-exam/session/:id/flags persistence, and a single relevant
 * frame (camera vs screen per FLAG_PROOF_SOURCE) uploaded in the background
 * via POST .../flags/:flagId/proof — alerts never wait on S3.
 */
export function useAIProctorMonitor({ enabled, sessionId, verificationImageUrl }: Options) {
  const { cameraStream, screenStream, emitExamFlag } = useProctorMedia();
  const [status, setStatus] = useState<AiProctorStatus>("idle");
  const [identityReady, setIdentityReady] = useState(false);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const stateRef = useRef({
    models: null as AiProctorModels | null,
    referenceDescriptor: null as FaceDescriptor | null,
    identityInflight: false,
    tickInflight: false,
    lastToastAt: {} as Partial<Record<FlagTitle, number>>,
    lastReportAt: {} as Partial<Record<FlagTitle, number>>,
    streaks: {} as Partial<Record<FlagTitle, number>>,
    running: false,
    /** Client-side proof-upload queue: at most 2 concurrent PUTs, FIFO waiters. */
    proofActive: 0,
    proofWaiting: [] as Array<() => void>,
  });

  // Hidden video elements that mirror the shared streams for frame reads.
  useEffect(() => {
    const cam = document.createElement("video");
    cam.muted = true;
    (cam as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
    cameraVideoRef.current = cam;
    const scr = document.createElement("video");
    scr.muted = true;
    (scr as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
    screenVideoRef.current = scr;
    return () => {
      cameraVideoRef.current = null;
      screenVideoRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (cameraStream && cameraVideoRef.current) {
      const el = cameraVideoRef.current;
      if (el.srcObject !== cameraStream) el.srcObject = cameraStream;
      el.play().catch(() => {});
    }
  }, [cameraStream]);

  useEffect(() => {
    if (screenStream && screenVideoRef.current) {
      const el = screenVideoRef.current;
      if (el.srcObject !== screenStream) el.srcObject = screenStream;
      el.play().catch(() => {});
    }
  }, [screenStream]);

  useEffect(() => {
    if (!enabled || !sessionId || !cameraStream) {
      setStatus((s) => (enabled && s === "loading" ? s : "idle"));
      return;
    }
    const st = stateRef.current;
    let cancelled = false;
    st.running = true;
    setStatus("loading");

    const raise = (title: FlagTitle) => {
      const policy = POLICIES[title];
      const now = Date.now();
      st.streaks[title] = (st.streaks[title] ?? 0) + 1;
      if (st.streaks[title]! < policy.confirmTicks) return;
      // Keep firing while the condition persists, but throttled.
      if (now - (st.lastToastAt[title] ?? 0) > policy.toastCooldownMs) {
        st.lastToastAt[title] = now;
        toast[TOAST_KIND[title]](title, { id: TOAST_IDS[title], duration: 4000 });
      }
      if (now - (st.lastReportAt[title] ?? 0) > policy.reportCooldownMs) {
        st.lastReportAt[title] = now;
        // FAST PATH — alerts first, proof in background:
        // 1. Realtime alert to watching proctors (SFU room broadcast).
        // 2. Persist the flag row (no images → returns in ms).
        // 3. Upload the single relevant frame via the proof endpoint.
        // Steps 2-3 are fire-and-forget: they never block toasts or ticks.
        emitExamFlag(title);
        void reportFlagWithProof(title);
      }
    };

    /** Single-frame proof source for a flag (camera vs screen). */
    const captureProofFrame = (title: FlagTitle): { kind: "camera" | "screen"; image: string } | null => {
      const kind = FLAG_PROOF_SOURCE[title] ?? "camera";
      const video = kind === "screen" ? screenVideoRef.current : cameraVideoRef.current;
      if (!video) return null;
      const image = snapshotVideo(video);
      if (!image) return null;
      return { kind, image };
    };

    /** Bounded client-side queue for proof uploads (max 2 concurrent). */
    const enqueueProofUpload = (task: () => Promise<void>) => {
      const start = () => {
        st.proofActive += 1;
        task()
          .catch(() => {})
          .finally(() => {
            st.proofActive -= 1;
            const next = st.proofWaiting.shift();
            if (next) next();
          });
      };
      if (st.proofActive < 2) {
        start();
      } else if (st.proofWaiting.length < 10) {
        st.proofWaiting.push(start);
      }
      // Else drop: the flag row is already saved; proof loss under extreme
      // burst is acceptable and the next throttled report retries anyway.
    };

    const reportFlagWithProof = async (title: FlagTitle) => {
      if (!sessionId) return;
      // Capture the frame synchronously in the same tick as the flag so the
      // proof matches the moment of detection (not seconds later).
      const proof = captureProofFrame(title);
      let flagId: number | null = null;
      try {
        const res = await candidateExamApi.reportFlag(sessionId, {
          flagTitle: title,
          triggeredBy: "ai-proctor",
        });
        if (res?.deduped) return; // server already holds a fresh flag — skip S3
        flagId = typeof res?.id === "number" ? res.id : null;
      } catch {
        return; // persistence failed; cooldown governs the next retry
      }
      if (flagId == null || !proof) return;
      enqueueProofUpload(async () => {
        try {
          await candidateExamApi.uploadFlagProof(sessionId, flagId, proof);
        } catch {
          // One delayed retry, then give up (flag row already saved).
          await new Promise((r) => setTimeout(r, 2000));
          try {
            await candidateExamApi.uploadFlagProof(sessionId, flagId, proof);
          } catch {
            /* proof stays missing — admin still sees the flag text */
          }
        }
      });
    };

    const resetStreak = (title: FlagTitle) => {
      st.streaks[title] = 0;
    };

    // Staged async body: yields to the UI thread between detectors so a
    // toast raised by one stage paints before the next stage crunches.
    const tickBody = async () => {
      const models = st.models;
      const cam = cameraVideoRef.current;
      if (!models || !cam || cam.videoWidth === 0 || cam.readyState < 2) return;
      if (document.hidden) return; // tab-switch policy owns hidden-tab handling
      let now: number;
      try {
        now = performance.now();
      } catch {
        now = Date.now();
      }
      let faceCount = 0;
      let faceBox: { originX: number; originY: number; width: number; height: number } | null = null;
      try {
        const res = models.faceDetector.detectForVideo(cam, now);
        faceCount = res?.detections?.length ?? 0;
        const first = res?.detections?.[0]?.boundingBox;
        if (first) faceBox = first;
      } catch {
        return;
      }

      if (faceCount === 0) {
        raise("No Face Detected");
      } else {
        resetStreak("No Face Detected");
      }

      if (faceCount > 1) {
        raise("Multiple face detected");
        // A second face is by definition an unauthorized person in the frame.
        raise("Unauthorized Person Detected");
      } else {
        resetStreak("Multiple face detected");
      }
      // Paint any face-count toast before the (heavier) landmark stage.
      await yieldToUI();

      // Gaze via landmarks on the primary face.
      if (faceCount >= 1) {
        try {
          const lm = models.faceLandmarker.detectForVideo(cam, now);
          const primary = lm?.faceLandmarks?.[0];
          if (primary && primary.length > 300) {
            // Face-box width (normalized) tells estimateGaze how big the face
            // is in frame so wide-angle/small-face feeds get slack.
            const gaze = estimateGaze(primary, faceBox?.width ?? 0.3);
            if (gaze.lookingAway) {
              raise("Looking away from the screen");
              resetStreak("Look Into the Screen");
            } else if (gaze.offCentre) {
              raise("Look Into the Screen");
              resetStreak("Looking away from the screen");
            } else {
              resetStreak("Look Into the Screen");
              resetStreak("Looking away from the screen");
            }
          }
        } catch {
          /* landmark failure must not kill the loop */
        }
      } else {
        resetStreak("Look Into the Screen");
        resetStreak("Looking away from the screen");
      }
      // Paint any gaze toast before identity snapshot + object detection.
      await yieldToUI();

      // Identity check (async, guarded against overlap): single live face
      // descriptor vs the verification photo descriptor. Euclidean distance
      // above threshold (default 0.6) = different person.
      if (faceCount === 1 && st.referenceDescriptor && faceBox && !st.identityInflight) {
        st.identityInflight = true;
        const crop = cropFaceToCanvas(cam, faceBox, cam.videoWidth, cam.videoHeight);
        void describeFace(crop ?? cam)
          .then((live) => {
            if (!live || !st.running) return;
            const dist = faceDistance(st.referenceDescriptor!, live);
            if (dist > FACE_DISTANCE_THRESHOLD) {
              raise("Unauthorized Person Detected");
            } else {
              resetStreak("Unauthorized Person Detected");
            }
          })
          .catch(() => {})
          .finally(() => {
            st.identityInflight = false;
          });
      } else if (faceCount <= 1 && !st.referenceDescriptor) {
        // No reference descriptor yet (photo missing/unreadable): only
        // multi-face can imply an unauthorized person.
        resetStreak("Unauthorized Person Detected");
      }

      // Phone detection on a downscaled copy of the camera frame — cheaper
      // upload/convert per tick, and the detector resizes internally anyway.
      try {
        const frame = frameToCanvas(cam, OBJECT_FRAME_MAX_DIM);
        const obj = frame ? models.objectDetector.detectForVideo(frame, now) : null;
        const phone = (obj?.detections ?? []).some((d) =>
          (d.categories ?? []).some(
            (c) => (c.score ?? 0) >= PHONE_SCORE_THRESHOLD && /cell|mobile|phone/i.test(c.categoryName ?? ""),
          ),
        );
        if (phone) raise("Cell Phone Detected");
        else resetStreak("Cell Phone Detected");
      } catch {
        /* non-fatal */
      }
    };

    // Overlap guard: a tick that overruns its 1s slot is skipped instead of
    // piling up (also keeps MediaPipe's monotonic timestamps sane).
    const tick = () => {
      if (st.tickInflight) return;
      st.tickInflight = true;
      tickBody()
        .catch(() => {})
        .finally(() => {
          st.tickInflight = false;
        });
    };

    (async () => {
      try {
        // Reuse the instances warmed on the Instructions page when available;
        // otherwise load MediaPipe graphs + face-api nets in parallel.
        // (loadFaceApiModels is internally cached, so awaiting it is free.)
        const preloaded = consumePreloadedAiModels();
        const models = preloaded ?? await loadAiProctorModels();
        await loadFaceApiModels();
        if (cancelled) return;
        st.models = models;
        // Reference descriptor for the verified candidate. Preferred source is
        // the auth'd photo endpoint (same CORS as the API — always pixel-safe,
        // fresh and resumed sessions alike); the display URL is a fallback.
        let refImg: HTMLImageElement | null = null;
        try {
          const photo = await candidateExamApi.getVerificationPhoto(sessionId);
          if (cancelled) return;
          if (photo?.image) refImg = await loadImage(photo.image);
        } catch {
          refImg = null;
        }
        if (!refImg && verificationImageUrl) {
          try {
            refImg = await loadImage(verificationImageUrl);
          } catch {
            refImg = null;
          }
        }
        if (refImg) {
          st.referenceDescriptor = await describeFace(refImg);
        }
        if (cancelled) return;
        if (st.referenceDescriptor) {
          console.info("[AIProctor] identity reference ready — unauthorized-person check active");
          setIdentityReady(true);
        } else {
          console.warn("[AIProctor] no identity reference (photo missing or no face in it) — unauthorized-person check degraded to multi-face only");
          setIdentityReady(false);
        }
        setStatus("active");
      } catch (e) {
        console.error("[AIProctor] model load failed", e);
        if (!cancelled) {
          setStatus("error");
          toast.error("AI monitoring failed to start — manual monitoring continues.");
        }
        return;
      }
    })();

    const timer = window.setInterval(tick, TICK_MS);
    return () => {
      cancelled = true;
      st.running = false;
      st.tickInflight = false;
      window.clearInterval(timer);
      st.models?.close();
      st.models = null;
      st.referenceDescriptor = null;
      st.identityInflight = false;
      st.streaks = {};
    };
  }, [enabled, sessionId, cameraStream, screenStream, verificationImageUrl, emitExamFlag]);

  return { aiStatus: status, identityReady };
}
