import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useExamSession } from "@/contexts/ExamSessionContext";
import { useProctorMedia } from "@/contexts/ProctorMediaContext";
import { candidateExamApi } from "@/services/api";
import { snapshotVideo } from "@/lib/ai-proctor";

/**
 * Manual-proctor flags (raised from the live dashboard). The server persists
 * the flag row and pushes `server:flag_raised` with its id — the candidate
 * sees a warning toast and uploads camera + screen frames through the
 * standard flag-proof endpoint (same S3 + DB path as AI-proctor flags).
 * Fire-and-forget throughout: proof failures never disturb the exam.
 */
export function useManualFlagAlert(sessionId: number | null | undefined) {
  const { setOnFlagRaised } = useExamSession();
  const { cameraStream, screenStream } = useProctorMedia();
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamsRef = useRef({ cameraStream, screenStream });
  streamsRef.current = { cameraStream, screenStream };

  // Hidden video elements mirroring the shared streams for frame reads
  // (same approach as the AI monitor — no second getUserMedia).
  useEffect(() => {
    const cam = document.createElement("video");
    cam.muted = true;
    cameraVideoRef.current = cam;
    const scr = document.createElement("video");
    scr.muted = true;
    screenVideoRef.current = scr;
    return () => {
      cameraVideoRef.current = null;
      screenVideoRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = cameraVideoRef.current;
    if (cameraStream && el) {
      if (el.srcObject !== cameraStream) el.srcObject = cameraStream;
      el.play().catch(() => {});
    }
  }, [cameraStream]);

  useEffect(() => {
    const el = screenVideoRef.current;
    if (screenStream && el) {
      if (el.srcObject !== screenStream) el.srcObject = screenStream;
      el.play().catch(() => {});
    }
  }, [screenStream]);

  useEffect(() => {
    if (!sessionId) return;
    setOnFlagRaised((payload) => {
      const flagId = payload.flagId as number;
      const flagTitle =
        (payload.flagTitle as string) || "Flag raised by proctor";
      if (typeof flagId !== "number") return;
      toast.warning(`Proctor flag: ${flagTitle}`, { duration: 5000 });
      const frames: Array<{ kind: "camera" | "screen"; image: string }> = [];
      const camImage = cameraVideoRef.current
        ? snapshotVideo(cameraVideoRef.current)
        : null;
      if (camImage) frames.push({ kind: "camera", image: camImage });
      const screenImage = screenVideoRef.current
        ? snapshotVideo(screenVideoRef.current)
        : null;
      if (screenImage) frames.push({ kind: "screen", image: screenImage });
      for (const proof of frames) {
        candidateExamApi.uploadFlagProof(sessionId, flagId, proof).catch(() => {
          /* flag row already saved — proof loss is acceptable */
        });
      }
    });
    return () => setOnFlagRaised(undefined);
  }, [sessionId, setOnFlagRaised]);
}
