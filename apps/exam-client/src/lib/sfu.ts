/**
 * Strict SFU config. `VITE_SFU_URL` is required and must be the HTTP(S) base
 * of the Nest mediasoup SFU server (Socket.IO lives on `/signaling`), e.g.
 * `http://192.168.1.102:5052`. Missing/invalid value fails loudly at startup —
 * there are no in-code fallbacks.
 */
export function getSfuBase(): string {
  const raw = (import.meta.env.VITE_SFU_URL as string | undefined)?.trim().replace(/["']/g, "");
  if (!raw) {
    throw new Error('[config] Missing VITE_SFU_URL. Set it in .env, e.g. VITE_SFU_URL=http://192.168.1.102:5052');
  }
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    throw new Error(`[config] VITE_SFU_URL must be an http(s) base URL, got "${raw}"`);
  }
  return raw.replace(/\/$/, "");
}

export interface SfuProducerInfo {
  producerId: string;
  examId: string;
  peerId: string;
  role: string;
  source: "camera" | "screen" | "mic";
  kind: "audio" | "video";
}
