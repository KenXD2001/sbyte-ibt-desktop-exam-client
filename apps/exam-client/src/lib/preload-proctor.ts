import { loadAiProctorModels, loadFaceApiModels, type AiProctorModels } from "@/lib/ai-proctor";

/**
 * Preload cache for proctoring assets.
 *
 * The Instructions page warms these up (AI-proctor exams) so the Verify /
 * Take steps open instantly. `useAIProctorMonitor` consumes the cached
 * instances via `consumePreloadedAiModels()` instead of downloading twice.
 */

let sfuPromise: Promise<unknown> | null = null;
let aiPromise: Promise<AiProctorModels> | null = null;
let cachedAiModels: AiProctorModels | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Warm the live-video library (dynamic import → browser caches the chunk). */
export function preloadSfuClient(timeoutMs = 30_000): Promise<unknown> {
  if (!sfuPromise) {
    sfuPromise = withTimeout(
      import("mediasoup-client").then((m) => m),
      timeoutMs,
      "Live-video setup",
    ).catch((err) => {
      // Non-fatal: the exam continues; Verify/Take retry the static import.
      sfuPromise = null;
      throw err;
    });
  }
  return sfuPromise;
}

/** Download AI-monitoring assets once and keep the instances ready. */
export function preloadAiProctorModels(timeoutMs = 60_000): Promise<AiProctorModels> {
  if (cachedAiModels) return Promise.resolve(cachedAiModels);
  if (!aiPromise) {
    aiPromise = withTimeout(
      (async () => {
        const [models] = await Promise.all([loadAiProctorModels(), loadFaceApiModels().then(() => null)]);
        cachedAiModels = models;
        return models;
      })(),
      timeoutMs,
      "Monitoring setup",
    ).catch((err) => {
      // Non-fatal: the Take step loads them lazily as fallback.
      aiPromise = null;
      throw err;
    });
  }
  return aiPromise;
}

/**
 * One-shot handover to the exam monitor. Returns the warmed instances when
 * the Instructions page finished preloading, else `null` (caller loads
 * lazily as before).
 */
export function consumePreloadedAiModels(): AiProctorModels | null {
  const models = cachedAiModels;
  return models;
}

/** True when the AI assets finished preloading (monitor can start instantly). */
export function hasPreloadedAiModels(): boolean {
  return cachedAiModels !== null;
}
