import { getSfuBase } from "@/lib/sfu";

export type RecordingKind = "camera" | "screen";

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = localStorage.getItem("token") || "";
  return token ? { Authorization: `Bearer ${token}`, ...extra } : extra;
}

/** Create (or reuse) the server-side recording for this exam session. */
export async function startSfuRecording(
  examId: string | number,
  sessionId: string | number,
  opts: { rollNumber?: string; kinds?: RecordingKind[] } = {},
): Promise<{ recordingId: string; reused: boolean }> {
  const res = await fetch(`${getSfuBase()}/api/recordings/start`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      examId: String(examId),
      sessionId: String(sessionId),
      rollNumber: opts.rollNumber,
      kinds: opts.kinds,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recording start failed (${res.status}) ${text}`.trim());
  }
  return res.json();
}

/** Finalize server-side: closes files, queues S3 upload + DB update. */
export async function stopSfuRecording(recordingId: string): Promise<void> {
  const res = await fetch(`${getSfuBase()}/api/recordings/${recordingId}/stop`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recording stop failed (${res.status}) ${text}`.trim());
  }
}

export function recordingStorageKey(sessionId: string | number): string {
  return `sfu-recording-${sessionId}`;
}
