import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useExam } from "@/hooks/useExam";
import { useTimer } from "@/hooks/useTimer";
import { useExamSession } from "@/contexts/ExamSessionContext";
import { ExamLayout } from "@/components/exam/ExamLayout";
import type { ProctorChatMessage } from "@/components/exam/ProctorSidePanel";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { candidateExamApi, candidateChatApi, type SessionQuestions, type ExamInstructions, type SubmitType, type ExamChatMessage, type ExamSubjectInfo, type ExamSectionConfig } from "@/services/api";
import { isTauriEnv, lockdownStatus } from "@/services/tauri/commands";
import { requestKioskFullscreenNow } from "@/hooks/useKioskMode";
import type { ExamSectionId } from "@/components/exam/ExamSections";
import type { ExamData, ExamQuestion } from "@/types/exam";
import { shuffle } from "@/lib/utils";
import { useAIProctorMonitor } from "@/hooks/useAIProctorMonitor";
import { useManualFlagAlert } from "@/hooks/useManualFlagAlert";
import { useProctorMedia } from "@/contexts/ProctorMediaContext";
import { toast } from "sonner";
import { AudioLines, Maximize, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MidExamPauseOverlay, PreExamPauseGate, TerminatedScreen, PreExamTerminatedGate, ExamResetScreen, ManualSubmittedScreen, ExamRefreshScreen } from "@/components/exam/ManualPauseScreens";

function mapApiQuestions(session: SessionQuestions, opts: { shuffleQuestions: boolean; shuffleOptions: boolean; subjectId?: number | null }): ExamQuestion[] {
  // Multi-subject exam: only this subject's questions (legacy rows with no
  // subjectId fall through to the full list). Filter BEFORE numbering so the
  // subject's questions are numbered continuously from 1.
  const scoped = opts.subjectId != null && session.questions.some((q) => q.subjectId != null)
    ? session.questions.filter((q) => q.subjectId === opts.subjectId)
    : session.questions;
  let questions = scoped.map((q) => {
    const baseOptions = opts.shuffleOptions ? shuffle(q.options) : q.options;
    const options = baseOptions.map((o, i) => ({
      ...o,
      label: String.fromCharCode(65 + i),
    }));
    const normalizedType = String(q.questionType ?? "").trim().toLowerCase();
    return {
      id: q.id,
      questionNumber: q.questionNumber,
      questionType: (normalizedType.includes("subject") ? "subjective" : "mcq") as "mcq" | "subjective",
      sectionName: "",
      subjectId: q.subjectId ?? null,
      questionText: q.questionText,
      options,
      marks: q.marks,
      negativeMarks: q.negativeMarks,
      selectedAnswer: q.selectedAnswer,
      submitType: q.submitType,
      correctOption: q.correctOption,
    };
  });

  if (opts.shuffleQuestions) {
    questions = shuffle(questions);
  }

  // Stable identity stays continuous (1..N per subject) for state + server.
  // Display restarts per section: MCQ 1..N, Subjective 1..M.
  const numbered = questions.map((q, index) => ({ ...q, questionNumber: index + 1 }));
  const perSection: Record<string, number> = {};
  return numbered.map((q) => {
    const key = q.questionType === 'subjective' ? 'subjective' : 'mcq';
    perSection[key] = (perSection[key] ?? 0) + 1;
    return { ...q, displayNumber: perSection[key] };
  });
}

interface ExamPageLocationState {
  sessionId?: number;
  prefetchedSession?: SessionQuestions | null;
  randomizeQuestions?: boolean;
  randomizeOptions?: boolean;
  questionDirection?: string;
  tabSwitchDetection?: boolean;
  tabSwitchAction?: 'terminate' | 'pause';
  tabSwitchAutoSubmitLimit?: number;
  kioskMode?: boolean;
  selectedSubjectId?: number | null;
  selectedSubjectName?: string;
  subjects?: ExamSubjectInfo[];
  sectionConfig?: ExamSectionConfig;
  subjectStartedAt?: string;
  subjectCompletedSections?: string[];
}

