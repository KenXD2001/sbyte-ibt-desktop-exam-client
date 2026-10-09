import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, CheckCircle2, XCircle, ShieldCheck, Video, Mic, Monitor, ScreenShare, Camera, IdCard, ArrowRight, AlertTriangle, Clock, Hash } from "lucide-react";
import { candidateExamApi, type ExamInstructions, type ExamSessionCheck, type SessionQuestions, type VerificationStatus } from "@/services/api";
import { useToast } from "@/hooks/useToast";
import { useExamSession } from "@/contexts/ExamSessionContext";
import { useProctorMedia } from "@/contexts/ProctorMediaContext";
import ExamSetupLoader, { type SetupStep } from "@/components/exam/ExamSetupLoader";
import { PreExamPauseGate } from "@/components/exam/ManualPauseScreens";

interface LocationState {
  sessionId?: number;
  instructions?: ExamInstructions;
  sessionCheck?: ExamSessionCheck | null;
  randomizeQuestions?: boolean;
  randomizeOptions?: boolean;
  questionDirection?: string;
  prefetchedSession?: SessionQuestions | null;
  prefetchedVerification?: VerificationStatus | null;
  deviceInfo?: { geoLocation?: string; ipAddress?: string } | null;
}

const normalizeMode = (mode?: string | null) =>
  (mode || "").toLowerCase().replace(/_/g, "-");

async function capturePublicIp(): Promise<string | undefined> {
  const services = [
    "https://api.ipify.org?format=json",
    "https://ipinfo.io/json",
    "https://api.my-ip.io/v2/ip.json",
  ];
  for (const url of services) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const data = await res.json();
      const ip = data.ip || data.ipAddress;
      if (ip && typeof ip === "string") return ip;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function captureGeoLocation(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(`${pos.coords.latitude},${pos.coords.longitude}`),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) reject(new Error("Location access is required. Please allow location access and try again."));
        else reject(new Error("Unable to determine your location."));
      },
      { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false },
    );
  });
}

