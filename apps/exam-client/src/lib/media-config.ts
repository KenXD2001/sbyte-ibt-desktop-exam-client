// Central WebRTC media configuration for the candidate publisher.
//
// All values are overridable via Vite env so capture size / bitrates / frame
// rates can be tuned without a code change. The SFU never transcodes:
// the browser produces BASE(full capture = 720p) + PREMIUM(½ capture = 360p)
// VP8 simulcast encodings and the SFU forwards the layer each subscriber
// requests.
//
// Layer order (spatial index): encodings[0] / spatial 0 = BASE high-res
// (always produced, BWE priority — admin focus/stage and the recording live
// here); encodings[1] / spatial 1 = PREMIUM low-res (surplus only — cheap
// admin grid tiles). VERIFIED BY EXPERIMENT: Chrome's simulcast allocator
// starves a HIGH-RES *premium* layer into a ~65kbps/3.5fps zombie (720p
// measured), so recording/admin can never reliably hop up to it. The high-res
// layer therefore MUST be the always-produced BASE — this order is deliberate
// and permanent, whatever the capture resolution is.

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const MEDIA = {
  // Capture targets (ideal — browser may negotiate lower on weak devices)
  camWidth: num(import.meta.env.VITE_CAM_WIDTH, 1280),
  camHeight: num(import.meta.env.VITE_CAM_HEIGHT, 720),
  camFps: num(import.meta.env.VITE_CAM_FPS, 30),
  screenWidth: num(import.meta.env.VITE_SCREEN_WIDTH, 1280),
  screenHeight: num(import.meta.env.VITE_SCREEN_HEIGHT, 720),
  // Screen FPS: 4 VP8 simulcast encodings (2 cam + 2 screen) all run on the
  // candidate's CPU, so 720p30 on both streams is encode-heavy. Default 30
  // (matches camera) for the sharpest recording; set lower (e.g. 15) only on
  // weak CPUs — degradationPreference sheds frame rate, not resolution.
  screenFps: num(import.meta.env.VITE_SCREEN_FPS, 30),

  // Simulcast RIDs (must match the SFU's layer map)
  lowRid: "low",
  highRid: "high",

  // per-layer maxBitrate (bps) for the high-res BASE and low-res PREMIUM
  // layers (env names keep the historical `*_LOW/HIGH_BITRATE`; LOW/HIGH here
  // refer to the layer's resolution tier, NOT bitrate size — the high-res
  // base carries the big cap). Defaults: 720p base ~1.2M, 360p premium ~300k.
  // Higher = better quality; Chrome spends only what uplink BWE allows.
  // Weak uplinks: keep the base @ ~800k and drop surplus.
  camBaseBitrate: num(import.meta.env.VITE_CAM_LOW_BITRATE, 1_200_000),
  camSurplusBitrate: num(import.meta.env.VITE_CAM_HIGH_BITRATE, 300_000),
  screenBaseBitrate: num(import.meta.env.VITE_SCREEN_LOW_BITRATE, 1_200_000),
  screenSurplusBitrate: num(import.meta.env.VITE_SCREEN_HIGH_BITRATE, 300_000),

  // Opus speech bitrate (bps), applied to the candidate mic sender.
  audioBitrate: num(import.meta.env.VITE_AUDIO_BITRATE, 40_000),
} as const;

export function simulcastEncodings(baseBitrate: number, surplusBitrate: number, maxFramerate: number): RTCRtpEncodingParameters[] {
  // NOTE: do not add `priority` or `minBitrate` here — this Chrome build throws
  // "Attempted to set an unimplemented parameter of RtpParameters" from
  // addTransceiver when either is present. BWE protection is handled by the
  // lean surplus cap + high base maxBitrate below and by degradationPreference
  // (applyVideoSenderDegradation).
  //
  // Array ORDER defines the wire spatial mapping (mediasoup-client rewrites
  // rids to r0/r1 by index): encodings[0] = r0 = spatial 0 = the BASE layer.
  // The FULL-capture, highest-quality layer goes FIRST so recording + admin
  // focus always start on it; the half-resolution 360p-class layer is the
  // surplus at spatial 1 for grid tiles.
  // PERMANENT (verified): a high-res *surplus* layer gets starved by Chrome's
  // simulcast allocator, so it can never be a reliably upgraded layer — the
  // high-res layer must be the always-on base.
  return [
    {
      // BASE layer (always produced, BWE priority): full capture = 720p @fps.
      // Recording + admin focus/stage live here — this is what gets recorded.
      // baseBitrate (~1.2M) keeps it a REAL 720p stream.
      rid: MEDIA.lowRid,
      scaleResolutionDownBy: 1,
      maxBitrate: baseBitrate,
      maxFramerate,
    },
    {
      // PREMIUM layer (surplus BWE only): ½ capture = 360p @fps. Cheap admin
      // grid tiles when uplink covers the base — lean surplusBitrate
      // (~300k) is plenty.
      rid: MEDIA.highRid,
      scaleResolutionDownBy: 2,
      maxBitrate: surplusBitrate,
      maxFramerate,
    },
  ];
}

