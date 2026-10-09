import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { BookOpen, CheckCircle2, Clock, Hourglass, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useExamSession } from "@/contexts/ExamSessionContext";
import {
  candidateExamApi,
  type ExamSubjectInfo,
  type SessionQuestions,
  type SessionSubjects,
} from "@/services/api";
import { toast } from "sonner";

interface SubjectsLocationState {
  sessionId?: number;
  prefetchedSession?: SessionQuestions | null;
  randomizeQuestions?: boolean;
  randomizeOptions?: boolean;
  questionDirection?: string;
  tabSwitchDetection?: boolean;
  tabSwitchAction?: 'terminate' | 'pause';
  tabSwitchAutoSubmitLimit?: number;
  kioskMode?: boolean;
}

type SubjectStatus = "Pending" | "In-Progress" | "Submitted";

interface SubjectRow extends ExamSubjectInfo {
  status: SubjectStatus;
}

function takeState(
  state: SubjectsLocationState | null,
  sessionId: number,
  subject: ExamSubjectInfo,
  data: SessionSubjects,
  startedAt: string,
) {
  return {
    sessionId,
    prefetchedSession: state?.prefetchedSession ?? null,
    randomizeQuestions: state?.randomizeQuestions,
    randomizeOptions: state?.randomizeOptions,
    questionDirection: state?.questionDirection,
    tabSwitchDetection: state?.tabSwitchDetection,
    tabSwitchAction: state?.tabSwitchAction,
    tabSwitchAutoSubmitLimit: state?.tabSwitchAutoSubmitLimit,
    kioskMode: state?.kioskMode,
    selectedSubjectId: subject.id,
    selectedSubjectName: subject.name,
    subjects: data.subjects,
    sectionConfig: data.sectionConfig,
    subjectStartedAt: startedAt,
  };
}

const statusVariant = {
  "Pending": "secondary",
  "In-Progress": "default",
  "Submitted": "success",
} as const;

