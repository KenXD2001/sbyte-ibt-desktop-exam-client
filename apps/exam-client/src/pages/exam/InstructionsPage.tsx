import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Undo2, ArrowRight, Clock, FileText, Hash, ShieldCheck } from "lucide-react";
import { candidateExamApi, type ExamInstructions, type ExamSessionCheck, type SessionQuestions, type VerificationStatus } from "@/services/api";
import { useToast } from "@/hooks/useToast";
import { useExamSession } from "@/contexts/ExamSessionContext";
import ExamSetupLoader, { type SetupStep } from "@/components/exam/ExamSetupLoader";
import { PreExamPauseGate, PreExamTerminatedGate } from "@/components/exam/ManualPauseScreens";
import { preloadAiProctorModels, preloadSfuClient } from "@/lib/preload-proctor";

const DEBUG = false;

interface DeviceInfo {
  geoLocation: string | undefined;
  ipAddress: string | undefined;
  userAgent: string;
  platform: string;
}

const IP_SERVICES = [
  "https://api.ipify.org?format=json",
  "https://ipinfo.io/json",
  "https://api.my-ip.io/v2/ip.json",
];

async function capturePublicIp(): Promise<string | undefined> {
  for (const url of IP_SERVICES) {
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
        if (err.code === err.PERMISSION_DENIED) {
          reject(new Error("Location access is required to start the exam. Please allow location access in your browser settings and try again."));
        } else if (err.code === err.TIMEOUT) {
          reject(new Error("Location request timed out. Please check your connection and try again."));
        } else {
          reject(new Error("Unable to determine your location. Please ensure GPS/location services are enabled."));
        }
      },
      { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false },
    );
  });
}

async function captureDeviceInfo(): Promise<DeviceInfo> {
  const [geoLocation, ipAddress] = await Promise.all([
    captureGeoLocation(),
    capturePublicIp(),
  ]);
  return {
    geoLocation,
    ipAddress,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
  };
}

