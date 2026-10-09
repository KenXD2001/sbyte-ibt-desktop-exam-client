import { useProctorMedia } from "@/contexts/ProctorMediaContext";

/**
 * Thin wrapper over the provider-level exam recording (which must live in
 * ProctorMediaProvider so start/stop survive verify -> take navigation).
 * Recording itself is server-side: the SFU taps published RTP into ffmpeg.
 */
export function useExamRecorder() {
  const { examRecording, startExamRecording, stopExamRecording } = useProctorMedia();
  return {
    recording: examRecording,
    recordingId: null as string | null,
    startExamRecording: (
      examId: string | number,
      sessionId: string | number,
      _streams?: { cameraStream: MediaStream | null; screenStream: MediaStream | null },
    ) => startExamRecording(examId, sessionId),
    stopExamRecording,
  };
}