function drawToCompressedDataUrl(
  source: HTMLVideoElement | HTMLImageElement,
  sw: number,
  sh: number,
  maxDim = 1280,
): string {
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function preloadImages(questions: { questionText: string; options: { text: string }[] }[]) {
  for (const q of questions) {
    const htmls = [q.questionText, ...q.options.map((o) => o.text)].filter(Boolean);
    for (const html of htmls) {
      const div = document.createElement("div");
      div.innerHTML = html;
      div.querySelectorAll("img").forEach((img) => {
        const preload = new Image();
        preload.src = img.getAttribute("src") ?? "";
      });
    }
  }
}

type CaptureTarget = "idFront" | "idBack" | "webcam";

export default function VerificationPage() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const incoming = (location.state as LocationState | null) ?? null;
  const { showError, showSuccess } = useToast();
  const { setSessionId, startKioskFromGesture } = useExamSession();
  const {
    cameraStatus, screenStatus, screenShareSupported, cameraError, screenError,
    cameraStream, screenStream,
    requestCameraMic, requestScreen, requestAll, publishToSFU,
    startExamRecording,
  } = useProctorMedia();

  const [instructions, setInstructions] = useState<ExamInstructions | null>(incoming?.instructions ?? null);
  const [sessionCheck, setSessionCheck] = useState<ExamSessionCheck | null>(incoming?.sessionCheck ?? null);
  const [loading, setLoading] = useState(!incoming?.instructions);
  const [error, setError] = useState<string | null>(null);
  const [idFrontImage, setIdFrontImage] = useState<string | null>(null);
  const [idBackImage, setIdBackImage] = useState<string | null>(null);
  const [webcamImage, setWebcamImage] = useState<string | null>(null);
  const [alreadyVerified, setAlreadyVerified] = useState(false);
  const [proceeding, setProceeding] = useState(false);
  const [captureTarget, setCaptureTarget] = useState<CaptureTarget | null>(null);
  const [reentryRequesting, setReentryRequesting] = useState(false);
  const [reentryRequested, setReentryRequested] = useState(false);

  // Kiosk is owned once by ExamSessionProvider (armed on Second Loading) —
  // this page never enters it directly; fullscreen also lives in kiosk.

  // Submit overlay: same setup experience as Instructions — the multi-step
  // save before the main exam, with errors staying on this page.
  const [submitSteps, setSubmitSteps] = useState<SetupStep[]>([]);
  const [submitMessage, setSubmitMessage] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const sessionIdRef = useRef<number | undefined>(incoming?.sessionId);
  const randomizeRef = useRef(incoming?.randomizeQuestions ?? false);
  const randomizeOptionsRef = useRef(incoming?.randomizeOptions ?? false);
  const questionDirectionRef = useRef(incoming?.questionDirection ?? 'bidirectional');
  const proceedAttemptedRef = useRef(false);

  const mode = normalizeMode(instructions?.examMode || (instructions as unknown as { exam_mode?: string } | null)?.exam_mode);
  const hasMediaFlags =
    (instructions as ExamInstructions | null)?.webcamScreenStreaming !== undefined ||
    (instructions as ExamInstructions | null)?.webcamRecording !== undefined ||
    (instructions as ExamInstructions | null)?.screenRecording !== undefined;
  const needsStreaming = hasMediaFlags
    ? (instructions as ExamInstructions)?.webcamScreenStreaming === true
    : mode !== "" && mode !== "normal";
  const needsCamera = hasMediaFlags
    ? needsStreaming || (instructions as ExamInstructions)?.webcamRecording === true
    : mode !== "" && mode !== "normal";
  const needsScreen = hasMediaFlags
    ? needsStreaming || (instructions as ExamInstructions)?.screenRecording === true
    : mode !== "" && mode !== "normal";
  const shouldRecord = hasMediaFlags
    ? (instructions as ExamInstructions)?.webcamRecording === true ||
      (instructions as ExamInstructions)?.screenRecording === true
    : mode !== "" && mode !== "normal";
  const shouldPublish = needsCamera || needsScreen;
  const isAI = (mode.includes("ai") || (instructions?.examType || "").toLowerCase().includes("ai")) && needsCamera;
  const needsVerification = needsCamera || needsScreen;

  // Load instructions + session if not passed from Instructions page (single fetch lives on Instructions; this is a refresh/new-tab fallback)
  useEffect(() => {
    if (!examId) return;
    if (instructions && sessionCheck) return;
    let cancelled = false;
    setLoading(true);
    candidateExamApi.getExamInstructions(Number(examId))
      .then((data) => {
        if (cancelled) return;
        setInstructions(data);
        randomizeRef.current = data.randomizeQuestions ?? false;
        randomizeOptionsRef.current = data.randomizeOptions ?? false;
        questionDirectionRef.current = data.questionDirection ?? 'bidirectional';
        return candidateExamApi.getExamSession(Number(examId));
      })
      .then((check) => {
        if (cancelled || !check) return;
        setSessionCheck(check);
        if (check.hasSession && check.sessionId) sessionIdRef.current = check.sessionId;
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load exam details");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  // Exams with no media needed (Normal, or AI with all flags off) skip verification entirely
  useEffect(() => {
    if (loading || !instructions) return;
    if (sessionCheck?.alreadyAttempted) {
      navigate(`/exam/${examId}/result`, { replace: true });
      return;
    }
    if (!needsVerification) {
      // Carry everything known downstream — take/subjects refetch the rest.
      navigate(`/exam/${examId}/subjects`, {
        replace: true,
        state: {
          ...(incoming ?? {}),
          sessionId: sessionIdRef.current ?? sessionCheck?.sessionId,
          instructions,
          sessionCheck,
          randomizeQuestions: randomizeRef.current,
          randomizeOptions: randomizeOptionsRef.current,
          questionDirection: questionDirectionRef.current,
        },
      });
    }
  }, [loading, instructions, examId, navigate, needsVerification, sessionCheck, incoming]);

  // If a session already exists, check whether identity is already verified (resume path skips re-capture).
  // Prefetched verification from the Instructions page is reused — no refetch.
  useEffect(() => {
    const prefetched = incoming?.prefetchedVerification;
    if (prefetched?.verified) {
      setAlreadyVerified(true);
      if (prefetched.idCardImageUrl) setIdFrontImage(prefetched.idCardImageUrl);
      if (prefetched.idCardBackImageUrl) setIdBackImage(prefetched.idCardBackImageUrl);
      if (prefetched.webcamImageUrl) setWebcamImage(prefetched.webcamImageUrl);
      return;
    }
    const sid = sessionIdRef.current ?? sessionCheck?.sessionId;
    if (!sid) return;
    candidateExamApi.getVerification(sid)
      .then((v) => {
        if (v.verified) {
          setAlreadyVerified(true);
          if (v.idCardImageUrl) setIdFrontImage(v.idCardImageUrl);
          if (v.idCardBackImageUrl) setIdBackImage(v.idCardBackImageUrl);
          if (v.webcamImageUrl) setWebcamImage(v.webcamImageUrl);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCheck]);

  // Attach live streams to previews
  useEffect(() => {
    if (cameraStatus === "granted" && cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraStatus, cameraStream]);

  useEffect(() => {
    if (screenStatus === "granted" && screenStream && screenVideoRef.current) {
      screenVideoRef.current.srcObject = screenStream;
      screenVideoRef.current.play().catch(() => {});
    }
  }, [screenStatus, screenStream]);

  // Screen share is desktop-only (no getDisplayMedia on phones/tablets), so on
  // unsupported devices camera alone is sufficient — camera-only monitoring.
  // Each permission is only required when its flag is enabled.
  const screenSatisfied = !needsScreen || screenStatus === "granted" || !screenShareSupported;
  const cameraSatisfied = !needsCamera || cameraStatus === "granted";
  const proctorReady = cameraSatisfied && screenSatisfied;
  const identityComplete = !!(idFrontImage && idBackImage && webcamImage);

  // Re-entry gating mirrors the Instructions page: when Auto Join is off and
  // the session needs re-entry, the candidate requests it here and waits for
  // approval — Proceed stays disabled until then.
  const isReentryRequired = sessionCheck?.reentryRequired === true;
  const isReentryApproved = sessionCheck?.reentryStatus === 'approved';
  const hasPendingRequest = reentryRequested || sessionCheck?.reentryStatus === 'pending';
  const canRequestReentry = isReentryRequired && !isReentryApproved && !hasPendingRequest;
  const canProceed =
    proctorReady &&
    (alreadyVerified || identityComplete) &&
    (!isReentryRequired || isReentryApproved);

  const handleRequestReentry = useCallback(async () => {
    if (!examId) return;
    setReentryRequesting(true);
    try {
      await candidateExamApi.requestReentry(Number(examId));
      setReentryRequested(true);
      const check = await candidateExamApi.getExamSession(Number(examId));
      setSessionCheck(check);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to submit re-entry request. Please try again after some time..");
    } finally {
      setReentryRequesting(false);
    }
  }, [examId, showError]);

  const statusNote = (() => {
    if (isReentryRequired && !isReentryApproved && hasPendingRequest) return { tone: "amber", title: "Approval pending", text: "Your re-entry request is under review. Please check back shortly." };
    if (isReentryRequired && !isReentryApproved) return { tone: "amber", title: "Active session found", text: "Auto-resume is disabled for this exam — request re-entry from the administrator to continue." };
    if (isReentryApproved) return { tone: "green", title: "Re-entry approved", text: "Your request was approved. You can proceed to the exam now." };
    return null;
  })();

  const actionButtonText = (() => {
    if (reentryRequesting) return "Submitting Request…";
    if (hasPendingRequest && !isReentryApproved) return "Approval Pending";
    if (canRequestReentry) return "Request Re-entry";
    if (proceeding) return "Saving & Opening Exam…";
    return "Proceed to Exam";
  })();
  const submitProgress =
    submitSteps.length === 0
      ? 0
      : Math.round((submitSteps.filter((s) => s.status === "done").length / submitSteps.length) * 100);

  // Captures stay local until "Proceed to Exam" — uploads happen only in handleProceed.
  const handleCaptureDone = useCallback((target: CaptureTarget, dataUrl: string) => {
    if (target === "idFront") setIdFrontImage(dataUrl);
    else if (target === "idBack") setIdBackImage(dataUrl);
    else setWebcamImage(dataUrl);
    setAlreadyVerified(false);
    setCaptureTarget(null);
  }, []);

  const handleProceed = useCallback(async () => {
    if (!examId || proceedAttemptedRef.current) return;
    if (!proctorReady) {
      if (needsCamera && needsScreen) {
        showError(
          screenShareSupported
            ? "Please allow camera, microphone and screen sharing before proceeding."
            : "Please allow camera and microphone before proceeding.",
        );
      } else if (needsCamera) {
        showError("Please allow camera and microphone before proceeding.");
      } else if (needsScreen) {
        showError(
          screenShareSupported
            ? "Please allow screen sharing before proceeding."
            : "Screen sharing is not available on this device — you can proceed with camera-only monitoring.",
        );
        if (screenShareSupported) return;
      }
      if (needsCamera || (needsScreen && screenShareSupported)) return;
    }
    if (!alreadyVerified && (!idFrontImage || !idBackImage || !webcamImage)) {
      showError("Please capture the ID card front, ID card back and webcam photos.");
      return;
    }
    // Stale-state race: approval may have been revoked (or never granted)
    // since the page loaded — re-check instead of hitting a 403 mid-overlay.
    if (sessionCheck?.reentryRequired === true && sessionCheck?.reentryStatus !== 'approved') {
      showError("Re-entry approval is required before proceeding. Please request re-entry and wait for approval.");
      try {
        const check = await candidateExamApi.getExamSession(Number(examId));
        setSessionCheck(check);
      } catch { /* keep current state */ }
      return;
    }
    proceedAttemptedRef.current = true;
    setProceeding(true);
    setSubmitError(null);
    setSubmitSteps([
      { id: "confirm", label: "Confirming your details", status: "active" },
      { id: "session", label: "Setting up your exam session", status: "pending" },
    ]);
    setSubmitMessage("Confirming your details…");
    const markSubmit = (id: string, status: SetupStep["status"]) =>
      setSubmitSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
    const dropSubmit = (id: string) => setSubmitSteps((prev) => prev.filter((s) => s.id !== id));
    try {
      let sid = sessionIdRef.current ?? sessionCheck?.sessionId;
      let isResumed = !!sid;

      markSubmit("confirm", "done");
      if (!sid) {
        setSubmitMessage("Creating your exam session…");
        markSubmit("session", "active");
        const [geoLocation, ipAddress] = await Promise.all([
          captureGeoLocation().catch(() => undefined),
          capturePublicIp(),
        ]).then(([geo, ip]) => [geo, ip] as const);
        const session = await candidateExamApi.startExam(Number(examId), {
          geoLocation,
          ipAddress,
          userAgent: navigator.userAgent,
          platform: navigator.platform,
        });
        if (!session?.sessionId) throw new Error("We couldn't create your exam session. Please try again after some time..");
        sid = session.sessionId;
        isResumed = session.isResumed ?? false;
        sessionIdRef.current = sid;
      } else {
        setSubmitMessage("Updating your exam session…");
        markSubmit("session", "active");
        // Resume path: startExam transitions a paused session back to
        // in-progress server-side (and returns the existing session otherwise),
        // so the questions fetch below doesn't 400 with "Session is not active".
        const resumed = await candidateExamApi.startExam(Number(examId), {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
        });
        if (!resumed?.sessionId) throw new Error("We couldn't update your exam session. Please try again after some time..");
        sid = resumed.sessionId;
        sessionIdRef.current = sid;
        isResumed = true;
        const check = await candidateExamApi.getExamSession(Number(examId)).catch(() => null);
        if (check) setSessionCheck(check);
      }
      const sessionLabel = isResumed ? "Updating your exam session" : "Creating your exam session";
      const extra: SetupStep[] = [];
      if (!alreadyVerified) {
        extra.push({ id: "photos", label: "Saving your verification photos", status: "pending" });
      }
      extra.push({ id: "questions", label: "Getting your questions ready", status: "pending" });
      if (shouldPublish) {
        extra.push({ id: "monitoring", label: "Connecting live monitoring", status: "pending" });
      }
      if (shouldRecord) {
        extra.push({ id: "recording", label: "Starting exam recording", status: "pending" });
      }
      extra.push({ id: "open", label: "Opening your exam", status: "pending" });
      setSubmitSteps((prev) =>
        prev.map((s) => (s.id === "session" ? { ...s, status: "done" as const, label: sessionLabel } : s)).concat(extra),
      );

      // Persist verification captures (DB keys + S3 files) unless already verified for this session
      if (!alreadyVerified) {
        setSubmitMessage("Saving your verification photos…");
        markSubmit("photos", "active");
        await candidateExamApi.saveVerification(sid!, {
          idCardImage: idFrontImage!,
          idCardBackImage: idBackImage!,
          webcamImage: webcamImage!,
        });
        markSubmit("photos", "done");
      }

      setSubmitMessage("Getting your questions ready…");
      markSubmit("questions", "active");
      try {
        await candidateExamApi.initializeHotSession(sid!, Number(examId), instructions?.duration ?? 0);
      } catch { /* non-critical */ }

      let prefetched = null;
      try {
        prefetched = await candidateExamApi.getSessionQuestions(sid!);
        if (prefetched) preloadImages(prefetched.questions);
      } catch { /* ExamPage fetches as fallback */ }
      markSubmit("questions", "done");

      setSessionId(sid!);
      if (shouldPublish) {
        setSubmitMessage("Connecting live monitoring…");
        markSubmit("monitoring", "active");
        try {
          await publishToSFU(examId!, sid!);
          markSubmit("monitoring", "done");
        } catch (err) {
          // SFU publish failure is non-blocking for the exam, but must be
          // VISIBLE (previously swallowed): no stream reaches the proctor.
          // The step is dropped and the warning toast persists onto Take.
          console.error("[Media] SFU publish failed — proctor will see no stream", err);
          dropSubmit("monitoring");
          showError("Live monitoring failed to connect. The exam continues, but your proctor cannot see you — please inform them.");
        }
      }

      // Exam recording (camera+mic, screen) → SFU ./recordings, then S3 + DB.
      // Non-blocking: the exam opens even if recording fails.
      // Only started when webcam/screen recording is enabled in settings.
      if (shouldRecord) {
        setSubmitMessage("Starting exam recording…");
        markSubmit("recording", "active");
        try {
          await startExamRecording(examId!, sid!);
          markSubmit("recording", "done");
        } catch (err) {
          console.error("[Media] exam recording failed — continuing without recording", err);
          dropSubmit("recording");
        }
      }

      setSubmitMessage("Opening your exam…");
      markSubmit("open", "active");
      showSuccess("Verification complete. Opening your exam.");
      // Exam boundary marker (joins with SFU join/record lines by exam+session).
      console.info(`[SAT:EXAM] open exam=${examId} session=${sid} resumed=${isResumed}`);
      console.log("[Kiosk] verification done — navigating to /take", {
        examId,
        sessionId: sid,
        kioskMode: instructions?.kioskMode ?? false,
        examMode: instructions?.examMode,
      });
      markSubmit("open", "done");
      navigate(`/exam/${examId}/subjects`, {
        replace: true,
        state: {
          sessionId: sid,
          isResumed,
          randomizeQuestions: randomizeRef.current,
          randomizeOptions: randomizeOptionsRef.current,
          questionDirection: questionDirectionRef.current,
          prefetchedSession: prefetched,
          tabSwitchDetection: instructions?.tabSwitchDetection ?? false,
          tabSwitchAction: instructions?.tabSwitchAction ?? "pause",
          tabSwitchAutoSubmitLimit: instructions?.tabSwitchAutoSubmitLimit ?? 0,
          kioskMode: instructions?.kioskMode ?? false,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "We couldn't open your exam. Please try again after some time..";
      // A manual pause surfaces as a 403 from startExam — drop the overlay
      // and flip the local session check so the blocked gate renders.
      if (/manually paused/i.test(message)) {
        setProceeding(false);
        setSubmitSteps([]);
        proceedAttemptedRef.current = false;
        setSessionCheck((prev) => (prev ? { ...prev, isManuallyPaused: true } : { hasSession: true, isManuallyPaused: true }));
        showError(message);
        return;
      }
      setSubmitSteps((prev) =>
        prev.map((s) => (s.status === "active" ? { ...s, status: "error" as const } : s)),
      );
      setSubmitError(message);
      setProceeding(true); // keep the overlay open on its error state
      proceedAttemptedRef.current = false;
    }
  }, [examId, proctorReady, needsCamera, needsScreen, shouldPublish, shouldRecord, screenShareSupported, alreadyVerified, idFrontImage, idBackImage, webcamImage, sessionCheck, instructions, navigate, setSessionId, publishToSFU, startExamRecording, showError, showSuccess]);

  const handleProceedRetry = useCallback(() => {
    setSubmitError(null);
    setProceeding(false);
    setSubmitSteps([]);
    void handleProceed();
  }, [handleProceed]);

  const handleProceedClose = useCallback(() => {
    setSubmitError(null);
    setProceeding(false);
    setSubmitSteps([]);
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-muted/40 p-4">
        <AlertTriangle className="size-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={() => navigate(`/exam/${examId}/instructions`, { replace: true })}>Back to Instructions</Button>
      </div>
    );
  }

  if (loading || !instructions) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <div className="flex items-center gap-2.5 rounded-lg border bg-card px-4 py-3">
          <Loader2 className="size-4 animate-spin text-primary" />
          <p className="text-[13px] text-muted-foreground">Loading verification…</p>
        </div>
      </div>
    );
  }

  if (!needsVerification) return null;

  // Manual-pause gate: entry is blocked server-side — explain and offer retry.
  if (sessionCheck?.isManuallyPaused) {
    return (
      <PreExamPauseGate
        examTitle={instructions.examTitle}
        onCheckAgain={() => window.location.reload()}
        onBack={() => navigate(`/exam/${examId}/instructions`, { replace: true })}
      />
    );
  }

  const examStats = [
    { icon: Hash, label: "Questions", value: String(instructions.totalQuestions) },
    { icon: Clock, label: "Duration", value: `${instructions.duration} min` },
  ];

  return (
    <div className="flex min-h-screen justify-center bg-muted/40 px-4 py-8">
      <Card className="w-full max-w-3xl h-fit overflow-hidden shadow-sm">
        {/* Compact header — exam identity only */}
        <CardHeader className="border-b bg-card px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <ShieldCheck className="size-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-lg leading-tight">Identity Verification</CardTitle>
                <Badge variant={isAI ? "default" : "secondary"} className="gap-1 text-[11px]">
                  <ShieldCheck className="size-3" />
                  {mode === "ai-manual-proctor" ? "AI + Manual Proctored" : isAI ? "AI Proctored" : "Proctored"}
                </Badge>
              </div>
              <CardDescription className="mt-1 line-clamp-2 text-[13px]">
                {instructions.examTitle}{instructions.subjectName ? ` · ${instructions.subjectName}` : ""} — grant permissions, then capture your ID and webcam photos.
              </CardDescription>
            </div>
          </div>
          {/* Exam-related details only */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {examStats.map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center gap-2.5 rounded-lg border bg-muted/30 px-3 py-2">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <Icon className="size-3.5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="truncate text-sm font-semibold leading-tight">{value}</p>
                </div>
              </div>
            ))}
          </div>
        </CardHeader>

        <CardContent className="space-y-5 px-5 py-5">
          {/* Step 1 — Permissions */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">1 · Permissions</p>
              {proctorReady
                ? <Badge variant="success" className="gap-1 text-[11px]"><CheckCircle2 className="size-3" /> Ready</Badge>
                : <Badge variant="warning" className="text-[11px]">Required</Badge>}
            </div>
            <p className="mb-2 text-[13px] leading-snug text-muted-foreground">
              {needsCamera && needsScreen ? (
                <>
                  Allow <span className="font-medium text-foreground">camera + microphone</span>
                  {screenShareSupported ? (
                    <> and <span className="font-medium text-foreground">screen sharing</span> (choose <span className="font-medium text-foreground">Entire Screen</span>). Keep them enabled for the whole exam.</>
                  ) : (
                    <>. Screen sharing isn&apos;t available on this device, so camera-only monitoring will be used — keep the camera enabled for the whole exam.</>
                  )}
                </>
              ) : needsCamera ? (
                <>Allow <span className="font-medium text-foreground">camera + microphone</span>. Keep {needsStreaming || shouldRecord ? "it" : "them"} enabled for the whole exam.</>
              ) : (
                <>
                  Allow <span className="font-medium text-foreground">screen sharing</span> (choose <span className="font-medium text-foreground">Entire Screen</span>). Keep it enabled for the whole exam.
                </>
              )}
            </p>
            <div className={`grid gap-2 ${needsScreen ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
              {needsVerification && (
              <div className="rounded-lg border bg-card p-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-medium"><Video className="size-3.5 text-primary" /> Camera & Mic</span>
                  {cameraStatus === "granted" && <CheckCircle2 className="size-4 text-emerald-600" />}
                  {cameraStatus === "denied" && <XCircle className="size-4 text-destructive" />}
                  {cameraStatus === "requesting" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                </div>
                <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-md bg-black">
                  <video ref={videoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${cameraStatus === "granted" ? "block" : "hidden"}`} />
                  {cameraStatus !== "granted" && (
                    <p className="p-3 text-center text-xs text-white/70">Camera preview will appear here</p>
                  )}
                </div>
                {cameraStatus !== "granted" && (
                  <Button size="sm" className="mt-2 w-full gap-1.5 text-xs" onClick={requestCameraMic} disabled={cameraStatus === "requesting"}>
                    {cameraStatus === "requesting" ? <Loader2 className="size-3.5 animate-spin" /> : <Video className="size-3.5" />}
                    {cameraStatus === "denied" ? "Allow Camera & Mic" : "Enable Camera & Mic"}
                  </Button>
                )}
                {cameraError && <p className="mt-1.5 text-xs leading-snug text-destructive">{cameraError}</p>}
              </div>
              )}
              {needsScreen && (
              <div className="rounded-lg border bg-card p-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-medium"><Monitor className="size-3.5 text-primary" /> Screen Share</span>
                  {screenStatus === "granted" && <CheckCircle2 className="size-4 text-emerald-600" />}
                  {screenStatus === "denied" && <XCircle className="size-4 text-destructive" />}
                  {screenStatus === "requesting" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                  {screenStatus === "unsupported" && <Badge variant="secondary" className="text-[11px]">N/A</Badge>}
                </div>
                {!screenShareSupported ? (
                  <div className="flex aspect-video flex-col items-center justify-center gap-1.5 rounded-md border bg-muted p-3 text-center">
                    <Monitor className="size-5 text-muted-foreground/60" strokeWidth={1.5} />
                    <p className="text-xs font-medium text-muted-foreground">Not supported on this device</p>
                    <p className="text-[11px] leading-snug text-muted-foreground/70">
                      Phones and tablets can&apos;t share their screen in a browser — your exam will be monitored via camera only.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-md border bg-muted">
                      <video ref={screenVideoRef} autoPlay muted playsInline className={`h-full w-full bg-black object-contain ${screenStatus === "granted" ? "block" : "hidden"}`} />
                      {screenStatus !== "granted" && (
                        <p className="p-3 text-center text-xs text-muted-foreground">No screen selected</p>
                      )}
                    </div>
                    {screenStatus !== "granted" && (
                      <Button size="sm" className="mt-2 w-full gap-1.5 text-xs" onClick={requestScreen} disabled={screenStatus === "requesting"}>
                        {screenStatus === "requesting" ? <Loader2 className="size-3.5 animate-spin" /> : <ScreenShare className="size-3.5" />}
                        {screenStatus === "denied" ? "Try Again — Share Screen" : "Share Screen"}
                      </Button>
                    )}
                    {screenStatus !== "granted" && (
                      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                        In the browser picker, choose the <span className="font-medium">Entire Screen</span> tab — a window or Chrome tab will not be accepted.
                      </p>
                    )}
                  </>
                )}
                {screenError && screenShareSupported && <p className="mt-1.5 text-xs leading-snug text-destructive">{screenError}</p>}
              </div>
              )}
            </div>
            {!proctorReady && (
              <Button size="sm" variant="outline" className="mt-2 gap-1.5 text-xs" onClick={() => {
                if (needsCamera && needsScreen) void requestAll();
                else if (needsCamera) void requestCameraMic();
                else void requestScreen();
              }} disabled={cameraStatus === "requesting" || screenStatus === "requesting"}>
                <ShieldCheck className="size-3.5" /> {needsCamera && needsScreen ? "Enable All Permissions" : needsCamera ? "Enable Camera & Mic" : "Enable Screen Sharing"}
              </Button>
            )}
          </section>

          <Separator />

          {/* Step 2 — Identity photos (ID front + ID back + webcam) */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">2 · Identity Photos</p>
              {alreadyVerified
                ? <Badge variant="success" className="gap-1 text-[11px]"><CheckCircle2 className="size-3" /> Verified</Badge>
                : identityComplete
                  ? <Badge variant="success" className="gap-1 text-[11px]"><CheckCircle2 className="size-3" /> Captured</Badge>
                  : <Badge variant="warning" className="text-[11px]">Required</Badge>}
            </div>
            {alreadyVerified && (
              <p className="mb-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                Identity already verified for this session. Re-capture below if needed, or proceed directly.
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-3">
              <CaptureTile
                title="ID Front"
                icon={<IdCard className="size-3.5 text-primary" />}
                image={idFrontImage}
                emptyText="Front side of your ID card"
                captureDisabled={cameraStatus !== "granted"}
                onStartCapture={() => setCaptureTarget("idFront")}
              />
              <CaptureTile
                title="ID Back"
                icon={<IdCard className="size-3.5 text-primary" />}
                image={idBackImage}
                emptyText="Back side of your ID card"
                captureDisabled={cameraStatus !== "granted"}
                onStartCapture={() => setCaptureTarget("idBack")}
              />
              <CaptureTile
                title="Webcam"
                icon={<Camera className="size-3.5 text-primary" />}
                image={webcamImage}
                emptyText="Your face, clearly visible"
                captureDisabled={cameraStatus !== "granted"}
                onStartCapture={() => setCaptureTarget("webcam")}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Photos are kept on this device until you proceed — uploading happens when you click “Proceed to Exam”.</p>
          </section>

          {statusNote && (
            <div
              className={
                statusNote.tone === "amber"
                  ? "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800"
                  : "rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-green-800"
              }
            >
              <p className="text-[13px] font-medium">{statusNote.title}</p>
              <p className="mt-0.5 text-xs opacity-80">{statusNote.text}</p>
            </div>
          )}

          <Button className="w-full gap-2" size="lg" disabled={proceeding || reentryRequesting || (!canRequestReentry && !canProceed)} onClick={() => {
            if (canRequestReentry) {
              void handleRequestReentry();
              return;
            }
            // Second Loading (proceed flow) opens from this click: enter kiosk
            // incl. gesture fullscreen inside the click task.
            if (instructions?.kioskMode) void startKioskFromGesture(true);
            void handleProceed();
          }}>
            {proceeding || reentryRequesting ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {actionButtonText}
          </Button>
          {!canProceed && (
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <Mic className="size-3" /> Complete Step 1 permissions and all three Step 2 photos to enable this button.
            </p>
          )}
        </CardContent>
      </Card>

      <CaptureDialog
        target={captureTarget}
        onClose={() => setCaptureTarget(null)}
        onDone={handleCaptureDone}
      />

      {/* Submit overlay: saving before the main exam. Errors stay here. */}
      {proceeding && (
        <ExamSetupLoader
          overlay
          title="Opening your exam"
          subtitle={instructions?.examTitle}
          steps={submitSteps}
          progress={submitError ? submitProgress : Math.max(submitProgress, 5)}
          currentMessage={submitError ? "We hit a problem" : submitMessage || "Working…"}
          error={submitError}
          onRetry={submitError ? handleProceedRetry : undefined}
          onClose={submitError ? handleProceedClose : undefined}
        />
      )}
    </div>
  );
}

function CaptureTile({
  title, icon, image, emptyText, captureDisabled, onStartCapture,
}: {
  title: string;
  icon: React.ReactNode;
  image: string | null;
  emptyText: string;
  captureDisabled: boolean;
  onStartCapture: () => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">{icon} {title}</span>
        {image ? <CheckCircle2 className="size-4 text-emerald-600" /> : null}
      </div>
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-md bg-black">
        {image ? (
          <img src={image} alt={`${title} capture`} className="h-full w-full bg-black object-contain" />
        ) : (
          <p className="p-3 text-center text-xs text-white/70">{emptyText}</p>
        )}
      </div>
      <Button size="sm" variant="outline" className="mt-2 w-full gap-1.5 text-xs" onClick={onStartCapture} disabled={captureDisabled}>
        <Camera className="size-3.5" />
        {image ? "Retake" : "Start Capture"}
      </Button>
      {captureDisabled && (
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Enable camera in Step 1 first</p>
      )}
    </div>
  );
}

const CAPTURE_TITLES: Record<CaptureTarget, string> = {
  idFront: "ID Card — Front",
  idBack: "ID Card — Back",
  webcam: "Webcam Photo",
};

const CAPTURE_HINTS: Record<CaptureTarget, string> = {
  idFront: "Hold the front of your ID card steady inside the frame.",
  idBack: "Flip your ID card and hold the back side inside the frame.",
  webcam: "Face the camera — keep your face clearly visible.",
};

const ID_GUIDELINES = [
  "Fit the whole card inside the frame — all 4 corners visible",
  "Use good lighting; avoid glare and shadows on the card",
  "Hold steady and keep the text large enough to read",
];

const isIdTarget = (t: CaptureTarget | null) => t === "idFront" || t === "idBack";

/** Live-preview capture dialog. Still is confirmed with Done; nothing uploads until Proceed to Exam. */
function CaptureDialog({
  target, onClose, onDone,
}: {
  target: CaptureTarget | null;
  onClose: () => void;
  onDone: (target: CaptureTarget, dataUrl: string) => void;
}) {
  const { cameraStream } = useProctorMedia();
  const liveRef = useRef<HTMLVideoElement | null>(null);
  const [still, setStill] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  useEffect(() => {
    setStill(null);
    setCaptureError(null);
  }, [target]);

  // The dialog popup mounts into a portal one commit after `open` flips, so a
  // plain effect can run while the video element doesn't exist yet. A callback
  // ref attaches the (shared, multi-consumer-safe) stream whenever the node mounts.
  const attachLiveVideo = useCallback((node: HTMLVideoElement | null) => {
    liveRef.current = node;
    if (node && cameraStream) {
      if (node.srcObject !== cameraStream) node.srcObject = cameraStream;
      node.play().catch(() => {});
    }
  }, [cameraStream]);

  useEffect(() => {
    const node = liveRef.current;
    if (target && !still && node && cameraStream) {
      if (node.srcObject !== cameraStream) node.srcObject = cameraStream;
      node.play().catch(() => {});
    }
  }, [target, cameraStream, still]);

  const handleCapture = () => {
    const video = liveRef.current;
    if (!video || !video.videoWidth) {
      setCaptureError("Camera is not ready yet. Please wait a moment and try again.");
      return;
    }
    try {
      setStill(drawToCompressedDataUrl(video, video.videoWidth, video.videoHeight));
      setCaptureError(null);
    } catch {
      setCaptureError("Capture failed. Please try again after some time..");
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Capture {target ? CAPTURE_TITLES[target] : ""}</DialogTitle>
          <DialogDescription className="text-[13px]">
            {target ? CAPTURE_HINTS[target] : ""} Capture as many times as you like, then press Done.
          </DialogDescription>
        </DialogHeader>
        <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border bg-black">
          {still ? (
            <img src={still} alt="Captured preview" className="h-full w-full bg-black object-contain" />
          ) : (
            <>
              <video ref={attachLiveVideo} autoPlay muted playsInline className="h-full w-full object-cover" />
              {isIdTarget(target) && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  {/* ID-card frame guide (credit-card proportions) */}
                  <div className="relative aspect-[8/5] w-[68%]">
                    <div className="absolute inset-0 rounded-lg border-2 border-dashed border-white/90" />
                    <span className="absolute -top-0.5 -left-0.5 size-4 rounded-tl-lg border-t-4 border-l-4 border-emerald-400" />
                    <span className="absolute -top-0.5 -right-0.5 size-4 rounded-tr-lg border-t-4 border-r-4 border-emerald-400" />
                    <span className="absolute -bottom-0.5 -left-0.5 size-4 rounded-bl-lg border-b-4 border-l-4 border-emerald-400" />
                    <span className="absolute -right-0.5 -bottom-0.5 size-4 rounded-br-lg border-b-4 border-r-4 border-emerald-400" />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        {isIdTarget(target) && !still && (
          <ul className="rounded-lg border bg-muted/40 px-3 py-2 space-y-1">
            {ID_GUIDELINES.map((g) => (
              <li key={g} className="flex items-start gap-2 text-xs leading-snug text-muted-foreground">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-primary" />
                <span>{g}</span>
              </li>
            ))}
          </ul>
        )}
        {isIdTarget(target) && still && (
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs leading-snug text-muted-foreground">
            Check the preview: all corners visible and text readable. Press <span className="font-medium text-foreground">Retry</span> if blurry or cropped, otherwise <span className="font-medium text-foreground">Done</span>.
          </p>
        )}
        {captureError && (
          <p className="text-xs leading-snug text-destructive">{captureError}</p>
        )}
        <div className="flex items-center justify-end gap-2">
          {still ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setStill(null)}>
                Retry
              </Button>
              <Button size="sm" onClick={() => target && onDone(target, still)}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" className="gap-1.5" onClick={handleCapture}>
                <Camera className="size-3.5" />
                Capture Photo
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