export default function SubjectsPage() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as SubjectsLocationState | null;
  const { setSessionId: setCtxSessionId } = useExamSession();

  const [data, setData] = useState<SessionSubjects | null>(null);
  const [sessionId, setSessionId] = useState<number | undefined>(state?.sessionId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<number | null>(null);
  const [submittingExam, setSubmittingExam] = useState(false);

  // Kiosk is owned once by ExamSessionProvider (armed on Second Loading, stays
  // on across subject ↔ take navigation) — this page never enters/exits it.

  // Escape hatch: every subject is submitted but the exam itself never got
  // submitted (tab closed between the two calls, refresh, etc.).
  const handleSubmitExam = useCallback(async () => {
    if (!sessionId || submittingExam || !data) return;
    setSubmittingExam(true);
    try {
      await candidateExamApi.submitExam(sessionId);
      toast.success("Exam submitted successfully.");
      navigate(`/exam/${examId}/result`, {
        replace: true,
        state: {
          answers: {},
          candidateName: "",
          candidateRollNumber: "",
          examTitle: data.examTitle,
          subjectName: "",
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit exam.");
    } finally {
      setSubmittingExam(false);
    }
  }, [sessionId, submittingExam, data, examId, navigate]);

  // Resolve the session, then load subjects. Single-subject exams pass
  // straight through to the take page with identical state as before.
  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        let sid = state?.sessionId;
        if (!sid) {
          const check = await candidateExamApi.getExamSession(Number(examId));
          if (check.alreadyAttempted) {
            navigate(`/exam/${examId}/result`, { replace: true });
            return;
          }
          if (!check.hasSession || !check.sessionId) {
            throw new Error("No active exam session found. Please start the exam from the instructions page.");
          }
          sid = check.sessionId;
        }
        const subjects = await candidateExamApi.getSessionSubjects(sid);
        if (cancelled) return;
        setSessionId(sid);
        setCtxSessionId(sid);
        setData(subjects);
        if (subjects.subjects.length <= 1) {
          const only = subjects.subjects[0];
          const startedAt =
            subjects.progress.find((p) => p.subjectId === only?.id)?.startedAt ??
            new Date().toISOString();
          navigate(`/exam/${examId}/take`, {
            replace: true,
            state: {
              ...(state ?? {}),
              sessionId: sid,
              selectedSubjectId: only?.id ?? null,
              selectedSubjectName: only?.name ?? "",
              subjects: subjects.subjects,
              sectionConfig: subjects.sectionConfig,
              subjectStartedAt: startedAt,
            },
          });
          return;
        }
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load subjects.");
        setLoading(false);
      }
    };
    boot();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot boot per exam
  }, [examId]);

  const rows: SubjectRow[] = useMemo(() => {
    if (!data) return [];
    const statusById = new Map(data.progress.map((p) => [p.subjectId, p.status] as const));
    return data.subjects.map((s) => {
      const raw = statusById.get(s.id);
      return {
        ...s,
        status: raw === "completed" ? "Submitted" : raw === "in-progress" ? "In-Progress" : "Pending",
      };
    });
  }, [data]);

  const hasInProgress = rows.some((r) => r.status === "In-Progress");
  const submittedCount = rows.filter((r) => r.status === "Submitted").length;
  const allSubmitted = rows.length > 0 && submittedCount === rows.length;

  const handleSelect = useCallback(async (subject: ExamSubjectInfo, status: SubjectStatus) => {
    if (!sessionId || !data || startingId) return;
    if (status === "Submitted") {
      toast.info("This subject is already submitted.");
      return;
    }
    const otherInProgress = data.progress.find(
      (p) => p.status === "in-progress" && p.subjectId !== subject.id,
    );
    if (otherInProgress) {
      toast.info("Complete the in-progress subject before starting another.");
      return;
    }
    setStartingId(subject.id);
    try {
      const progress = await candidateExamApi.startSubject(sessionId, subject.id);
      const refreshed = await candidateExamApi.getSessionSubjects(sessionId);
      setData(refreshed);
      navigate(`/exam/${examId}/take`, {
        replace: true,
        state: takeState(state, sessionId, subject, refreshed, progress.startedAt),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to start subject.");
    } finally {
      setStartingId(null);
    }
  }, [sessionId, data, startingId, examId, navigate, state]);

  if (error && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold">Couldn&apos;t load subjects</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{error}</p>
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

  if (loading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <div className="w-full max-w-2xl space-y-4">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>{data?.examTitle ?? "Exam Subjects"}</CardTitle>
          <CardDescription>
            Select a subject to begin. You can attend one subject at a time —{" "}
            {submittedCount} of {rows.length} submitted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.map((subject) => {
            const done = subject.status === "Submitted";
            const active = subject.status === "In-Progress";
            const locked = !done && !active && hasInProgress;
            return (
              <div
                key={subject.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  {done ? (
                    <CheckCircle2 className="size-5 text-emerald-600" />
                  ) : (
                    <BookOpen className="size-5 text-primary" />
                  )}
                </span>
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-semibold">{subject.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {subject.code} · {subject.questionCount} questions
                    {subject.allowedMinutes != null && (
                      <span className="ml-1 inline-flex items-center gap-1">
                        <Clock className="size-3" /> {subject.allowedMinutes} min
                      </span>
                    )}
                  </p>
                </div>
                <Badge variant={statusVariant[subject.status]}>{subject.status}</Badge>
                {done ? (
                  <Button size="sm" variant="outline" disabled>
                    <CheckCircle2 className="size-3.5" />
                    Submitted
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={locked || startingId !== null}
                    title={locked ? "Finish the in-progress subject first" : undefined}
                    onClick={() => handleSelect(subject, subject.status)}
                  >
                    {startingId === subject.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : active ? (
                      <Hourglass className="size-3.5" />
                    ) : (
                      <Play className="size-3.5" />
                    )}
                    {startingId === subject.id
                      ? "Starting..."
                      : active
                        ? "Continue"
                        : "Start"}
                  </Button>
                )}
              </div>
            );
          })}
          {hasInProgress && (
            <p className="text-center text-xs text-muted-foreground">
              Finish the in-progress subject before starting another.
            </p>
          )}
          {allSubmitted && (
            <Button
              className="w-full"
              onClick={handleSubmitExam}
              disabled={submittingExam}
            >
              {submittingExam ? "Submitting..." : "Submit Exam"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