// After the video senders exist, pin the encoder to maintain the capture
// resolution instead of downscaling under CPU/bandwidth pressure. Chrome's
// default degradation preference scales the base layer down (this is what left
// a focused proctor watching 480p camera from a 720p capture). With this,
// pressure is shed via frame rate instead, keeping the 720p base layer
// intact at full res.
export function applyVideoSenderDegradation(pc: RTCPeerConnection): Promise<unknown[]> {  const jobs: Promise<unknown>[] = [];
  for (const sender of pc.getSenders()) {
    if (!sender.track || sender.track.kind !== "video") continue;
    const label = (sender.track.label || "").toLowerCase().includes("screen") ? "screen" : "camera";
    try {
      const params = sender.getParameters();
      if (params.degradationPreference === "maintain-resolution") {
        jobs.push(Promise.resolve());
        continue;
      }
      params.degradationPreference = "maintain-resolution";
      jobs.push(
        sender.setParameters(params)
          .then(() => console.info(`[SAT:ENC] ${label} degradationPreference=maintain-resolution`))
          .catch(() => console.warn(`[SAT:ENC] ${label} degradationPreference rejected (browser ignores it)`)),
      );
    } catch { /* non-fatal */ }
  }
  return Promise.all(jobs);
}

export interface ProducedSender {
  producer: {
    track?: MediaStreamTrack | null;
    getStats(): Promise<RTCStatsReport>;
  };
  source: string;
  isVideo: boolean;
}

/**
 * mediasoup-client hides the RTCPeerConnection, so this reaches the video
 * RTCRtpSenders via the producer handle (best-effort, guarded) and pins
 * degradationPreference=maintain-resolution. Without this Chrome's default
 * "balanced" mode can cap/shed spatial layers under CPU/bandwidth pressure and
 * the high-res BASE (spatial 0) layer — which recording and admin focus depend
 * on — would drop resolution. Pinning keeps it at full res, shedding frame
 * rate instead.
 */
export async function applyProducerDegradation(items: ProducedSender[]): Promise<void> {
  for (const { producer, source, isVideo } of items) {
    if (!isVideo) continue;
    try {
      const sender = (producer as unknown as { _rtpSender?: RTCRtpSender | null })?._rtpSender;
      if (!sender) {
        console.warn(`[SAT:ENC] ${source} no sender handle — degradation untouched`);
        continue;
      }
      const params = sender.getParameters();
      if (params.degradationPreference === "maintain-resolution") {
        console.info(`[SAT:ENC] ${source} degradationPreference already maintain-resolution`);
        continue;
      }
      params.degradationPreference = "maintain-resolution";
      await sender.setParameters(params);
      console.info(`[SAT:ENC] ${source} degradationPreference=maintain-resolution`);
    } catch {
      console.warn(`[SAT:ENC] ${source} degradationPreference rejected (browser ignores it)`);
    }
  }
}

/**
 * Per-RID outbound diagnostics: bytes/frames actually sent, encoded size,
 * and — most importantly — qualityLimitationReason per layer ("bandwidth" /
 * "cpu" / "other" / "none"). r0 is the high-res BASE layer (always produced,
 * paid first from BWE): if r0 shows a bandwidth/cpu limit, EVEN the recording
 * layer is starved on this device — the real problem. r1 is the low-res
 * PREMIUM layer, which legitimately shows "bandwidth" whenever the uplink
 * can't spare surplus beyond the base; the goal (recording + focus) is r0 =
 * "none".
 *
 * Plus the transport-wide truth that decides the case: the nominated
 * candidate-pair (udp/tcp, availableOutgoingBitrate, rtt), remote-inbound
 * (fractionLost/jitter per layer) and media-source (captured frames). A
 * "bandwidth" limit with availableOutgoingBitrate >> 2Mbps means a
 * negotiation/config gap, not a weak link — and low BWE + high loss means
 * the network really is the ceiling.
 */