function preloadQuestionImages(questions: SessionQuestions["questions"]) {
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

type PrerequisiteStatus = "pending" | "loading" | "success" | "error";

interface Prerequisites {
  instructions: PrerequisiteStatus;
  sessionCheck: PrerequisiteStatus;
  deviceInfo: PrerequisiteStatus;
}

export default function InstructionsPage() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const { showError } = useToast();
  const { setSessionId, startKioskFromGesture } = useExamSession();

  const [agreed, setAgreed] = useState(false);
  const [instructions, setInstructions] = useState<ExamInstructions | null>(null);
  const [starting, setStarting] = useState(false);
  const [sessionCheck, setSessionCheck] = useState<ExamSessionCheck | null>(null);
  const [reentryRequesting, setReentryRequesting] = useState(false);
  const [reentryRequested, setReentryRequested] = useState(false);
  const [deviceInfoError, setDeviceInfoError] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);

  // Kiosk is owned once by ExamSessionProvider (armed on Second Loading) —
  // this page never enters it directly; fullscreen also lives in kiosk.

  const [prereqs, setPrereqs] = useState<Prerequisites>({
    instructions: "loading",
    sessionCheck: "pending",
    deviceInfo: "success",
  });

  // ─── Staged setup loader (boot) ──────────────────────────────────────────
  // Everything the main exam needs is fetched here, in order, before the
  // instructions are shown. Labels stay in plain language for candidates.
  const [bootSteps, setBootSteps] = useState<SetupStep[]>([]);
  const [bootMessage, setBootMessage] = useState("Getting things ready…");
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootDone, setBootDone] = useState(false);
  const [bootRound, setBootRound] = useState(0);

  // ─── Submit overlay (saving before entering the main exam) ───────────────
  const [submitSteps, setSubmitSteps] = useState<SetupStep[]>([]);
  const [submitMessage, setSubmitMessage] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ─── Proctor streams live in ProctorMediaProvider; permissions + capture happen on the Verify step ─────────
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoPreviewRef = useRef<HTMLVideoElement | null>(null);
  void videoPreviewRef;
  void screenVideoPreviewRef;

  const randomizeRef = useRef(false);
  const randomizeOptionsRef = useRef(false);
  const questionDirectionRef = useRef('bidirectional');
  const prefetchedRef = useRef<SessionQuestions | null>(null);
  const verificationRef = useRef<VerificationStatus | null>(null);
  const startAttemptedRef = useRef(false);

  const updatePrereq = useCallback((key: keyof Prerequisites, status: PrerequisiteStatus) => {
    setPrereqs((prev) => ({ ...prev, [key]: status }));
  }, []);

  const normalizeMode = (m?: string | null) => (m || "").toLowerCase().replace(/_/g, "-");
  const examMode = normalizeMode(instructions?.examMode);
  const hasMediaFlags =
    instructions?.webcamScreenStreaming !== undefined ||
    instructions?.webcamRecording !== undefined ||
    instructions?.screenRecording !== undefined;
  const needsStreaming = hasMediaFlags
    ? instructions?.webcamScreenStreaming === true
    : examMode !== "" && examMode !== "normal";
  const needsCamera = hasMediaFlags
    ? needsStreaming || instructions?.webcamRecording === true
    : examMode !== "" && examMode !== "normal";
  const needsScreen = hasMediaFlags
    ? needsStreaming || instructions?.screenRecording === true
    : examMode !== "" && examMode !== "normal";
  // Verification (permissions + ID capture) only when some media is needed.
  const needsVerification = needsCamera || needsScreen;
  // Legacy mode flag kept for labels/rules that are mode-based.
  const isProctored = examMode !== "" && examMode !== "normal";
  const isAIProctor = examMode.includes("ai") || (instructions?.examType || "").toLowerCase().includes("ai");

  // ─── Staged boot: fetch everything the main exam needs, in order ──────
  // Data-only: the checkpoint list is built dynamically — exam details +
  // session always run (fresh session reads "Creating your exam session", an
  // existing one reads "Updating your exam session"); the rest are appended
  // only when they apply — device check, questions prefetch on resume,
  // secure-monitoring preload when proctored, previous verification on
  // proctored resume. Hardware/permission checks intentionally stay out of
  // boot: they run at proceed-time in the submit overlay, so instructions
  // are never blocked by camera/mic state.
  // Critical failures stop on the loader; warm-up failures are dropped from
  // the list — the exam steps retry them lazily.
  useEffect(() => {
    if (!examId) return;
    let cancelled = false;

    const setStep = (id: string, status: SetupStep["status"]) =>
      setBootSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
    const dropStep = (id: string) => setBootSteps((prev) => prev.filter((s) => s.id !== id));

    const runBoot = async () => {
      const startedAt = Date.now();
      setBootError(null);
      setBootDone(false);
      setBootMessage("Getting your exam ready…");
      setBootSteps([
        { id: "exam", label: "Getting your exam details", status: "active" },
        { id: "session", label: "Checking your exam session", status: "pending" },
      ]);
      updatePrereq("instructions", "loading");
      updatePrereq("sessionCheck", "pending");

      try {
        // 1. Exam details + instructions (critical — abort on failure).
        setBootMessage("Getting your exam details…");
        const data = await candidateExamApi.getExamInstructions(Number(examId));
        if (cancelled) return;
        setInstructions(data);
        randomizeRef.current = data.randomizeQuestions ?? false;
        randomizeOptionsRef.current = data.randomizeOptions ?? false;
        questionDirectionRef.current = data.questionDirection ?? 'bidirectional';
        updatePrereq("instructions", "success");
        setStep("exam", "done");

        const mode = normalizeMode(data.examMode);
        const hasFlags =
          data.webcamScreenStreaming !== undefined ||
          data.webcamRecording !== undefined ||
          data.screenRecording !== undefined;
        const streaming = hasFlags
          ? data.webcamScreenStreaming === true
          : mode !== "" && mode !== "normal";
        const needCam = hasFlags
          ? streaming || data.webcamRecording === true
          : mode !== "" && mode !== "normal";
        const needScr = hasFlags
          ? streaming || data.screenRecording === true
          : mode !== "" && mode !== "normal";
        const needVerify = needCam || needScr;
        const ai = (mode.includes("ai") || (data.examType || "").toLowerCase().includes("ai")) && needCam;

        // 2. Candidate session (critical — abort on failure).
        setBootMessage("Checking your exam session…");
        setStep("session", "active");
        updatePrereq("sessionCheck", "loading");
        const check = await candidateExamApi.getExamSession(Number(examId));
        if (cancelled) return;
        setSessionCheck(check);

        // Append only the steps that apply to this exam, before marking
        // the session step done so progress never jumps backwards.
        // Fresh session → we will create it; existing session → we update it.
        const resume = check.hasSession === true && !!check.sessionId;
        const sessionLabel = resume ? "Updating your exam session" : "Creating your exam session";
        const extra: SetupStep[] = [];
        if (data.deviceVerification) {
          extra.push({ id: "device", label: "Checking your device", status: "pending" });
        } else {
          updatePrereq("deviceInfo", "success");
        }
        if (resume) {
          extra.push({ id: "questions", label: "Getting your questions ready", status: "pending" });
        }
        if (needVerify) {
          extra.push({ id: "monitoring", label: "Preparing secure monitoring", status: "pending" });
        }
        if (needVerify && resume) {
          extra.push({ id: "verification", label: "Checking previous verification", status: "pending" });
        }
        setBootSteps((prev) =>
          prev.map((s) => (s.id === "session" ? { ...s, status: "done" as const, label: sessionLabel } : s)).concat(extra),
        );
        updatePrereq("sessionCheck", "success");

        // 3. Device check (blocking when the exam requires it).
        if (data.deviceVerification) {
          setBootMessage("Checking your device…");
          setStep("device", "active");
          updatePrereq("deviceInfo", "loading");
          try {
            const info = await captureDeviceInfo();
            if (cancelled) return;
            setDeviceInfo(info);
            setDeviceInfoError(null);
            updatePrereq("deviceInfo", "success");
            setStep("device", "done");
          } catch (err) {
            if (cancelled) return;
            const message =
              err instanceof Error ? err.message : "We couldn't verify this device. Please allow location access and try again.";
            setDeviceInfoError(message);
            updatePrereq("deviceInfo", "error");
            setStep("device", "error");
            setBootError(message);
            return;
          }
        }

        // 4. Questions prefetch for resume (warm-up — dropped on failure).
        if (resume && check.sessionId) {
          setBootMessage("Getting your questions ready…");
          setStep("questions", "active");
          try {
            const sessionData = await candidateExamApi.getSessionQuestions(check.sessionId);
            if (cancelled) return;
            prefetchedRef.current = sessionData;
            preloadQuestionImages(sessionData.questions);
            setStep("questions", "done");
          } catch {
            if (cancelled) return;
            dropStep("questions");
          }
        }

        // 5. Secure-monitoring preload: live-video lib when any media is
        // needed, plus monitoring assets when AI monitoring applies (warm-up).
        if (needVerify) {
          setBootMessage("Preparing secure monitoring…");
          setStep("monitoring", "active");
          try {
            await preloadSfuClient();
            if (ai) await preloadAiProctorModels();
            if (cancelled) return;
            setStep("monitoring", "done");
          } catch {
            if (cancelled) return;
            dropStep("monitoring");
          }
        }

        // 6. Previous verification for media-gated resume (warm-up).
        if (needVerify && resume && check.sessionId) {
          setBootMessage("Checking previous verification…");
          setStep("verification", "active");
          try {
            const v = await candidateExamApi.getVerification(check.sessionId);
            if (cancelled) return;
            verificationRef.current = v.verified ? v : null;
            setStep("verification", "done");
          } catch {
            if (cancelled) return;
            dropStep("verification");
          }
        }

        if (cancelled) return;
        // Keep the loader up for a beat so fast loads don't flicker and the
        // candidate actually sees every check reach Ready.
        const elapsed = Date.now() - startedAt;
        if (elapsed < 1200) {
          setBootMessage("You're all set!");
          await new Promise((r) => setTimeout(r, 1200 - elapsed));
          if (cancelled) return;
        }
        setBootMessage("You're all set!");
        setBootDone(true);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "We couldn't load your exam. Please check your connection and try again.";
        setBootSteps((prev) =>
          prev.map((s) => (s.status === "active" ? { ...s, status: "error" as const } : s)),
        );
        updatePrereq("instructions", "error");
        setBootError(message);
        if (DEBUG) console.error("[Instructions] boot failed:", message);
      }
    };

    void runBoot();
    return () => {
      cancelled = true;
    };
    // Re-run only when exam changes or the candidate retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId, bootRound]);

  const handleRequestReentry = useCallback(async () => {
    if (!examId) return;
    setReentryRequesting(true);
    try {
      await candidateExamApi.requestReentry(Number(examId));
      setReentryRequested(true);
      updatePrereq("sessionCheck", "loading");
      const check = await candidateExamApi.getExamSession(Number(examId));
      setSessionCheck(check);
      updatePrereq("sessionCheck", "success");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to submit re-entry request. Please try again after some time..");
    } finally {
      setReentryRequesting(false);
    }
  }, [examId, showError, updatePrereq]);

  const isResume = sessionCheck?.hasSession === true;
  const isManuallyPaused = sessionCheck?.isManuallyPaused === true;
  const isTerminated = /^(terminated|manual_terminate)$/i.test((sessionCheck as unknown as { status?: string })?.status ?? '');
  const isAlreadyAttempted = sessionCheck?.alreadyAttempted === true;
  const isReentryRequired = sessionCheck?.reentryRequired === true;
  const isReentryApproved = sessionCheck?.reentryStatus === 'approved';
  const hasPendingRequest = reentryRequested || sessionCheck?.reentryStatus === 'pending';
  const canStartExam = !isAlreadyAttempted && !isManuallyPaused && (!isReentryRequired || isReentryApproved);
  const canRequestReentry = !isManuallyPaused && isReentryRequired && !isReentryApproved && !hasPendingRequest;

  const allPrereqsMet = Object.values(prereqs).every((s) => s === "success");
  const prereqsLoading = Object.values(prereqs).some((s) => s === "loading" || s === "pending");
  const prereqsError = Object.values(prereqs).some((s) => s === "error");
  const anyDeviceFailed = !!instructions?.deviceVerification && prereqs.deviceInfo === "error";
  const deviceVerificationEnabled = !!instructions?.deviceVerification;

  const isButtonDisabled =
    starting ||
    reentryRequesting ||
    !agreed ||
    prereqsLoading ||
    prereqsError ||
    (!canRequestReentry && !canStartExam);

  // Normal mode: create session here and go straight to the exam.
  // Manual/AI proctor: session creation + identity capture happen on the Verify step.
  // The submit overlay shows preparation progress; failures stay on this
  // page inside the overlay — never navigate to /take on error.
  const handleStartNormalExam = useCallback(async () => {
    if (!examId || startAttemptedRef.current) return;

    if (!allPrereqsMet) {
      showError("Please wait for all checks to complete before starting the exam.");
      return;
    }

    if (anyDeviceFailed) {
      showError("Device verification failed. Please resolve the issue before starting.");
      return;
    }

    if (!canStartExam && !canRequestReentry) {
      showError("You cannot start this exam at this time.");
      return;
    }

    if (isAlreadyAttempted) {
      showError("You have already attempted this exam and cannot start it again.");
      return;
    }

    startAttemptedRef.current = true;
    setStarting(true);
    setSubmitError(null);
    setDeviceInfoError(null);
    setSubmitSteps([
      { id: "confirm", label: "Confirming your details", status: "active" },
      { id: "session", label: "Creating your exam session", status: "pending" },
      { id: "questions", label: "Getting your questions ready", status: "pending" },
      { id: "open", label: "Opening your exam", status: "pending" },
    ]);
    setSubmitMessage("Confirming your details…");
    const markSubmit = (id: string, status: SetupStep["status"]) =>
      setSubmitSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));

    const doRandomize = randomizeRef.current;
    const doRandomizeOptions = randomizeOptionsRef.current;
    const doExamDirection = questionDirectionRef.current;
    const doPrefetched = prefetchedRef.current;

    try {
      let finalDeviceInfo: DeviceInfo | null = deviceInfo;

      if (instructions?.deviceVerification && !finalDeviceInfo) {
        try {
          finalDeviceInfo = await captureDeviceInfo();
        } catch (err) {
          const message = err instanceof Error ? err.message : "We couldn't verify this device. Please allow location access and try again.";
          setDeviceInfoError(message);
          throw new Error(message);
        }
      }
      markSubmit("confirm", "done");

      setSubmitMessage("Creating your exam session…");
      markSubmit("session", "active");
      const session = await candidateExamApi.startExam(Number(examId), {
        geoLocation: finalDeviceInfo?.geoLocation,
        ipAddress: finalDeviceInfo?.ipAddress,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
      });
      if (!session?.sessionId) {
        throw new Error("We couldn't create your exam session. Please try again after some time..");
      }
      markSubmit("session", "done");

      setSubmitMessage("Getting your questions ready…");
      markSubmit("questions", "active");
      try {
        await candidateExamApi.initializeHotSession(session.sessionId, Number(examId), instructions?.duration ?? 0);
      } catch {
        // Hot session init is non-critical; exam flow continues.
      }

      let prefetchedData = doPrefetched;
      if (!prefetchedData) {
        try {
          prefetchedData = await candidateExamApi.getSessionQuestions(session.sessionId);
        } catch {
          // Prefetch failure is non-critical; ExamPage fetches as fallback.
        }
      }

      if (prefetchedData) preloadQuestionImages(prefetchedData.questions);
      markSubmit("questions", "done");

      setSessionId(session.sessionId);

      setSubmitMessage("Opening your exam…");
      markSubmit("open", "active");
      console.log("[Kiosk] starting normal exam — navigating to /take", {
        examId,
        sessionId: session.sessionId,
        kioskMode: instructions?.kioskMode ?? false,
      });
      markSubmit("open", "done");
      navigate(`/exam/${examId}/subjects`, {
        replace: true,
        state: {
          sessionId: session.sessionId,
          isResumed: session.isResumed ?? false,
          randomizeQuestions: doRandomize,
          randomizeOptions: doRandomizeOptions,
          questionDirection: doExamDirection,
          prefetchedSession: prefetchedData,
          tabSwitchDetection: session.tabSwitchDetection ?? instructions?.tabSwitchDetection ?? false,
          tabSwitchAction: session.tabSwitchAction ?? instructions?.tabSwitchAction ?? 'pause',
          tabSwitchAutoSubmitLimit: session.tabSwitchAutoSubmitLimit ?? instructions?.tabSwitchAutoSubmitLimit ?? 0,
          kioskMode: instructions?.kioskMode ?? false,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "We couldn't start your exam. Please try again after some time..";
      // A manual pause surfaces as a 403 from startExam — drop the overlay
      // and re-check the session so the blocked gate renders instead.
      if (/manually paused/i.test(message)) {
        setStarting(false);
        setSubmitSteps([]);
        startAttemptedRef.current = false;
        updatePrereq("sessionCheck", "loading");
        try {
          const check = await candidateExamApi.getExamSession(Number(examId));
          setSessionCheck(check);
          updatePrereq("sessionCheck", "success");
        } catch {
          updatePrereq("sessionCheck", "success");
          setSessionCheck((prev) => (prev ? { ...prev, isManuallyPaused: true } : { hasSession: true, isManuallyPaused: true }));
        }
        return;
      }
      setSubmitSteps((prev) =>
        prev.map((s) => (s.status === "active" ? { ...s, status: "error" as const } : s)),
      );
      setSubmitError(message);
      setStarting(true); // keep the overlay open on its error state
      startAttemptedRef.current = false;
    }
  }, [
    examId, navigate, showError, instructions, allPrereqsMet, anyDeviceFailed,
    canStartExam, canRequestReentry, isAlreadyAttempted, deviceInfo, setSessionId, updatePrereq,
  ]);

  const handleSubmitRetry = useCallback(() => {
    setSubmitError(null);
    setStarting(false);
    setSubmitSteps([]);
    // Re-run the start flow fresh.
    void handleStartNormalExam();
  }, [handleStartNormalExam]);

  const handleSubmitClose = useCallback(() => {
    setSubmitError(null);
    setStarting(false);
    setSubmitSteps([]);
  }, []);

  const handleAction = useCallback(() => {
    if (canRequestReentry) {
      handleRequestReentry();
    } else if (canStartExam) {
      if (needsVerification) {
        // No writes happen here: granting (camera/mic/screen) + identity
        // capture live on the Verify step, so we hand off instantly with
        // everything boot already prepared — Verify never refetches.
        console.log("[Kiosk] proctored exam — navigating to /verify", {
          examId,
          kioskMode: instructions?.kioskMode ?? false,
          examMode: instructions?.examMode,
        });
        navigate(`/exam/${examId}/verify`, {
          state: {
            instructions,
            sessionCheck,
            sessionId: sessionCheck?.sessionId,
            randomizeQuestions: randomizeRef.current,
            randomizeOptions: randomizeOptionsRef.current,
            questionDirection: questionDirectionRef.current,
            prefetchedSession: prefetchedRef.current,
            prefetchedVerification: verificationRef.current,
          },
        });
      } else {
        void handleStartNormalExam();
      }
    }
  }, [canRequestReentry, canStartExam, handleRequestReentry, needsVerification, examId, navigate, instructions, sessionCheck, handleStartNormalExam]);

  const bootProgress = bootSteps.length === 0
    ? 0
    : Math.round(
        (bootSteps.filter((s) => s.status === "done" || s.status === "skipped").length / bootSteps.length) * 100,
      );
  const submitProgress = submitSteps.length === 0
    ? 0
    : Math.round(
        (submitSteps.filter((s) => s.status === "done").length / submitSteps.length) * 100,
      );

  // Boot gate: show the setup loader until everything is ready. Failures
  // stay on the loader (Retry / Close) — instructions never half-render.
  if (!bootDone) {
    return (
      <ExamSetupLoader
        title="Setting up your exam"
        subtitle={instructions?.examTitle || "Please wait a moment"}
        steps={bootSteps}
        progress={bootError ? bootProgress : Math.max(bootProgress, bootSteps.some((s) => s.status === "active") ? 5 : 0)}
        currentMessage={bootError ? "We hit a problem" : bootMessage}
        error={bootError}
        onRetry={bootError ? () => setBootRound((r) => r + 1) : undefined}
        onClose={bootError ? () => window.close() : undefined}
      />
    );
  }

  // Terminated gate: the session was ended by the proctor — entry is blocked.
  if (bootDone && isTerminated) {
    return (
      <PreExamTerminatedGate
        examTitle={instructions?.examTitle}
        reason={null}
        onBack={() => navigate("/my-exams", { replace: true })}
      />
    );
  }

  // Manual-pause gate: the session is held by the proctor — entry is
  // blocked server-side, so replace the whole instructions card.
  if (bootDone && isManuallyPaused) {
    return (
      <PreExamPauseGate
        examTitle={instructions?.examTitle}
        onCheckAgain={() => setBootRound((r) => r + 1)}
        checking={prereqs.sessionCheck === "loading"}
        onBack={() => navigate("/my-exams", { replace: true })}
      />
    );
  }

  const actionButtonText = (() => {
    if (starting) return 'Starting Exam...';
    if (reentryRequesting) return 'Submitting Request...';
    if (prereqsLoading) return 'Verifying...';
    if (isAlreadyAttempted) return 'Already Attempted';
    if (isReentryApproved) return 'Resume Exam';
    if (hasPendingRequest) return 'Approval Pending';
    if (isReentryRequired) return 'Request Re-entry';
    if (isResume) return needsVerification ? 'Continue to Verification' : 'Resume Exam';
    return needsVerification ? 'Continue to Verification' : 'Start Exam';
  })();

  // ─── Exam-derived content only (no filler) ─────────────────────────────
  const stats = [
    { icon: Clock, label: "Duration", value: instructions ? `${instructions.duration} min` : "—" },
    { icon: Hash, label: "Questions", value: instructions ? String(instructions.totalQuestions) : "—" },
  ];

  const examRules: string[] = [];
  if (instructions) {
    examRules.push(`Timed exam of ${instructions.duration} minutes — answers auto-submit when time ends.`);
    if (instructions.tabSwitchDetection) {
      const action = instructions.tabSwitchAction === "terminate" ? "terminated" : "paused";
      const limit = (instructions.tabSwitchAutoSubmitLimit ?? 0) > 0
        ? ` (${instructions.tabSwitchAutoSubmitLimit} violation(s) auto-submit the exam)`
        : "";
      examRules.push(`Tab switching is monitored — the exam will be ${action} on tab change${limit}.`);
    }
    if (needsVerification) {
      const parts: string[] = [];
      if (needsCamera) parts.push("camera, microphone");
      if (needsScreen) parts.push("screen sharing");
      const modeLabel = examMode === "ai-manual-proctor"
        ? "AI + Manual-proctored"
        : isAIProctor
          ? "AI-proctored"
          : "Proctored";
      examRules.push(
        `${modeLabel} exam — ${parts.join(" and ")} ${parts.length > 1 ? "are" : "is"} required. Identity verification is the next step.`
      );
    }
    if (instructions.deviceVerification) {
      examRules.push("Location access and device details (IP, browser, platform) are captured for exam integrity.");
    }
  }

  const statusNote = (() => {
    if (isAlreadyAttempted) return { tone: "red", title: "Already attempted", text: "You have already submitted this exam and cannot start it again." };
    if (isReentryRequired && !isReentryApproved && hasPendingRequest) return { tone: "amber", title: "Approval pending", text: "Your re-entry request is under review. Please check back shortly." };
    if (isReentryRequired && !isReentryApproved) return { tone: "amber", title: "Active session found", text: "Auto-resume is disabled for this exam — request re-entry from the administrator to continue." };
    if (isReentryApproved) return { tone: "green", title: "Re-entry approved", text: "Your request was approved. You can resume the exam now." };
    return null;
  })();

  return (
    <div className="flex min-h-screen justify-center bg-muted/40 px-4 py-8">
      <Card className="w-full max-w-3xl h-fit overflow-hidden shadow-sm">
        {/* Compact header — exam identity only */}
        <CardHeader className="border-b bg-card px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <FileText className="size-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-lg leading-tight">{instructions?.examTitle || "Exam Instructions"}</CardTitle>
                {instructions?.subjectName && (
                  <Badge variant="outline" className="text-[11px] font-medium">{instructions.subjectName}</Badge>
                )}
                {isProctored && (
                  <Badge variant={isAIProctor ? "default" : "secondary"} className="gap-1 text-[11px]">
                    <ShieldCheck className="size-3" />
                    {isAIProctor ? "AI Proctored" : "Proctored"}
                  </Badge>
                )}
              </div>
              {instructions?.examDescription ? (
                <CardDescription className="mt-1 line-clamp-2 text-[13px]">{instructions.examDescription}</CardDescription>
              ) : (
                <CardDescription className="mt-1 text-[13px]">Read the instructions below, then confirm to begin.</CardDescription>
              )}
              {DEBUG && instructions && (
                <p className="mt-1 text-[11px] text-muted-foreground">DEBUG examMode: {instructions.examMode || "—"} | examType: {instructions.examType || "—"}</p>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 px-5 py-5">
          <>
            {/* Exam overview — real values only */}
              <section>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Exam overview</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {stats.map(({ icon: Icon, label, value }) => (
                    <div key={label} className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5">
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
              </section>

              {/* Authored instructions (backend HTML + image) */}
              {(instructions?.examInstructions || instructions?.examInstructionImage) && (
                <section>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Instructions</p>
                  {instructions?.examInstructions && (
                    <div
                      className="rounded-lg border bg-muted/30 px-3.5 py-3 text-[13px] leading-relaxed [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                      dangerouslySetInnerHTML={{ __html: instructions.examInstructions }}
                    />
                  )}
                  {instructions?.examInstructionImage && (
                    <img
                      src={instructions.examInstructionImage}
                      alt="Exam instruction"
                      className="mt-2 h-auto max-w-full rounded-lg border"
                    />
                  )}
                </section>
              )}

              {/* Rules derived from actual exam settings */}
              {examRules.length > 0 && (
                <section>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Rules & monitoring</p>
                  <ul className="rounded-lg border bg-card px-3.5 py-2.5 space-y-1.5">
                    {examRules.map((rule) => (
                      <li key={rule} className="flex items-start gap-2 text-[13px] leading-snug text-muted-foreground">
                        <span className="mt-[7px] size-1 shrink-0 rounded-full bg-primary" />
                        <span>{rule}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
          </>

          <Separator />

          {/* Inline readiness — everything was verified during setup */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Readiness</span>
            <PrereqInline label="Details" status={prereqs.instructions} />
            <PrereqInline label="Session" status={prereqs.sessionCheck} />
            {deviceVerificationEnabled && <PrereqInline label="Device" status={prereqs.deviceInfo} />}
          </div>

          {statusNote && (
            <div
              className={
                statusNote.tone === "red"
                  ? "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800"
                  : statusNote.tone === "amber"
                    ? "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800"
                    : "rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-green-800"
              }
            >
              <p className="text-[13px] font-medium">{statusNote.title}</p>
              <p className="mt-0.5 text-xs opacity-80">{statusNote.text}</p>
            </div>
          )}
          {deviceInfoError && deviceVerificationEnabled && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <p className="text-[13px] font-medium">Device verification failed</p>
              <p className="mt-0.5 text-xs opacity-80">{deviceInfoError}</p>
            </div>
          )}

          <div className="flex items-start gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5">
            <Checkbox
              id="agree"
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
              className="mt-0.5"
              disabled={prereqsLoading}
            />
            <Label htmlFor="agree" className="text-[13px] leading-snug text-muted-foreground">
              I have read the exam instructions and agree to follow the exam rules. I understand malpractice leads to disqualification.
            </Label>
          </div>

          <Button
            className="w-full gap-2"
            size="lg"
            disabled={isButtonDisabled}
            onClick={() => {
              // Second Loading opens from this click (normal path only —
              // proctored hands off to Verify, kiosk arms there): enter kiosk
              // incl. gesture fullscreen inside the click task.
              if (!needsVerification && instructions?.kioskMode) void startKioskFromGesture(true);
              handleAction();
            }}
          >
            {starting || reentryRequesting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isResume && canStartExam ? (
              <Undo2 className="size-4" />
            ) : (
              <ArrowRight className="size-4" />
            )}
            {actionButtonText}
          </Button>
        </CardContent>
      </Card>

      {/* Submit overlay: saving before the main exam (normal mode only —
          proctored hands off to Verify instantly). Errors stay here. */}
      {starting && (
        <ExamSetupLoader
          overlay
          title={isResume ? "Resuming your exam" : "Starting your exam"}
          subtitle={instructions?.examTitle}
          steps={submitSteps}
          progress={submitError ? submitProgress : Math.max(submitProgress, 5)}
          currentMessage={submitError ? "We hit a problem" : submitMessage || "Working…"}
          error={submitError}
          onRetry={submitError ? handleSubmitRetry : undefined}
          onClose={submitError ? handleSubmitClose : undefined}
        />
      )}
    </div>
  );
}

function PrereqInline({ label, status }: { label: string; status: PrerequisiteStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {status === "loading" || status === "pending" ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : status === "success" ? (
        <CheckCircle2 className="size-3.5 text-emerald-600" />
      ) : (
        <XCircle className="size-3.5 text-red-600" />
      )}
      {label}
      <span className={status === "success" ? "font-medium text-emerald-600" : status === "error" ? "font-medium text-red-600" : ""}>
        {status === "success" ? "· Ready" : status === "error" ? "· Failed" : "· Checking"}
      </span>
    </span>
  );
}