export default function ExamPage() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as ExamPageLocationState | null;
  const navSessionId = state?.sessionId;
  const prefetchedSession = state?.prefetchedSession;
  const navRandomize = state?.randomizeQuestions;

  const { setSessionId: setCtxSessionId, disconnect: disconnectExamSocket, armKiosk, kioskArmed, kioskSuppressed, kioskFullscreen: isFullscreen, requestKioskFullscreen: requestFullscreen, setOnKioskViolation } = useExamSession();
  const [resolvedSessionId, setResolvedSessionId] = useState<number | undefined>(navSessionId);
  const sessionId = resolvedSessionId;

  const [sessionData, setSessionData] = useState<SessionQuestions | null>(prefetchedSession ?? null);
  // Shuffle intent survives refresh via the server echo (nav state is lost).
  const randomizeQuestions = navRandomize ?? sessionData?.randomizeQuestions ?? false;
  const [navRandomizeOptions] = useState(state?.randomizeOptions);
  const [navExamDirection] = useState(state?.questionDirection);
  // Randomize Options shuffles options; Randomize Questions shuffles question
  // order (and options too, preserving the legacy behavior for older exams).
  const randomizeOptions = navRandomizeOptions ?? sessionData?.randomizeOptions ?? false;
  const shuffleOptions = randomizeOptions || randomizeQuestions;
  const questionDirection = navExamDirection ?? sessionData?.questionDirection ?? "bidirectional";
  const isUnidirectional = questionDirection === "unidirectional";
  const [loading, setLoading] = useState(!prefetchedSession);
  const [error, setError] = useState<string | null>(null);
  const [showSubmitAlert, setShowSubmitAlert] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [instructions, setInstructions] = useState<ExamInstructions | null>(null);
  const [loadingInstructions, setLoadingInstructions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isManualPause, setIsManualPause] = useState(false);
  const [manualPauseReason, setManualPauseReason] = useState<string | null>(null);
  const [isTerminated, setIsTerminated] = useState(false);
  const [terminatedReason, setTerminatedReason] = useState<string | null>(null);
  const [, setTerminatedAt] = useState<number | null>(null);
  const [isReset, setIsReset] = useState(false);
  const [resetReason, setResetReason] = useState<string | null>(null);
  const [, setResetAt] = useState<number | null>(null);
  const [isManualSubmitted, setIsManualSubmitted] = useState(false);
  const [manualSubmitReason, setManualSubmitReason] = useState<string | null>(null);
  const [, setManualSubmittedAt] = useState<number | null>(null);
  const [isExamResetAll, setIsExamResetAll] = useState(false);
  const [examResetAllReason, setExamResetAllReason] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isMarking, setIsMarking] = useState(false);
  // Multi-subject / sections flow (from the subjects step; null = legacy single flow).
  const [navSubjectId] = useState(state?.selectedSubjectId ?? null);
  const [navSubjects] = useState(state?.subjects ?? null);
  const [navSectionConfig] = useState(state?.sectionConfig ?? null);
  const [subjectsState, setSubjectsState] = useState<ExamSubjectInfo[] | null>(null);
  const [sectionConfigState, setSectionConfigState] = useState<ExamSectionConfig | null>(null);
  const [subjectStartedAt, setSubjectStartedAt] = useState<string | null>(state?.subjectStartedAt ?? null);
  const [activeSection, setActiveSection] = useState<ExamSectionId | 'all'>('all');
  const [completedSections, setCompletedSections] = useState<Set<ExamSectionId>>(
    () => new Set((state?.subjectCompletedSections ?? []).filter(
      (s): s is ExamSectionId => s === 'mcq' || s === 'subjective',
    )),
  );
  const [sectionsHydrated, setSectionsHydrated] = useState(
    () => state?.subjectCompletedSections !== undefined,
  );
  const [submittingSection, setSubmittingSection] = useState(false);
  const [showSubjectSubmitAlert, setShowSubjectSubmitAlert] = useState(false);
  const [isSubmittingSubject, setIsSubmittingSubject] = useState(false);
  const [budgetTick, setBudgetTick] = useState(0);
  const sectionEnteredRef = useRef<number>(Date.now());
  const autoFiredRef = useRef<{ section: string | null; subject: boolean }>({ section: null, subject: false });
  const submitSectionRef = useRef<(auto?: boolean) => void>(() => {});
  const submitSubjectRef = useRef<(auto?: boolean) => void>(() => {});
  const [examMode, setExamMode] = useState<string | null>(null);
  const [verificationImageUrl, setVerificationImageUrl] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ProctorChatMessage[]>([]);

  const tabSwitchCountRef = useRef(0);
  // Bridge: the exam-flow kiosk forwards focus-loss violations here so they
  // run through the SAME pipeline as tab switches (report + count toward
  // pause/auto-submit per exam settings), not just a toast.
  const countViolationRef = useRef<(reason: string) => void>(() => {});
  // Mirror of the context's emergency-exit latch. While set, every violation
  // source (tab switch / blur / fullscreen-exit / kiosk focus-loss) is ignored:
  // the release is proctor-authorized, so the churn it causes must not be
  // charged to the candidate (report + pause/auto-submit).
  const kioskSuppressedRef = useRef(false);
  kioskSuppressedRef.current = kioskSuppressed;
  const questionsFetchedRef = useRef(false);
  const serverEndTimeRef = useRef<number | null>(null);
  const wsRef = useRef<{ notifyExamSubmitted: () => void; reportTabSwitch: () => void } | null>(null);
  const timerAutoStartedRef = useRef(false);
  const submittedViaRef = useRef(false);
  const submitAbortRef = useRef<AbortController | null>(null);
  const { stopAll: stopProctorMedia, stopExamRecording, proctorAudioStream, proctorMuted, audioBlocked, unlockProctorAudio } = useProctorMedia();
  const hasProctorAudio = !proctorMuted && !!proctorAudioStream && proctorAudioStream.getAudioTracks().some(t => t.readyState === 'live' && t.enabled);
  const announceVisible = hasProctorAudio && !isExpired && !isPaused && !isTerminated && !isReset;

  const tabSwitchDetection = state?.tabSwitchDetection ?? sessionData?.tabSwitchDetection ?? false;
  const tabSwitchAction = state?.tabSwitchAction ?? sessionData?.tabSwitchAction ?? 'pause';
  const tabSwitchAutoSubmitLimit = state?.tabSwitchAutoSubmitLimit ?? sessionData?.tabSwitchAutoSubmitLimit ?? 0;
  const kioskMode = state?.kioskMode ?? sessionData?.kioskMode ?? false;

  // AI-proctor monitoring (MediaPipe, on-device) — runs only for AI modes
  // (ai-proctor, ai-manual-proctor) with camera needed, while the session is
  // live. Consumes the shared camera stream, toasts violations and persists
  // flags with camera+screen snapshots.
  const normalizedExamMode = (examMode || "").toLowerCase().replace(/_/g, "-");
  const hasMediaFlags =
    instructions?.webcamScreenStreaming !== undefined ||
    instructions?.webcamRecording !== undefined ||
    instructions?.screenRecording !== undefined;
  const needsStreamingForMonitor = hasMediaFlags
    ? instructions?.webcamScreenStreaming === true
    : normalizedExamMode !== "" && normalizedExamMode !== "normal";
  const needsCameraForMonitor = hasMediaFlags
    ? needsStreamingForMonitor || instructions?.webcamRecording === true
    : normalizedExamMode !== "" && normalizedExamMode !== "normal";
  const isAIProctor = normalizedExamMode.includes("ai") && needsCameraForMonitor;
  const { aiStatus, identityReady } = useAIProctorMonitor({
    enabled: isAIProctor && !!sessionId && !isExpired && !isPaused && !isTerminated && !isReset && !isSubmitting,
    sessionId,
    verificationImageUrl,
  });

  // Manual-proctor flags raised from the live dashboard: toast the alert and
  // upload camera + screen proof frames (fires only on server push).
  useManualFlagAlert(sessionId);

  // Debug: trace where kioskMode comes from and how it resolves.
  useEffect(() => {
    console.log("[Kiosk:take] ExamPage kiosk state", {
      examId,
      sessionId,
      fromNavigationState: state?.kioskMode,
      fromSessionApi: sessionData?.kioskMode,
      resolvedKioskMode: kioskMode,
      loading,
      hasExamData: !!sessionData,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally logs on each contributing value change
  }, [examId, sessionId, state?.kioskMode, sessionData?.kioskMode, kioskMode, loading, !!sessionData]);

  // Questions fetch with paused-session recovery: a resumed (e.g. tab-switch
  // paused) session rejects getSessionQuestions with "Session is not active".
  // startExam transitions paused → in-progress server-side, so retry once through it.
  const loadQuestionsWithResume = useCallback(async (sid: number): Promise<SessionQuestions> => {
    try {
      const data = await candidateExamApi.getSessionQuestions(sid);
      setCtxSessionId(sid);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!examId || !/not active|paused/i.test(msg)) throw err;
      console.log("[Exam] session not active — resuming via startExam and retrying questions");
      const resumed = await candidateExamApi.startExam(Number(examId), {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
      });
      if (!resumed?.sessionId) throw err;
      setResolvedSessionId(resumed.sessionId);
      setCtxSessionId(resumed.sessionId);
      return candidateExamApi.getSessionQuestions(resumed.sessionId);
    }
  }, [examId, setCtxSessionId]);

  useEffect(() => {
    if (prefetchedSession) {
      if (navSessionId) {
        setResolvedSessionId(navSessionId);
        setCtxSessionId(navSessionId);
      }
      return;
    }

    if (resolvedSessionId) {
      if (questionsFetchedRef.current) return;
      questionsFetchedRef.current = true;

      loadQuestionsWithResume(resolvedSessionId)
        .then((data) => {
          setSessionData(data);
          setLoading(false);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : "Failed to load exam session.";
          if (/manual_submit|submitted by the proctor/i.test(msg)) {
            setIsManualSubmitted(true);
            setManualSubmitReason(msg.replace(/^.*(manual_submit|submitted by the proctor)[:\s]*/i, "") || null);
            setManualSubmittedAt(Date.now());
            timerControlsRef.current.pause();
            setLoading(false);
            return;
          }
          if (/manual_terminate|terminated/i.test(msg)) {
            setIsTerminated(true);
            setTerminatedReason(msg.replace(/^.*(manual_terminate|terminated)[:\s]*/i, "") || null);
            setTerminatedAt(Date.now());
            timerControlsRef.current.pause();
            setLoading(false);
            return;
          }
          setError(msg);
          setLoading(false);
        });
      return;
    }

    // Refresh / direct-open fallback: resolve the active session from the server.
    if (!examId) {
      setError("No active exam session found. Please start the exam from the instructions page.");
      setLoading(false);
      return;
    }
    if (questionsFetchedRef.current) return;
    questionsFetchedRef.current = true;

    candidateExamApi.getExamSession(Number(examId))
      .then((check) => {
        if (check.alreadyAttempted) {
          navigate(`/exam/${examId}/result`, { replace: true });
          return Promise.reject(new Error("__submitted_handled__"));
        }
        if (/^(terminated|manual_terminate)$/i.test(check.status ?? '') || /^(terminated|manual_terminate)$/i.test((check as unknown as { alreadyAttempted?: boolean; status?: string })?.status ?? '')) {
          setIsTerminated(true);
          setTerminatedReason(null);
          setTerminatedAt(Date.now());
          timerControlsRef.current.pause();
          setLoading(false);
          // Don't proceed to questions — show terminated gate.
          return Promise.reject(new Error("__terminated_handled__"));
        }
        if (/(^|_)manual_submit$/i.test(check.status ?? '') || /(^|_)manual_submit$/i.test((check as unknown as { alreadyAttempted?: boolean; status?: string })?.status ?? '')) {
          setIsManualSubmitted(true);
          setManualSubmitReason(null);
          setManualSubmittedAt(Date.now());
          timerControlsRef.current.pause();
          setLoading(false);
          // Don't proceed to questions — show submitted screen.
          return Promise.reject(new Error("__manual_submit_handled__"));
        }
        if (!check.hasSession || !check.sessionId) {
          throw new Error("No active exam session found. Please start the exam from the instructions page.");
        }
        if (check.isManuallyPaused) {
          throw new Error("Your exam has been manually paused by the proctor. Please contact the examination administrator.");
        }
        setResolvedSessionId(check.sessionId);
        setCtxSessionId(check.sessionId);
        return loadQuestionsWithResume(check.sessionId);
      })
      .then((data) => {
        if (!data) return;
        setSessionData(data);
        setLoading(false);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Failed to load exam session.";
        if (msg === "__terminated_handled__") return;
        if (msg === "__manual_submit_handled__") return;
        if (msg === "__submitted_handled__") return;
        if (/manual_submit|submitted by the proctor/i.test(msg)) {
          setIsManualSubmitted(true);
          setManualSubmitReason(msg.replace(/^.*(manual_submit|submitted by the proctor)[:\s]*/i, "") || null);
          setManualSubmittedAt(Date.now());
          timerControlsRef.current.pause();
          setLoading(false);
          return;
        }
        if (/manual_terminate|terminated/i.test(msg)) {
          setIsTerminated(true);
          setTerminatedReason(msg.replace(/^.*(manual_terminate|terminated)[:\s]*/i, "") || null);
          setTerminatedAt(Date.now());
          timerControlsRef.current.pause();
          setLoading(false);
          return;
        }
        setError(msg);
        setLoading(false);
      });
  }, [resolvedSessionId, navSessionId, prefetchedSession, examId, setCtxSessionId, loadQuestionsWithResume, navigate]);

  useEffect(() => {
    if (!showInstructions || !examId || instructions) return;
    setLoadingInstructions(true);
    candidateExamApi.getExamInstructions(Number(examId))
      .then((data) => {
        setInstructions(data);
        setExamMode((prev) => prev ?? data.examMode ?? "normal");
      })
      .catch(() => {})
      .finally(() => setLoadingInstructions(false));
  }, [showInstructions, examId, instructions]);

  // Exam mode drives the layout (normal vs manual/AI proctor). Fetch once per exam.
  // Data-only probe — not a candidate view, so it must not log a
  // "Viewed exam instructions" row after "Started exam" in the timeline.
  useEffect(() => {
    if (!examId || examMode !== null) return;
    let cancelled = false;
    candidateExamApi.getExamInstructions(Number(examId), { logView: false })
      .then((data) => {
        if (cancelled) return;
        setExamMode(data.examMode ?? "normal");
        setInstructions((prev) => prev ?? data);
      })
      .catch(() => {
        if (!cancelled) setExamMode("normal");
      });
    return () => { cancelled = true; };
  }, [examId, examMode]);

  // Verification capture for the left sidebar identity photo (proctored modes).
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    candidateExamApi.getVerification(sessionId)
      .then((v) => {
        if (!cancelled && v.webcamImageUrl) setVerificationImageUrl(v.webcamImageUrl);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId]);

  const examData = useMemo((): ExamData | null => {
    if (!sessionData) return null;
    const questions = mapApiQuestions(sessionData, { shuffleQuestions: randomizeQuestions, shuffleOptions, subjectId: navSubjectId });
    const data: ExamData = {
      id: Number(examId) || sessionData.examId,
      title: sessionData.examTitle,
      description: "",
      duration: sessionData.duration,
      startDateTime: new Date(sessionData.examStartedAt).toISOString(),
      endDateTime: new Date(
        new Date(sessionData.examStartedAt).getTime() + sessionData.duration * 60000
      ).toISOString(),
      questions,
      currentStatus: "in-progress",
      candidateName: sessionData.candidateName || "",
      candidateRollNumber: sessionData.candidateRollNumber || "",
      subjectName: state?.selectedSubjectName ?? "",
    };
    return data;
  }, [sessionData, examId, randomizeQuestions, shuffleOptions, navSubjectId, state?.selectedSubjectName]);

  const hookResult = useExam(examData?.questions ?? []);
  const {
    currentQuestion,
    totalQuestions,
    progress,
    selectedOption,
    isMarkedForReview,
    getQuestionStatus,
    selectOption,
    confirmSubmission,
    clearResponse,
    toggleMarkForReview,
    goToQuestion,
    selections,
    submittedAnswers,
    markedForReview,
  } = hookResult;

  // ---- Multi-subject sections flow ----
  const subjectsList = navSubjects ?? subjectsState;
  const sectionConfig = navSectionConfig ?? sectionConfigState;
  const multiSubjectFlow = (subjectsList?.length ?? 0) > 1;
  const restricted = sectionConfig?.sectionDirection === 'restrict_switching';

  const sections = useMemo(() => {
    const list = examData?.questions ?? [];
    const out: { id: ExamSectionId; label: string; count: number }[] = [];
    const mcq = list.filter((q) => q.questionType !== 'subjective').length;
    const subj = list.filter((q) => q.questionType === 'subjective').length;
    if (mcq > 0) out.push({ id: 'mcq', label: 'Multiple Choice', count: mcq });
    if (subj > 0) out.push({ id: 'subjective', label: 'Subjective', count: subj });
    return out;
  }, [examData]);

  // Restricted exams work sections strictly in order, skipping sections
  // already submitted (restored after refresh). Free exams show all.
  useEffect(() => {
    if (!restricted || sections.length === 0) return;
    if (activeSection !== 'all' && !completedSections.has(activeSection)) return;
    const firstOpen = sections.find((s) => !completedSections.has(s.id))
      ?? sections[sections.length - 1];
    if (activeSection !== firstOpen.id) {
      setActiveSection(firstOpen.id);
      sectionEnteredRef.current = Date.now();
    }
  }, [restricted, sections, completedSections, activeSection]);

  const visibleQuestions = useMemo(() => {
    const list = examData?.questions ?? [];
    if (restricted || activeSection === 'all') {
      if (restricted) return list.filter((q) => (q.questionType === 'subjective' ? 'subjective' : 'mcq') === activeSection);
      return list;
    }
    return list.filter((q) => (q.questionType === 'subjective' ? 'subjective' : 'mcq') === activeSection);
  }, [examData, restricted, activeSection]);

  const visibleIndex = useMemo(
    () => visibleQuestions.findIndex((q) => q.questionNumber === currentQuestion?.questionNumber),
    [visibleQuestions, currentQuestion],
  );
  const visibleHasNext = visibleIndex >= 0 && visibleIndex < visibleQuestions.length - 1;
  const visibleHasPrev = visibleIndex > 0;

  const goVisible = useCallback((index: number) => {
    const target = visibleQuestions[index];
    if (target) goToQuestion(target.questionNumber);
  }, [visibleQuestions, goToQuestion]);

  const sectionOf = useCallback((questionNumber: number): ExamSectionId => {
    const q = examData?.questions.find((qq) => qq.questionNumber === questionNumber);
    return q?.questionType === 'subjective' ? 'subjective' : 'mcq';
  }, [examData]);

  const handleSelectSection = useCallback((id: ExamSectionId) => {
    if (restricted) {
      toast.info("Sections are locked in order — submit this section to continue.");
      return;
    }
    setActiveSection((prev) => (prev === id ? 'all' : id));
    const list = examData?.questions ?? [];
    const first = list.find((q) => (q.questionType === 'subjective' ? 'subjective' : 'mcq') === id);
    if (first && sectionOf(currentQuestion?.questionNumber ?? -1) !== id) {
      goToQuestion(first.questionNumber);
    }
  }, [restricted, examData, currentQuestion, sectionOf, goToQuestion]);

  // Flush locally selected but never-saved answers to the server before
  // any submit — clicking an option then Submit without Save & Next must
  // not silently drop the answer.
  const flushDirtySelections = useCallback(async () => {
    if (!sessionId || !examData) return;
    const dirty = examData.questions.filter((q) => {
      const sel = selections[q.questionNumber];
      return sel != null && sel !== '' && submittedAnswers[q.questionNumber] !== sel;
    });
    if (dirty.length === 0) return;
    await Promise.allSettled(dirty.map((q) => {
      const answer = selections[q.questionNumber];
      const submitType: SubmitType = markedForReview.has(q.questionNumber)
        ? 'marked_review'
        : 'normal_submit';
      return candidateExamApi.submitAnswer(
        sessionId,
        q.id,
        answer,
        submitType,
        { fromQuestionNumber: q.questionNumber, toQuestionNumber: q.questionNumber },
      ).then(() => confirmSubmission(q.questionNumber, answer));
    }));
  }, [sessionId, examData, selections, submittedAnswers, markedForReview, confirmSubmission]);

  const navigateToResult = useCallback(() => {
    const questions = examData?.questions ?? [];
    const correctAnswerKey: Record<number, string> = {};
    for (const q of questions) {
      if (q.correctOption) {
        correctAnswerKey[q.questionNumber] = `${q.id}-${q.correctOption.toLowerCase()}`;
      }
    }

    navigate(`/exam/${examId}/result`, {
      replace: true,
      state: {
        answers: submittedAnswers,
        questions,
        candidateName: examData?.candidateName ?? "",
        candidateRollNumber: examData?.candidateRollNumber ?? "",
        examTitle: examData?.title ?? "",
        subjectName: examData?.subjectName ?? "",
        correctAnswerKey,
      },
    });
  }, [navigate, examId, submittedAnswers, examData]);

  const navigateToResultRef = useRef(navigateToResult);
  navigateToResultRef.current = navigateToResult;

  const submitExamToServer = useCallback(async () => {
    if (submittedViaRef.current) return;
    submittedViaRef.current = true;
    setIsSubmitting(true);
    // Exam boundary marker (joins with SFU stop + DB rows by exam+session).
    console.info(`[SAT:EXAM] submit exam=${examId} session=${sessionId}`);
    // Flush unsaved selections first so nothing selected is lost, then run
    // the existing submit flow.
    await flushDirtySelections().catch(() => {});
    // Stop proctor media + finalize the exam recording (S3 + DB queued server-side)
    void stopExamRecording();
    stopProctorMedia();
    wsRef.current?.notifyExamSubmitted();
    if (sessionId) {
      // Single-source-of-truth race resolution:
      // 1) The WS submit notify above marks the session in Redis.
      // 2) The REST submit below hits the candidate-exam endpoint with a
      //    *deterministic* idempotency key (`exam-session-<id>:submit`)
      //    and a per-request AbortController.
      // 3) If the WS-driven REST FAILED before the user invokes this
      //    handler (e.g. the server returned force-submit first), the
      //    force-submit handler below already navigated.
      // 4) Otherwise the client waits at most ~1.5 s for the REST to
      //    complete; if a server force-submit arrives in that window we
      //    cancel the REST and navigate immediately.
      let cancelled = false;
      const ac = new AbortController();
      submitAbortRef.current = ac;

      const guardTimer = window.setTimeout(() => {
        if (!cancelled) {
          cancelled = true;
          ac.abort();
          navigateToResult();
        }
      }, 1500);

      candidateExamApi
        .submitExam(sessionId, { signal: ac.signal })
        .then(() => {
          if (cancelled) return;
          clearTimeout(guardTimer);
          navigateToResult();
        })
        .catch((err) => {
          if (cancelled) return;
          if (err?.name === 'AbortError') return;
          // 4xx because the server already marked the session complete
          // (WS won the race) is fine — still navigate to result.
          clearTimeout(guardTimer);
          navigateToResult();
        });
    } else {
      setTimeout(navigateToResult, 1500);
    }
    }, [navigateToResult, examId, sessionId, stopProctorMedia, stopExamRecording, flushDirtySelections]);

  const handleTimeUp = useCallback(() => {
    submitExamToServer();
  }, [submitExamToServer]);

  const timerControls = useTimer({
    initialTime: sessionData?.duration ? sessionData.duration * 60 : 0,
    endsAt: null,
    onTimeUp: handleTimeUp,
    autoStart: false,
  });
  const { formattedTime, isLowTime, isCriticalTime } = timerControls;

  const timerControlsRef = useRef(timerControls);
  timerControlsRef.current = timerControls;
  const isPausedRef = useRef(isPaused);
  const isExpiredRef = useRef(isExpired);
  const isTerminatedRef = useRef(isTerminated);
  const isResetRef = useRef(isReset);
  const isManualSubmittedRef = useRef(isManualSubmitted);
  const isExamResetAllRef = useRef(isExamResetAll);
  isPausedRef.current = isPaused;
  isExpiredRef.current = isExpired;
  isTerminatedRef.current = isTerminated;
  isResetRef.current = isReset;
  isManualSubmittedRef.current = isManualSubmitted;
  isExamResetAllRef.current = isExamResetAll;

  // Reliable startup: the wall-clock budget is known as soon as
  // sessionData loads (examStartedAt + duration + allotted extra time).
  // Don't wait for the WS session_restored which may race the socket or
  // be delayed.
  useEffect(() => {
    if (!sessionData || isPaused || isTerminated || isReset || isExpired || isSubmitting || isManualSubmittedRef.current) return;
    if (timerAutoStartedRef.current) return;
    const startedAt = new Date(sessionData.examStartedAt).getTime();
    if (Number.isNaN(startedAt)) return;
    const durationMs = (sessionData.duration ?? 0) * 60 * 1000;
    if (durationMs <= 0) return;
    const extraMs = (sessionData.totalExtraSeconds ?? 0) * 1000;
    const remainingSec = Math.max(0, Math.ceil((startedAt + durationMs + extraMs - Date.now()) / 1000));
    if (remainingSec <= 0) {
      // Deadline already passed (e.g. page opened after expiry) — submit
      // instead of stranding the candidate on a dead 00:00 page.
      setIsExpired(true);
      timerControlsRef.current.pause();
      void submitExamToServer();
      return;
    }
    timerControlsRef.current.reset(remainingSec);
    timerControlsRef.current.start();
    timerAutoStartedRef.current = true;
  }, [sessionData, isPaused, isTerminated, isReset, isExpired, isSubmitting, submitExamToServer]);

  const ws = useExamSession();

  // Live proctor chat: socket-first when both are inside the exam room,
  // DB-backed history otherwise. Every message is persisted server-side;
  // sent/delivered/seen ticks travel over the socket.
  const myRoll = sessionData?.candidateRollNumber ?? null;
  const examNumericId = Number(examId) || sessionData?.examId || null;
  const chatPendingRef = useRef<Map<string, string>>(new Map());
  const myRollRef = useRef<string | null>(null);
  myRollRef.current = myRoll;

  const mapRowToUi = useCallback(
    (row: ExamChatMessage): ProctorChatMessage => {
      const mine = !!myRollRef.current && String(row.senderId) === String(myRollRef.current);
      return {
        id: String(row.id),
        sender: mine ? "candidate" : "proctor",
        text: row.messageText,
        timestamp: row.createdAt,
        status: mine ? (row.seen ? "read" : row.delivered ? "delivered" : "sent") : undefined,
      };
    },
    [],
  );

  const handleSendChat = useCallback((text: string) => {
    const body = text.trim();
    if (!body || !examNumericId) return;
    const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const msg: ProctorChatMessage = {
      id: localId,
      sender: "candidate",
      text: body,
      timestamp: new Date().toISOString(),
      status: "sent",
    };
    setChatMessages((prev) => [...prev, msg]);
    const clientMessageId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : localId;
    chatPendingRef.current.set(clientMessageId, localId);
    // WS-first only when the exam socket is live — otherwise `sendJson`
    // queues into the outbox and the REST fallback below never runs.
    if (ws.status === "connected") {
      try {
        ws.sendJson({
          type: "client:chat_message",
          payload: { examId: examNumericId, recipientId: "staff", messageText: body, clientMessageId },
        });
        return;
      } catch {
        /* fall through to REST */
      }
    }
    candidateChatApi
      .send(examNumericId, "staff", body)
      .then((row) => {
        chatPendingRef.current.delete(clientMessageId);
        setChatMessages((prev) =>
          prev.map((m) => (m.id === localId ? mapRowToUi(row) : m)),
        );
      })
      .catch(() => {
        // Keep the optimistic message; history syncs it once online.
        chatPendingRef.current.delete(clientMessageId);
      });
  }, [ws, examNumericId, mapRowToUi]);

  // Chat history (offline-proof) once the session is known. Reloads when
  // the in-page session changes (resume/re-entry without a remount), so a
  // continued attempt always shows the full thread.
  useEffect(() => {
    if (!examNumericId || !myRoll) return;
    let cancelled = false;
    candidateChatApi
      .history(examNumericId)
      .then((rows) => {
        if (cancelled) return;
        setChatMessages(rows.map(mapRowToUi));
        const incoming = rows.filter(
          (r) => String(r.senderId) !== String(myRoll) && !r.seen,
        );
        if (incoming.length) {
          try {
            ws.sendJson({
              type: "client:chat_seen",
              payload: { messageIds: incoming.map((r) => r.id) },
            });
          } catch {
            candidateChatApi.markThreadSeen(examNumericId).catch(() => {});
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [examNumericId, myRoll, resolvedSessionId, mapRowToUi, ws]);

  // Live chat events over the shared exam socket.
  useEffect(() => {
    ws.setOnChatMessage((payload) => {
      const row = payload.message as unknown as ExamChatMessage | undefined;
      if (!row) return;
      const me = myRollRef.current;
      setChatMessages((prev) => {
        if (prev.some((m) => m.id === String(row.id))) {
          return prev.map((m) =>
            m.id === String(row.id) ? mapRowToUi(row) : m,
          );
        }
        return [...prev, mapRowToUi(row)];
      });
      if (me && String(row.senderId) !== String(me)) {
        try {
          ws.sendJson({ type: "client:chat_delivered", payload: { messageId: row.id } });
          ws.sendJson({ type: "client:chat_seen", payload: { messageId: row.id } });
        } catch {
          candidateChatApi.markSeen(row.id).catch(() => {});
        }
      }
    });
    ws.setOnChatSent((payload) => {
      const row = payload.message as unknown as ExamChatMessage | undefined;
      const clientMessageId = payload.clientMessageId as string | null;
      if (!row) return;
      if (clientMessageId) {
        const localId = chatPendingRef.current.get(clientMessageId);
        if (localId) {
          chatPendingRef.current.delete(clientMessageId);
          setChatMessages((prev) =>
            prev.map((m) => (m.id === localId ? mapRowToUi(row) : m)),
          );
          return;
        }
      }
      setChatMessages((prev) =>
        prev.some((m) => m.id === String(row.id))
          ? prev.map((m) => (m.id === String(row.id) ? mapRowToUi(row) : m))
          : [...prev, mapRowToUi(row)],
      );
    });
    ws.setOnChatStatus((payload) => {
      const messageId = Number(payload.messageId);
      const status = payload.status as string;
      const tick = status === "seen" ? "read" : "delivered";
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === String(messageId) ? { ...m, status: tick } : m,
        ),
      );
    });
    return () => {
      ws.setOnChatMessage(undefined);
      ws.setOnChatSent(undefined);
      ws.setOnChatStatus(undefined);
    };
  }, [ws, mapRowToUi, examNumericId]);

  useEffect(() => {
    wsRef.current = {
      notifyExamSubmitted: ws.notifyExamSubmitted,
      reportTabSwitch: ws.reportTabSwitch,
    };
  }, [ws.notifyExamSubmitted, ws.reportTabSwitch]);

  const handleTerminatedExit = useCallback(() => {
    try {
      disconnectExamSocket();
    } catch {
      /* ignore */
    }
    window.close();
    // window.close() is blocked unless the tab was opened via script —
    // fall back to the candidate dashboard when still open.
    setTimeout(() => {
      if (!window.closed) navigate("/my-exams", { replace: true });
    }, 100);
  }, [disconnectExamSocket, navigate]);

  const handleResetRestart = useCallback(() => {
    try {
      disconnectExamSocket();
    } catch {
      /* ignore */
    }
    questionsFetchedRef.current = false;
    timerAutoStartedRef.current = false;
    navigate(`/exam/${examId}/instructions`, { replace: true });
  }, [disconnectExamSocket, navigate, examId]);

  const handleManualSubmittedExit = useCallback(() => {
    try {
      disconnectExamSocket();
    } catch {
      /* ignore */
    }
    window.close();
    // window.close() is blocked unless the tab was opened via script —
    // fall back to the candidate dashboard when still open.
    setTimeout(() => {
      if (!window.closed) navigate("/my-exams", { replace: true });
    }, 100);
  }, [disconnectExamSocket, navigate]);

  const handleExamResetAllExit = useCallback(() => {
    try {
      disconnectExamSocket();
    } catch {
      /* ignore */
    }
    try {
      stopProctorMedia();
    } catch {
      /* ignore */
    }
    window.close();
    setTimeout(() => {
      if (!window.closed) navigate("/my-exams", { replace: true });
    }, 100);
  }, [disconnectExamSocket, navigate, stopProctorMedia]);

  useEffect(() => {
    ws.setOnSessionRestored((payload) => {
      if (isPausedRef.current || isTerminatedRef.current || isExpiredRef.current || isResetRef.current || isManualSubmittedRef.current) return;
      const serverRemainingMs = payload.remainingTimeMs as number;
      const serverEndsAt = payload.endsAt as string;
      const serverStatus = payload.status as string;

      if (serverEndsAt) {
        serverEndTimeRef.current = Number(serverEndsAt);
      }

      if (serverStatus === "SUBMITTED" || serverStatus === "EXPIRED" || serverStatus === "GRACE_EXPIRED") {
        setIsExpired(true);
        timerControlsRef.current.pause();
        // The takeover says "Redirecting to results..." — actually go there.
        window.setTimeout(() => navigateToResultRef.current(), 2000);
        return;
      }

      if (serverRemainingMs != null && serverRemainingMs > 0) {
        timerControlsRef.current.reset(Math.floor(serverRemainingMs / 1000));
        timerControlsRef.current.start();
        timerAutoStartedRef.current = true;
      }
    });

    ws.setOnHeartbeatAck((payload) => {
      const serverRemainingMs = payload.remainingTimeMs as number;
      const serverEndsAt = payload.endsAt as string;
      const serverStatus = payload.status as string;

      if (serverEndsAt) {
        serverEndTimeRef.current = Number(serverEndsAt);
      }

      if (serverStatus === "SUBMITTED" || serverStatus === "EXPIRED" || serverStatus === "GRACE_EXPIRED") {
        if (!isExpiredRef.current) {
          setIsExpired(true);
          timerControlsRef.current.pause();
        }
        return;
      }

      // While the exam is held/terminated the server reports a frozen remainder —
      // don't let the heartbeat drift correction restart a paused/terminated countdown.
      if (isPausedRef.current || isTerminatedRef.current || isExpiredRef.current || isResetRef.current) return;

      if (serverRemainingMs != null && serverRemainingMs > 0) {
        const currentRemaining = timerControlsRef.current.timeRemaining;
        const newRemaining = Math.floor(serverRemainingMs / 1000);
        if (Math.abs(currentRemaining - newRemaining) > 5) {
          timerControlsRef.current.reset(newRemaining);
          timerControlsRef.current.start();
          timerAutoStartedRef.current = true;
        }
      }
    });

    ws.setOnForceSubmit((_payload) => {
      if (submittedViaRef.current) return;
      submittedViaRef.current = true;
      setIsSubmitting(true);
      toast.error("Exam submitted by administrator");
      console.info(`[SAT:EXAM] force-submit exam=${examId} session=${sessionId}`);
      void stopExamRecording();
      stopProctorMedia();
      // Abort any in-flight REST submit so we don't double-call. The
      // server already marked the session complete; the REST below
      // becomes a no-op via deterministic Idempotency-Key on the
      // backend.
      submitAbortRef.current?.abort();
      candidateExamApi
        .submitExam(sessionId!)
        .then(() => navigateToResultRef.current())
        .catch(() => navigateToResultRef.current());
    });

    ws.setOnWarning((payload) => {
      const code = payload.code as string;

      if (code === "SUPERSEDED") {
        toast.warning("A new connection has replaced this one");
        return;
      }

      if (code === "TAB_SWITCH") {
        const count = payload.tabSwitchCount as number;
        const limit = payload.limit as number;
        toast.warning(`Tab switch detected (${count}/${limit})`);
      } else if (code === "PAUSED") {
        setIsManualPause(false);
        setManualPauseReason(null);
        setIsPaused(true);
        timerControlsRef.current.pause();
        toast.error("Exam paused due to policy violation");
      } else if (code === "MANUAL_PAUSE") {
        const reason = (payload.reason as string) || (payload.message as string) || "";
        setIsManualPause(true);
        setManualPauseReason(reason || null);
        setIsPaused(true);
        timerControlsRef.current.pause();
        toast.error(reason ? `Exam paused by proctor: ${reason}` : "Your exam has been paused by the proctor");
      } else if (code === "GRACE_PERIOD_EXPIRED") {
        toast.error("Connection lost. Your exam timer is still running.");
      } else {
        toast.warning((payload.message as string) || "Warning received from server");
      }
    });

    ws.setOnSessionExpired(() => {
      if (isExpired) return;
      setIsExpired(true);
      timerControlsRef.current.pause();
      toast.error("Exam time has expired");
      console.info(`[SAT:EXAM] expired exam=${examId} session=${sessionId}`);
      void stopExamRecording();
      stopProctorMedia();
      setTimeout(() => navigateToResultRef.current(), 2000);
    });

    ws.setOnReconnectSuccess((payload) => {
      if (isPausedRef.current || isTerminatedRef.current || isExpiredRef.current || isResetRef.current || isManualSubmittedRef.current) return;
      toast.success("Reconnected to exam server");
      const serverRemainingMs = payload.remainingTimeMs as number;
      if (serverRemainingMs != null && serverRemainingMs > 0) {
        timerControlsRef.current.reset(Math.floor(serverRemainingMs / 1000));
        timerControlsRef.current.start();
        timerAutoStartedRef.current = true;
      }
      // Re-sync chat history after a dropped connection (missed messages),
      // unless sends are still in flight — their echoes will merge back.
      if (chatPendingRef.current.size > 0) return;
      const eid = examNumericId;
      const roll = myRollRef.current;
      if (!eid || !roll) return;
      candidateChatApi
        .history(eid)
        .then((rows) => setChatMessages(rows.map(mapRowToUi)))
        .catch(() => {});
    });

    ws.setOnExtraTime((payload) => {
      const addedSeconds = payload.addedSeconds as number;
      const serverRemainingMs = payload.remainingTimeMs as number;
      const serverEndsAt = payload.endsAt as string;

      if (serverEndsAt) {
        serverEndTimeRef.current = Number(serverEndsAt);
      }
      // If the exam is on hold/terminated we update the frozen remainder without
      // restarting the countdown — it will apply when the proctor resumes.
      if (isPausedRef.current || isTerminatedRef.current || isExpiredRef.current || isResetRef.current || isManualSubmittedRef.current) {
        if (serverRemainingMs != null && serverRemainingMs > 0) {
          timerControlsRef.current.reset(Math.floor(serverRemainingMs / 1000));
        }
        const label =
          addedSeconds >= 60 && addedSeconds % 60 === 0
            ? `${addedSeconds / 60} min`
            : `${addedSeconds}s`;
        toast.success(`Extra time allotted: +${label}. It will apply when your exam resumes.`);
        return;
      }
      if (serverRemainingMs != null && serverRemainingMs > 0) {
        timerControlsRef.current.reset(Math.floor(serverRemainingMs / 1000));
        timerControlsRef.current.start();
        timerAutoStartedRef.current = true;
      }
      const label =
        addedSeconds >= 60 && addedSeconds % 60 === 0
          ? `${addedSeconds / 60} min`
          : `${addedSeconds}s`;
      toast.success(`Extra time allotted: +${label}. Your countdown has been extended.`);
    });

    ws.setOnResumed((payload) => {
      if (isTerminatedRef.current || isResetRef.current || isManualSubmittedRef.current) return;
      const serverRemainingMs = payload.remainingTimeMs as number;
      const serverEndsAt = payload.endsAt as string;
      if (serverEndsAt) {
        serverEndTimeRef.current = Number(serverEndsAt);
      }
      setIsManualPause(false);
      setManualPauseReason(null);
      setIsPaused(false);
      if (serverRemainingMs != null && serverRemainingMs > 0) {
        timerControlsRef.current.reset(Math.floor(serverRemainingMs / 1000));
        timerControlsRef.current.start();
      }
      toast.success("Your exam has been resumed by the proctor. Your timer is running again.");
    });

    ws.setOnTerminated((payload) => {
      const reason = (payload.reason as string) || (payload.message as string) || null;
      const remaining = payload.remainingTimeMs as number | undefined;
      if (remaining != null) {
        timerControlsRef.current.reset(Math.floor(remaining / 1000));
      }
      timerControlsRef.current.pause();
      setTerminatedReason(reason);
      setTerminatedAt(Date.now());
      setIsTerminated(true);
      setIsPaused(false);
      toast.error(reason ? `Exam terminated: ${reason}` : "Your exam has been terminated by the proctor");
      console.info(`[SAT:EXAM] terminated exam=${examId} session=${sessionId} reason=${reason}`);
      void stopExamRecording();
      stopProctorMedia();
    });

    ws.setOnReset((payload) => {
      const reason = (payload.reason as string) || (payload.message as string) || null;
      const remaining = payload.remainingTimeMs as number | undefined;
      if (remaining != null) {
        timerControlsRef.current.reset(Math.floor(remaining / 1000));
      }
      timerControlsRef.current.pause();
      setResetReason(reason);
      setResetAt(Date.now());
      setIsReset(true);
      setIsPaused(false);
      toast(`Exam reset: ${reason ?? "your previous attempt has been cleared"}`);
      console.info(`[SAT:EXAM] reset exam=${examId} session=${sessionId} reason=${reason}`);
      void stopExamRecording();
      stopProctorMedia();
    });

    ws.setOnManualSubmitted((payload) => {
      const reason = (payload.reason as string) || (payload.message as string) || null;
      const remaining = payload.remainingTimeMs as number | undefined;
      if (remaining != null) {
        timerControlsRef.current.reset(Math.floor(remaining / 1000));
      }
      timerControlsRef.current.pause();
      setManualSubmitReason(reason);
      setManualSubmittedAt(Date.now());
      setIsManualSubmitted(true);
      setIsPaused(false);
      submittedViaRef.current = true;
      toast.success("Your exam has been submitted by the proctor");
      console.info(`[SAT:EXAM] manual-submit exam=${examId} session=${sessionId} reason=${reason}`);
      void stopExamRecording();
      stopProctorMedia();
      submitAbortRef.current?.abort();
    });

    ws.setOnResetAll((payload) => {
      const reason = (payload.reason as string) || (payload.message as string) || null;
      timerControlsRef.current.pause();
      setExamResetAllReason(reason);
      setIsExamResetAll(true);
      setIsPaused(false);
      submittedViaRef.current = true;
      toast(`Exam refreshed: ${reason ?? "this exam was reset by the administrator"}`);
      console.info(`[SAT:EXAM] reset-all exam=${examId} session=${sessionId} reason=${reason}`);
      void stopExamRecording();
      stopProctorMedia();
      submitAbortRef.current?.abort();
    });

    ws.setOnError((payload) => {
      console.error("[WS] Error:", payload);
    });

    return () => {
      ws.setOnSessionRestored(undefined);
      ws.setOnHeartbeatAck(undefined);
      ws.setOnForceSubmit(undefined);
      ws.setOnWarning(undefined);
      ws.setOnSessionExpired(undefined);
      ws.setOnReconnectSuccess(undefined);
      ws.setOnExtraTime(undefined);
      ws.setOnResumed(undefined);
      ws.setOnTerminated(undefined);
      ws.setOnManualSubmitted(undefined);
      ws.setOnReset(undefined);
      ws.setOnResetAll(undefined);
      ws.setOnError(undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callbacks stored in refs; deps intentionally empty
  }, []);

  useEffect(() => {
    if (!tabSwitchDetection || tabSwitchAutoSubmitLimit <= 0 || !sessionId || isPaused || isTerminated || isReset || isExpired || isManualSubmitted) return;

    let actionTaken = false;
    let lastViolationAt = 0;

    const enforce = () => {
      if (actionTaken) return;
      actionTaken = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('beforeprint', handleBeforePrint);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      wsRef.current?.reportTabSwitch();
    };

    const countViolation = (_reason: string) => {
      // Proctor-authorized emergency release: do not charge the candidate for
      // the focus/fullscreen churn of tearing the lockdown down.
      if (kioskSuppressedRef.current) return;
      const now = Date.now();
      if (now - lastViolationAt < 300) return;
      lastViolationAt = now;
      tabSwitchCountRef.current += 1;
      wsRef.current?.reportTabSwitch();
      if (tabSwitchCountRef.current >= tabSwitchAutoSubmitLimit) enforce();
    };
    // Publish for the kiosk bridge (reset on cleanup so a stale closure can
    // never count after this effect's listeners are gone).
    countViolationRef.current = countViolation;

    const handleVisibilityChange = () => {
      if (actionTaken || !document.hidden) return;
      countViolation('Tab switch');
    };

    const handleBlur = () => {
      if (actionTaken) return;
      countViolation('Window blur');
    };

    const handleBeforePrint = () => {
      if (actionTaken) return;
      countViolation('Print attempt');
    };

    const handleFullscreenChange = () => {
      if (actionTaken) return;
      const doc = document as unknown as Record<string, unknown>;
      const isFullscreen = !!document.fullscreenElement || !!doc.webkitFullscreenElement;
      if (!isFullscreen) countViolation('Fullscreen exit');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('beforeprint', handleBeforePrint);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      countViolationRef.current = () => {};
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('beforeprint', handleBeforePrint);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [tabSwitchDetection, tabSwitchAutoSubmitLimit, tabSwitchAction, sessionId, isPaused, isTerminated, isReset, isExpired, isManualSubmitted]);

  // Kiosk escapes punish like tab switches: forward focus-loss violations
  // into the pipeline above (report + count toward pause/auto-submit).
  // Noop while that pipeline is inactive (detection off) — toast only.
  useEffect(() => {
    setOnKioskViolation((kind) => {
      console.log("[Kiosk:take] kiosk violation forwarded to tab-switch pipeline", { kind });
      countViolationRef.current(`Kiosk focus lost (${kind})`);
    });
    return () => setOnKioskViolation(undefined);
  }, [setOnKioskViolation]);

  // Native lockdown proof (one-shot per mount): hook installed + swallowing?
  // If Alt+Tab still switches while keys_swallowed stays flat across
  // re-mounts, the OS never delivers keystrokes to the hook — send this line.
  useEffect(() => {
    if (!isTauriEnv()) return;
    void lockdownStatus()
      .then((s) => console.log("[Kiosk:take] lockdown status", s))
      .catch((err) => console.warn("[Kiosk:take] lockdown status unavailable — reason:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- diagnostic sample per take mount
  }, []);

  // Kiosk mode requires fullscreen. The Start/Proceed click happens on the
  // previous page, but client-side navigation keeps the same document, so its
  // transient activation is usually still valid when this page loads — attempt
  // fullscreen automatically once. If the gesture expired (slow network), the
  // request rejects and the gate overlay below stays as the fallback.
  // Kiosk is owned once by ExamSessionProvider: armed on the Second Loading
  // screen's initial load, stays on across subjects ↔ take navigation until
  // the Exam Submitted screen disarms it. This page only consumes the shared
  // fullscreen state for its gate/auto-entry (fullscreen lives in kiosk) and
  // re-arms if it ever mounts disarmed mid-exam (e.g. page refresh).
  // NOTE: pause/submit/terminal states must NOT exit kiosk — the lock holds
  // for the whole take lifetime; only the result screen releases it.
  const showFullscreenGate = kioskMode && !loading && !!examData && !isPaused && !isTerminated && !isReset && !isExpired && !isSubmitting && !isFullscreen;
  const autoFullscreenAttemptedRef = useRef(false);

  useEffect(() => {
    // `kioskSuppressed` is the emergency-exit latch: after a proctor release the
    // kiosk stays down (the Enter Fullscreen gate is shown instead) until the
    // user deliberately re-arms it — otherwise this recovery path would
    // instantly re-enter lockdown the proctor just released.
    if (!kioskArmed && !kioskSuppressed && kioskMode && !loading && !!examData && !isTerminated && !isReset && !isExpired) {
      console.log("[Kiosk:exam-flow] arm kiosk — reason: mid-exam recovery (take mounted while disarmed, e.g. refresh)");
      armKiosk(kioskMode);
    }
  }, [kioskArmed, kioskSuppressed, kioskMode, loading, examData, isTerminated, isReset, isExpired, armKiosk]);

  useEffect(() => {
    if (!kioskMode || loading || !examData || isPaused || isTerminated || isReset || isExpired || isSubmitting || isFullscreen) {
      console.log("[Kiosk:take] auto-requestFullscreen skipped — reasons:", {
        kioskMode, loading, hasExamData: !!examData, isPaused, isTerminated, isReset, isExpired, isSubmitting, isFullscreen,
        alreadyAttempted: autoFullscreenAttemptedRef.current,
      });
      return;
    }
    if (autoFullscreenAttemptedRef.current) {
      console.log("[Kiosk:take] auto-requestFullscreen skipped — reason: already attempted once for this exam");
      return;
    }
    autoFullscreenAttemptedRef.current = true;
    console.log("[Kiosk:take] auto-requestFullscreen attempting — reason: exam entry, path: requestFullscreen");
    requestFullscreen();
  }, [kioskMode, loading, examData, isPaused, isTerminated, isReset, isExpired, isSubmitting, isFullscreen, requestFullscreen]);

  // Reset the auto-attempt when navigating between exams (same component instance).
  useEffect(() => {
    autoFullscreenAttemptedRef.current = false;
  }, [examId]);

  // Debug: trace gate visibility.
  const hasExamData = !!examData;
  useEffect(() => {
    console.log("[Kiosk:take] fullscreen gate", {
      kioskMode,
      loading,
      hasExamData,
      isPaused,
      isExpired,
      isSubmitting,
      isFullscreen,
      showFullscreenGate,
    });
  }, [kioskMode, loading, hasExamData, isPaused, isExpired, isSubmitting, isFullscreen, showFullscreenGate]);

  const handleSelectOption = useCallback(
    (optionId: string) => {
      if (currentQuestion) {
        selectOption(currentQuestion.questionNumber, optionId);
      }
    },
    [currentQuestion, selectOption],
  );

  const handleAnswerTextChange = useCallback(
    (text: string) => {
      if (!currentQuestion) return;
      if (text === "") {
        clearResponse(currentQuestion.questionNumber);
      } else {
        selectOption(currentQuestion.questionNumber, text);
      }
    },
    [currentQuestion, selectOption, clearResponse],
  );

  const handleClear = useCallback(
    (questionNumber: number) => {
      if (isUnidirectional) return;
      clearResponse(questionNumber);
      const question = examData?.questions.find((q) => q.questionNumber === questionNumber);
      if (!question || !sessionId) return;
      candidateExamApi.clearAnswer(sessionId, question.id).catch(() => {});
    },
    [clearResponse, sessionId, examData, isUnidirectional],
  );

  const saveAnswer = useCallback(
    (questionNumber: number, optionId: string, submitType: SubmitType, toQuestionNumber?: number) => {
      if (!sessionId) return;
      const question = examData?.questions.find((q) => q.questionNumber === questionNumber);
      if (!question) return;

      setIsSaving(true);
      candidateExamApi.submitAnswer(
        sessionId,
        question.id,
        optionId,
        submitType,
        { fromQuestionNumber: questionNumber, toQuestionNumber },
      )
        .then(() => {
          confirmSubmission(questionNumber, optionId);
          toast.success(`Q${question.displayNumber ?? questionNumber} saved`);
        })
        .catch(() => {
          toast.error("Save failed — please retry");
        })
        .finally(() => setIsSaving(false));
    },
    [sessionId, examData, confirmSubmission],
  );

  const handleMarkForReview = useCallback(
    (questionNumber: number) => {
      if (isUnidirectional) return;
      if (!currentQuestion || currentQuestion.questionNumber !== questionNumber) return;

      const question = examData?.questions.find((q) => q.questionNumber === questionNumber);
      if (!question || !sessionId) return;

      const selection = selections[questionNumber];
      const answer = selection ?? "";

      setIsMarking(true);
      candidateExamApi.submitAnswer(
        sessionId,
        question.id,
        answer,
        "marked_review",
        { fromQuestionNumber: questionNumber, toQuestionNumber: visibleHasNext ? visibleQuestions[visibleIndex + 1].questionNumber : questionNumber },
      )
        .then(() => {
          if (selection) {
            confirmSubmission(questionNumber, selection);
          } else {
            clearResponse(questionNumber);
          }
          toggleMarkForReview(questionNumber);
          toast.success(`Q${question.displayNumber ?? questionNumber} marked`);
          if (visibleHasNext) goVisible(visibleIndex + 1);
        })
        .catch(() => {
          toast.error("Mark failed — please retry");
        })
        .finally(() => setIsMarking(false));
    },
    [currentQuestion, examData, sessionId, selections, confirmSubmission, clearResponse, toggleMarkForReview, visibleHasNext, visibleQuestions, visibleIndex, goVisible, isUnidirectional],
  );

  const handleSaveNext = useCallback(() => {
    if (currentQuestion) {
      const qn = currentQuestion.questionNumber;
      const selection = selections[qn] ?? submittedAnswers[qn];
      const nextQn = visibleHasNext ? visibleQuestions[visibleIndex + 1].questionNumber : qn;
      if (selection) {
        saveAnswer(qn, selection, "normal_submit", nextQn);
      } else if (sessionId) {
        // No answer to save — record the unanswered move, then navigate.
        candidateExamApi.logNavigation(sessionId, {
          activityType: "UNANSWERED_MOVE",
          questionNumber: qn,
          fromQuestionNumber: qn,
          toQuestionNumber: nextQn,
        }).catch(() => {});
      }
    }
    if (visibleHasNext) goVisible(visibleIndex + 1);
  }, [currentQuestion, selections, submittedAnswers, saveAnswer, visibleHasNext, visibleQuestions, visibleIndex, goVisible, sessionId]);

  const handleNext = useCallback(() => {
    if (isUnidirectional) return;
    if (visibleHasNext) goVisible(visibleIndex + 1);
  }, [visibleHasNext, visibleIndex, goVisible, isUnidirectional]);

  const handlePrevious = useCallback(() => {
    if (isUnidirectional) return;
    if (!visibleHasPrev || !currentQuestion) return;
    const from = currentQuestion.questionNumber;
    if (sessionId) {
      const question = examData?.questions.find((q) => q.questionNumber === from);
      candidateExamApi.logNavigation(sessionId, {
        activityType: "PREVIOUS",
        questionId: question?.id,
        questionNumber: from,
        fromQuestionNumber: from,
        toQuestionNumber: visibleQuestions[visibleIndex - 1].questionNumber,
      }).catch(() => {});
    }
    goVisible(visibleIndex - 1);
  }, [visibleHasPrev, currentQuestion, sessionId, examData, visibleQuestions, visibleIndex, goVisible, isUnidirectional]);

  const handlePanelJump = useCallback((questionNumber: number) => {
    // Unidirectional exams move forward only via Save & Next — the palette
    // is display-only, so every jump is rejected (no forward skipping either).
    if (isUnidirectional) {
      toast.info("This exam moves forward only — use Save & Next to continue.");
      return;
    }
    // Restricted direction: movement stays inside the active section.
    if (restricted && sectionOf(questionNumber) !== activeSection) {
      toast.info("Submit this section to move to the next one.");
      return;
    }
    if (sessionId && currentQuestion && questionNumber !== currentQuestion.questionNumber) {
      const question = examData?.questions.find((q) => q.questionNumber === questionNumber);
      candidateExamApi.logNavigation(sessionId, {
        activityType: "PANEL_JUMP",
        questionId: question?.id,
        questionNumber,
        fromQuestionNumber: currentQuestion.questionNumber,
        toQuestionNumber: questionNumber,
      }).catch(() => {});
    }
    goToQuestion(questionNumber);
  }, [sessionId, currentQuestion, examData, goToQuestion, isUnidirectional, restricted, activeSection, sectionOf]);

  // One-shot hydration for refresh/direct-open and subject verification:
  // restores config/startedAt/completed sections from the server, bounces
  // multi-subject exams without a selected subject back to the subjects
  // step, and rejects completed or foreign subjects (forged nav state).
  useEffect(() => {
    if (!sessionId || !examData || sectionsHydrated) return;
    let cancelled = false;
    candidateExamApi.getSessionSubjects(sessionId)
      .then((d) => {
        if (cancelled) return;
        setSubjectsState(d.subjects);
        setSectionConfigState(d.sectionConfig);
        if (d.subjects.length > 1 && navSubjectId == null) {
          navigate(`/exam/${examId}/subjects`, { replace: true, state });
          return;
        }
        const sid = navSubjectId ?? d.subjects[0]?.id;
        if (sid == null || !d.subjects.some((s) => s.id === sid)) {
          navigate(`/exam/${examId}/subjects`, { replace: true, state });
          return;
        }
        const prog = d.progress.find((p) => p.subjectId === sid);
        if (prog?.status === 'completed') {
          toast.info("This subject is already submitted.");
          navigate(`/exam/${examId}/subjects`, { replace: true, state });
          return;
        }
        if (prog) {
          setSubjectStartedAt(prog.startedAt);
          setCompletedSections(new Set(
            (prog.completedSections ?? []).filter(
              (s): s is ExamSectionId => s === 'mcq' || s === 'subjective',
            ),
          ));
        }
        setSectionsHydrated(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId, examData, sectionsHydrated, navSubjectId, state, examId, navigate]);

  const subjectAllowedMinutes = useMemo(() => {
    if (!sectionConfig?.perSubjectTimeRestriction) return null;
    return subjectsList?.find((s) => s.id === navSubjectId)?.allowedMinutes ?? null;
  }, [sectionConfig, subjectsList, navSubjectId]);

  const activeSectionKey: ExamSectionId | 'all' = restricted
    ? (activeSection === 'all' ? (sections[0]?.id ?? 'all') : activeSection)
    : activeSection;

  const sectionAllowedMinutes = useMemo(() => {
    if (!restricted || !sectionConfig?.perSectionTimeRestriction) return null;
    if (activeSectionKey === 'all') return null;
    return sectionConfig.sectionTimes[activeSectionKey] ?? null;
  }, [restricted, sectionConfig, activeSectionKey]);

  const handleSubmitSubject = useCallback(async (auto = false) => {
    if (!sessionId || navSubjectId == null || isSubmittingSubject) return;
    setIsSubmittingSubject(true);
    try {
      await flushDirtySelections().catch(() => {});
      const res = await candidateExamApi.submitSubject(sessionId, navSubjectId);
      if (res.allCompleted) {
        if (!auto) toast.success("Subject submitted. Submitting your exam…");
        submitExamToServer();
      } else {
        toast.success("Subject submitted successfully.");
        navigate(`/exam/${examId}/subjects`, { replace: true, state });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit subject.");
    } finally {
      setIsSubmittingSubject(false);
    }
  }, [sessionId, navSubjectId, isSubmittingSubject, submitExamToServer, navigate, examId, state, flushDirtySelections]);

  const handleSubmitSection = useCallback(async (auto = false) => {
    if (!restricted || submittingSection) return;
    const idx = sections.findIndex((s) => s.id === activeSectionKey);
    if (idx === -1) return;
    if (idx >= sections.length - 1) {
      await handleSubmitSubject(auto);
      return;
    }
    setSubmittingSection(true);
    try {
      const doneId = sections[idx].id;
      // Persist first so the lock survives refresh; the UI advances even if
      // the request fails (answers are already saved per question).
      if (sessionId && navSubjectId != null) {
        candidateExamApi.submitSection(sessionId, navSubjectId, doneId).catch(() => {
          toast.error("Section progress sync failed — continuing anyway.");
        });
      }
      setCompletedSections((prev) => new Set(prev).add(doneId));
      const next = sections[idx + 1];
      setActiveSection(next.id);
      sectionEnteredRef.current = Date.now();
      autoFiredRef.current.section = null;
      const list = examData?.questions ?? [];
      const first = list.find((q) => (q.questionType === 'subjective' ? 'subjective' : 'mcq') === next.id);
      if (first) goToQuestion(first.questionNumber);
      if (!auto) toast.success("Section submitted. Moving to the next section.");
    } finally {
      setSubmittingSection(false);
    }
  }, [restricted, submittingSection, sections, activeSectionKey, handleSubmitSubject, examData, goToQuestion, sessionId, navSubjectId]);

  submitSectionRef.current = handleSubmitSection;
  submitSubjectRef.current = handleSubmitSubject;

  // Per-subject / per-section budgets tick alongside the global timer and
  // auto-submit the binding scope when its window elapses. Held time
  // (paused/terminated/expired/submitting) doesn't count — the server
  // freezes the global timer the same way, so budgets shift by it.
  const subjectShiftRef = useRef(0);
  const holdStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (subjectAllowedMinutes == null && sectionAllowedMinutes == null) return;
    const id = window.setInterval(() => {
      const held = isPaused || isTerminated || isExpired || isReset || isManualSubmitted || isExamResetAll || isSubmitting;
      if (held) {
        if (holdStartRef.current == null) holdStartRef.current = Date.now();
        return;
      }
      if (holdStartRef.current != null) {
        const heldMs = Date.now() - holdStartRef.current;
        holdStartRef.current = null;
        subjectShiftRef.current += heldMs;
        sectionEnteredRef.current += heldMs;
      }
      setBudgetTick((t) => t + 1);
      const now = Date.now();
      if (sectionAllowedMinutes != null) {
        const leftMs = sectionEnteredRef.current + sectionAllowedMinutes * 60000 - now;
        if (leftMs <= 0 && autoFiredRef.current.section !== activeSectionKey) {
          autoFiredRef.current.section = activeSectionKey;
          toast.info("Section time is up — moving on.");
          void submitSectionRef.current(true);
          return;
        }
      }
      if (subjectAllowedMinutes != null && subjectStartedAt) {
        const leftMs = new Date(subjectStartedAt).getTime() + subjectAllowedMinutes * 60000 + subjectShiftRef.current - now;
        if (leftMs <= 0 && !autoFiredRef.current.subject) {
          autoFiredRef.current.subject = true;
          toast.info("Subject time is up — submitting this subject.");
          void submitSubjectRef.current(true);
        }
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [subjectAllowedMinutes, sectionAllowedMinutes, subjectStartedAt, activeSectionKey, isPaused, isTerminated, isExpired, isReset, isManualSubmitted, isExamResetAll, isSubmitting]);

  const displayBudget = useMemo(() => {
    if (subjectAllowedMinutes == null && sectionAllowedMinutes == null) return null;
    const now = Date.now();
    const candidates: number[] = [timerControls.timeRemaining];
    if (subjectAllowedMinutes != null && subjectStartedAt) {
      candidates.push(Math.max(0, Math.ceil((new Date(subjectStartedAt).getTime() + subjectAllowedMinutes * 60000 + subjectShiftRef.current - now) / 1000)));
    }
    if (sectionAllowedMinutes != null) {
      candidates.push(Math.max(0, Math.ceil((sectionEnteredRef.current + sectionAllowedMinutes * 60000 - now) / 1000)));
    }
    return Math.min(...candidates);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-evaluated on every budget tick
  }, [subjectAllowedMinutes, sectionAllowedMinutes, subjectStartedAt, activeSectionKey, timerControls.timeRemaining, budgetTick]);

  const displayTime = displayBudget == null ? formattedTime : timerControls.formatTime(displayBudget);
  const displayLow = displayBudget == null ? isLowTime : displayBudget > 0 && displayBudget <= 600;
  const displayCritical = displayBudget == null ? isCriticalTime : displayBudget > 0 && displayBudget <= 300;

  // Section submit button label follows the exam shape:
  // last section of the last (or only) subject -> Submit Exam;
  // last section of an earlier subject -> continue to the next subject.
  const sectionIndex = sections.findIndex((s) => s.id === activeSectionKey);
  const isLastSection = sectionIndex >= 0 && sectionIndex >= sections.length - 1;
  const subjectIndex = subjectsList?.findIndex((s) => s.id === navSubjectId) ?? -1;
  const isLastSubject =
    !multiSubjectFlow ||
    subjectIndex < 0 ||
    (subjectsList != null && subjectIndex >= subjectsList.length - 1);
  const submitSectionLabel = !isLastSection
    ? "Submit Section & Continue"
    : isLastSubject
      ? "Submit Exam"
      : "Submit Section & Continue to next subject";

  const answeredCount = Object.values(submittedAnswers).filter(Boolean).length;
  const processingLabel = isSubmitting ? "Submitting..." : "Submit";

  // Tab-switch pause overlay recovery: if no resume event arrives (dead
  // socket), the candidate can poll the session and reload once active.
  const [checkingPause, setCheckingPause] = useState(false);
  const handlePauseCheckAgain = useCallback(async () => {
    if (!examId || checkingPause) return;
    setCheckingPause(true);
    try {
      const check = await candidateExamApi.getExamSession(Number(examId));
      if (!check.isPaused && !check.isManuallyPaused && check.hasSession) {
        window.location.reload();
      } else {
        toast.info("Still paused — waiting for resume.");
      }
    } catch {
      toast.error("Couldn't reach the server. Stay on this screen.");
    } finally {
      setCheckingPause(false);
    }
  }, [examId, checkingPause]);

  if (loading && !examData) {
    return (
      <div className="flex h-screen items-center justify-center gap-4 bg-background p-8">
        <div className="flex w-full max-w-4xl flex-col gap-6">
          <Skeleton className="h-16 w-full rounded-xl" />
          <div className="flex gap-6">
            <Skeleton className="h-[600px] w-60 rounded-xl" />
            <Skeleton className="h-[600px] flex-1 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (isExamResetAll) {
    // Bulk exam reset via WS — show the refresh screen with 10s auto-close.
    return (
      <ExamRefreshScreen
        reason={examResetAllReason}
        examTitle={sessionData?.examTitle ?? examData?.title}
        candidateName={examData?.candidateName}
        onExit={handleExamResetAllExit}
        onAutoExit={handleExamResetAllExit}
      />
    );
  }

  if (isReset) {
    // Proctor reset the session via WS — show the reset takeover with the
    // frozen timer, a manual restart, and a 10-second auto-exit back to
    // instructions to start a fresh attempt.
    return (
      <ExamResetScreen
        reason={resetReason}
        examTitle={sessionData?.examTitle ?? examData?.title}
        subjectName={examData?.subjectName || instructions?.subjectName || ""}
        onRestart={handleResetRestart}
        onAutoExit={handleResetRestart}
      />
    );
  }

  if (isManualSubmitted) {
    // Proctor submitted the live session via WS — show the submitted
    // takeover with the frozen timer and auto-exit (mirrors ResultPage).
    return (
      <ManualSubmittedScreen
        reason={manualSubmitReason}
        examTitle={sessionData?.examTitle ?? examData?.title}
        subjectName={examData?.subjectName || instructions?.subjectName || ""}
        onExit={handleManualSubmittedExit}
        onAutoExit={handleManualSubmittedExit}
      />
    );
  }

  if (isTerminated) {
    // In-window termination triggered via WS or pre-exam check — render
    // the dedicated terminated gate even before examData loads.
    return (
      <PreExamTerminatedGate
        reason={terminatedReason}
        examTitle={sessionData?.examTitle ?? examData?.title}
        onBack={() => navigate(`/exam/${examId}/instructions`, { replace: true })}
      />
    );
  }

  if (error || !examData) {
    if (/manual_terminate|terminated/i.test(error ?? "")) {
      return (
        <PreExamTerminatedGate
          reason={error}
          examTitle={sessionData?.examTitle}
          onBack={() => navigate(`/exam/${examId}/instructions`, { replace: true })}
        />
      );
    }
    if (/manually paused/i.test(error ?? "")) {
      return (
        <PreExamPauseGate
          examTitle={sessionData?.examTitle}
          onCheckAgain={() => window.location.reload()}
          onBack={() => navigate(`/exam/${examId}/instructions`, { replace: true })}
        />
      );
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <div className="w-full max-w-md animate-scaleIn rounded-2xl border bg-card p-6 text-center shadow-soft-lg">
          <div className="mx-auto mb-4 flex size-13 items-center justify-center rounded-2xl bg-destructive/10 p-3">
            <AlertTriangle className="size-6 text-destructive" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">We couldn&apos;t open your exam</h1>
          <p className="mt-1.5 break-words text-sm text-muted-foreground">
            {error || "Failed to load exam data."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your answers already saved on the server are safe.
          </p>
          <div className="mt-5 flex items-center gap-2">
            <Button variant="outline" className="flex-1" onClick={() => navigate(`/exam/${examId}/instructions`, { replace: true })}>
              Back to Instructions
            </Button>
            <Button className="flex-1" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <ExamLayout
        examTitle={examData.title}
        subjectName={examData.subjectName}
        candidateName={examData.candidateName}
        candidateRollNumber={examData.candidateRollNumber}
        questions={visibleQuestions}
        currentQuestion={currentQuestion}
        totalQuestions={totalQuestions}
        progress={progress}
        selectedOption={selectedOption}
        isMarkedForReview={isMarkedForReview}
        hasPrev={visibleHasPrev && !isUnidirectional}
        hasNext={visibleHasNext}
        formattedTime={displayTime}
        isLowTime={displayLow}
        isCriticalTime={displayCritical}
        connectionStatus={ws.status}
        isSaving={isSaving}
        isMarking={isMarking}
        getQuestionStatus={getQuestionStatus}
        onSelectOption={handleSelectOption}
        onAnswerTextChange={handleAnswerTextChange}
        sessionId={sessionId}
        onPrevious={handlePrevious}
        onClear={handleClear}
        onMarkForReview={handleMarkForReview}
        onSaveNext={handleSaveNext}
        onNext={handleNext}
        onGoToQuestion={handlePanelJump}
        onSubmitExam={
          restricted && sections.length > 1
            ? () => void handleSubmitSection(false)
            : () => multiSubjectFlow ? setShowSubjectSubmitAlert(true) : setShowSubmitAlert(true)
        }
        onViewInstructions={() => setShowInstructions(true)}
        examMode={examMode ?? "normal"}
        verificationImageUrl={verificationImageUrl}
        chatMessages={chatMessages}
        onSendChat={handleSendChat}
        sections={sections.map((s) => ({ ...s, completed: completedSections.has(s.id) }))}
        activeSectionId={activeSectionKey === 'all' ? (sections[0]?.id ?? 'mcq') : activeSectionKey}
        sectionLocked={restricted}
        onSelectSection={handleSelectSection}
        onSubmitSection={restricted && sections.length > 1 ? () => void handleSubmitSection(false) : undefined}
        submitSectionLabel={submitSectionLabel}
        submittingSection={submittingSection}
        navigationLocked={isUnidirectional}
      />

      {/* Proctor speaking banner — always in the DOM; toggled via opacity/transform so
          enter AND exit animate smoothly with CSS transitions (no abrupt unmount). */}
      <div
        aria-hidden={!announceVisible}
        className={`fixed top-4 left-1/2 z-[90] -translate-x-1/2 transition-all duration-300 ease-out ${
          announceVisible
            ? "translate-y-0 opacity-100 pointer-events-auto"
            : "-translate-y-3 opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-card/95 py-2.5 pr-4 pl-3 shadow-xl shadow-emerald-600/10 backdrop-blur">
          <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
            <AudioLines className="size-4" />
            <span className="absolute -top-0.5 -right-0.5 flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500 ring-2 ring-card" />
            </span>
          </span>
          <span>
            <span className="block text-sm font-semibold">Proctor speaking</span>
            {audioBlocked ? (
              <button
                onClick={unlockProctorAudio}
                className="mt-0.5 block rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
              >
                Tap here to hear them
              </button>
            ) : (
              <span className="block text-xs text-muted-foreground">Please listen — your proctor is talking to you</span>
            )}
          </span>
        </div>
      </div>

      {/* AI monitoring indicator — ai-proctor mode only. Inference is on-device;
          toasts + flag uploads are handled inside useAIProctorMonitor. */}
      {isAIProctor && !isExpired && !isSubmitting && (
        <div className="fixed bottom-4 left-4 z-[90] flex items-center gap-2 rounded-full border bg-card/95 py-1.5 pr-3 pl-2.5 shadow-lg backdrop-blur">
          <span className="relative flex size-2">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${aiStatus === "active" ? "bg-emerald-500" : "bg-amber-500"}`} />
            <span className={`relative inline-flex size-2 rounded-full ${aiStatus === "active" ? "bg-emerald-500" : "bg-amber-500"}`} />
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            AI Monitoring{aiStatus === "active" ? " • Active" : aiStatus === "loading" ? " • Starting…" : aiStatus === "error" ? " • Unavailable" : ""}
            {aiStatus === "active" && !identityReady ? " • ID check off" : ""}
          </span>
        </div>
      )}

      {isExpired && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm">
          <div className="mx-auto max-w-md rounded-2xl border bg-card p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="mb-2 text-xl font-bold">Exam Time Expired</h2>
            <p className="text-sm text-muted-foreground">
              Your exam time has ended. Your answers have been saved. Redirecting to results...
            </p>
          </div>
        </div>
      )}

      {isPaused && !isExpired && !isTerminated && !isManualPause && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm">
          <div className="mx-auto max-w-md rounded-2xl border bg-card p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="mb-2 text-xl font-bold">Exam Paused</h2>
            <p className="text-sm text-muted-foreground">
              Your exam has been paused due to multiple policy violations
              (tab switches or fullscreen exits). You will be redirected shortly.
            </p>
            <Button
              className="mt-4"
              onClick={handlePauseCheckAgain}
              disabled={checkingPause}
              type="button"
            >
              {checkingPause ? "Checking..." : "Check Again"}
            </Button>
          </div>
        </div>
      )}

      {isTerminated && (
        <TerminatedScreen
          reason={terminatedReason}
          examTitle={examData.title}
          subjectName={examData.subjectName || instructions?.subjectName || ""}
          onExit={handleTerminatedExit}
        />
      )}

      {isPaused && !isExpired && !isTerminated && isManualPause && (
        <MidExamPauseOverlay
          reason={manualPauseReason}
          frozenTime={displayTime}
          examTitle={examData.title}
          candidateName={examData.candidateName}
          connected={ws.status === "connected"}
        />
      )}

      {showFullscreenGate && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm">
          <div className="mx-auto max-w-md rounded-2xl border bg-card p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Maximize className="h-8 w-8 text-primary" />
            </div>
            <h2 className="mb-2 text-xl font-bold">Fullscreen Required</h2>
            <p className="mb-5 text-sm text-muted-foreground">
              This exam runs in kiosk mode and must be taken in fullscreen.
              Click below to enter fullscreen and begin.
            </p>
            <button
              className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                console.log("[Kiosk:take] gate button clicked — reason: user gesture, path: re-enter kiosk");
                // Deliberately re-arm (this also clears the emergency-exit
                // suppression latch) and capture HTML fullscreen inside this
                // gesture. The kiosk hook auto-enters the Rust window lockdown
                // as soon as kioskArmed flips true.
                armKiosk(kioskMode);
                void requestKioskFullscreenNow("take-gate");
              }}
            >
              Enter Fullscreen
            </button>
          </div>
        </div>
      )}

      {ws.status === "disconnected" && !isExpired && !isPaused && !isTerminated && !isReset && (
        <div className="fixed inset-0 z-[99] flex items-center justify-center bg-background/95 backdrop-blur-sm">
          <div className="mx-auto max-w-md rounded-2xl border bg-card p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
              <svg className="h-8 w-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="mb-2 text-xl font-bold">Connection Lost</h2>
            <p className="text-sm text-muted-foreground">
              Your connection to the exam server has been lost. Your exam timer continues to run.
              Attempting to reconnect...
            </p>
          </div>
        </div>
      )}

      {ws.status === "failed" && !isExpired && !isTerminated && !isReset && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm">
          <div className="mx-auto max-w-md rounded-2xl border bg-card p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="mb-2 text-xl font-bold">Connection Failed</h2>
            <p className="text-sm text-muted-foreground">
              Unable to reconnect to the exam server. Please check your internet connection
              and refresh the page. Your answers have been saved.
            </p>
            <button
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => window.location.reload()}
            >
              Refresh Page
            </button>
          </div>
        </div>
      )}

      <AlertDialog
        open={showSubmitAlert}
        onOpenChange={setShowSubmitAlert}
        title="Submit Examination"
        description={`You have answered ${answeredCount} out of ${totalQuestions} questions. ${totalQuestions - answeredCount} questions are unanswered. Are you sure you want to submit?`}
        confirmText={processingLabel}
        cancelText="Review Answers"
        onConfirm={submitExamToServer}
        variant="default"
      />

      <AlertDialog
        open={showSubjectSubmitAlert}
        onOpenChange={setShowSubjectSubmitAlert}
        title="Submit Subject"
        description={`You have answered ${answeredCount} out of ${totalQuestions} questions in this subject. Once submitted you can't return to it. Continue?`}
        confirmText={isSubmittingSubject ? "Submitting..." : "Submit Subject"}
        cancelText="Review Answers"
        onConfirm={() => void handleSubmitSubject(false)}
        variant="default"
      />

      <Dialog open={showInstructions} onOpenChange={setShowInstructions}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Exam Instructions</DialogTitle>
            <DialogDescription>
              Review the exam instructions below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="rounded-lg border bg-muted/30 p-4 [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded">
              {loadingInstructions ? (
                <p className="text-muted-foreground">Loading instructions...</p>
              ) : instructions?.examInstructions ? (
                <div dangerouslySetInnerHTML={{ __html: instructions.examInstructions }} />
              ) : (
                <p className="text-muted-foreground">No additional instructions.</p>
              )}
            </div>
            {instructions?.examInstructionImage && (
              <div className="rounded-lg border bg-muted/30 p-4">
                <img
                  src={instructions.examInstructionImage}
                  alt="Exam instruction"
                  className="max-w-full h-auto rounded"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Duration</p>
                <p className="text-sm font-semibold">{instructions?.duration ?? examData.duration} minutes</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Total Questions</p>
                <p className="text-sm font-semibold">{instructions?.totalQuestions ?? totalQuestions}</p>
              </div>
            </div>
          </div>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </>
  );
}