export async function logProducerLayerStats(items: ProducedSender[], tag: string): Promise<void> {
  for (const { producer, source } of items) {
    try {
      const report = await producer.getStats();
      report.forEach((s) => {
        const o = s as unknown as Record<string, unknown>;
        if (s.type !== "outbound-rtp" || o["isRemote"]) return;
        const isAudio = source.includes("audio");
        const count = isAudio
          ? `packets=${String(o["packetsSent"] ?? 0)}`
          : `frames=${String(o["framesSent"] ?? 0)}`;
        console.info(
          `[SAT:ENC] ${tag} ${source} rid=${String(o["rid"] ?? "-")} ` +
            `bytes=${String(o["bytesSent"] ?? 0)} ${count} ` +
            `${String(o["frameWidth"] ?? "?")}x${String(o["frameHeight"] ?? "?")} ` +
            `limitation=${String(o["qualityLimitationReason"] ?? "?")} ` +
            `active=${String(o["active"] ?? "?")}`,
        );
      });
      // Candidate details by id so the pair line can name protocol + types.
      const candidates = new Map<string, Record<string, unknown>>();
      report.forEach((s) => {
        if (s.type === "local-candidate" || s.type === "remote-candidate") {
          candidates.set(s.id, s as unknown as Record<string, unknown>);
        }
      });
      // Transport-wide BWE + path: one line per nominated pair.
      report.forEach((s) => {
        const o = s as unknown as Record<string, unknown>;
        if (s.type !== "candidate-pair" || o["nominated"] !== true) return;
        if (o["writable"] !== undefined && o["writable"] !== true) return;
        const local = candidates.get(String(o["localCandidateId"] ?? ""));
        const remote = candidates.get(String(o["remoteCandidateId"] ?? ""));
        console.info(
          `[SAT:NET] ${tag} ${source} proto=${String(local?.["protocol"] ?? "?")} ` +
            `type=${String(local?.["candidateType"] ?? "?")}→${String(remote?.["candidateType"] ?? "?")} ` +
            `bwe=${String(o["availableOutgoingBitrate"] ?? "?")} rtt=${String(o["currentRoundTripTime"] ?? "?")} ` +
            `state=${String(o["state"] ?? "?")}`,
        );
      });
      // Per-layer loss/jitter as the SFU sees it.
      report.forEach((s) => {
        const o = s as unknown as Record<string, unknown>;
        if (s.type !== "remote-inbound-rtp") return;
        console.info(
          `[SAT:NET] ${tag} ${source} inbound ssrc=${String(o["ssrc"] ?? "?")} ` +
            `loss=${String(o["fractionLost"] ?? "?")} jitter=${String(o["jitter"] ?? "?")} ` +
            `rtt=${String(o["roundTripTime"] ?? "?")}`,
        );
      });
      // Captured vs sent: drops here mean CPU/encode pressure, not network.
      report.forEach((s) => {
        const o = s as unknown as Record<string, unknown>;
        if (s.type !== "media-source" || o["kind"] !== "video") return;
        console.info(
          `[SAT:NET] ${tag} ${source} source ` +
            `${String(o["width"] ?? "?")}x${String(o["height"] ?? "?")}@${String(o["framesPerSecond"] ?? "?")}fps`,
        );
      });
    } catch {
      /* non-fatal — stats unavailable */
    }
  }
}

/** Log what the OS/browser actually granted (vs what we asked for). */
export function logCaptureSettings(items: ProducedSender[]): void {
  for (const { producer, source } of items) {
    try {
      const track = producer.track as MediaStreamTrack | null | undefined;
      if (!track) continue;
      const st = track.getSettings();
      console.info(
        `[SAT:CAP] ${source} capture ${String(st.width ?? "?")}x${String(st.height ?? "?")}@${String(st.frameRate ?? "?")}fps ` +
          `surface=${String((st as Record<string, unknown>)["displaySurface"] ?? "-")}`,
      );
    } catch {
      /* non-fatal */
    }
  }
}
