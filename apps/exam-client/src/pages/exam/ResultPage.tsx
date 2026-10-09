import { useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { useExamSession } from "@/contexts/ExamSessionContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface ResultState {
  answers: Record<number, string>;
  candidateName: string;
  candidateRollNumber: string;
  examTitle: string;
  subjectName: string;
}

const AUTO_REDIRECT_SECONDS = 10;
const CIRCLE_RADIUS = 54;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;

function SubmissionSuccess({
  examTitle,
  subjectName,
}: {
  examTitle: string;
  subjectName: string;
}) {
  const [countdown, setCountdown] = useState(AUTO_REDIRECT_SECONDS);
  const navigate = useNavigate();

  // After submission the candidate returns to the dashboard (My Exams) in the
  // SAME window — we never close the exam window here. The exam-flow kiosk is
  // already disarmed by ResultPage; leaving /exam/* also releases via provider
  // unmount, so this navigation is safe and is the in-flow release point.
  const goToDashboard = useCallback(() => {
    console.log("[Kiosk:exam-flow] exam submitted — redirecting to My Exams");
    navigate("/my-exams", { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (countdown <= 0) {
      goToDashboard();
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, goToDashboard]);

  const progress = countdown / AUTO_REDIRECT_SECONDS;
  const strokeOffset = CIRCLE_CIRCUMFERENCE * (1 - progress);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md overflow-hidden shadow-lg animate-in fade-in-0 zoom-in-95 duration-500">
        <div className="flex flex-col items-center px-6 pt-10 pb-6">
          {/* Animated checkmark */}
          <div className="relative mb-6">
            {/* Outer glow ring */}
            <div className="absolute inset-0 animate-ping rounded-full bg-emerald-400/20 duration-1000" />

            {/* SVG circular progress */}
            <svg
              className="relative size-32 -rotate-90"
              viewBox="0 0 120 120"
            >
              {/* Background track */}
              <circle
                cx="60"
                cy="60"
                r={CIRCLE_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                className="text-muted/50"
              />
              {/* Progress ring */}
              <circle
                cx="60"
                cy="60"
                r={CIRCLE_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                strokeLinecap="round"
                className="text-emerald-500 transition-all duration-1000 ease-linear"
                strokeDasharray={CIRCLE_CIRCUMFERENCE}
                strokeDashoffset={strokeOffset}
              />
            </svg>

            {/* Checkmark icon centered inside */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-emerald-50 animate-in zoom-in-0 duration-500 delay-200">
                <svg
                  className="size-8 text-emerald-600"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path
                    d="M20 6L9 17l-5-5"
                    className="animate-in fade-in-0 slide-in-from-left-2 duration-300 delay-500"
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-xl font-semibold tracking-tight text-foreground animate-in fade-in-0 duration-300 delay-300">
            Exam Submitted Successfully
          </h1>

          {/* Exam info */}
          <p className="mt-1.5 text-sm text-muted-foreground animate-in fade-in-0 duration-300 delay-400">
            {examTitle}
            {subjectName && (
              <>
                <span className="mx-1.5 text-border">•</span>
                {subjectName}
              </>
            )}
          </p>
        </div>

        <Separator />

        <CardContent className="px-6 py-5 space-y-5 animate-in fade-in-0 duration-300 delay-500">
          {/* Message */}
          <p className="text-center text-sm leading-relaxed text-muted-foreground">
            Your responses have been recorded. The result will be evaluated
            and published by the administration. You will be notified once
            the results are available.
          </p>

          {/* Countdown */}
          <div className="flex items-center justify-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
            <svg className="size-5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span className="text-sm text-muted-foreground">
              Returning to My Exams in{" "}
              <span className="font-semibold tabular-nums text-foreground">{countdown}s</span>
            </span>
          </div>

          {/* Go to dashboard button */}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => goToDashboard()}
          >
            Go to My Exams
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ResultPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as ResultState | null;
  const { disarmKiosk } = useExamSession();

  // Exam Submitted screen: release the exam-flow kiosk (armed on Second
  // Loading, held across subjects ↔ take). Leaving /exam/* also releases via
  // provider unmount — this is the in-flow release.
  useEffect(() => {
    console.log("[Kiosk:exam-flow] EXIT kiosk — reason: exam submitted screen reached (result)");
    disarmKiosk();
  }, [disarmKiosk]);

  if (!state) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">No result data available.</p>
        <Button variant="outline" onClick={() => navigate("/my-exams", { replace: true })}>
          Go to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <SubmissionSuccess
      examTitle={state.examTitle}
      subjectName={state.subjectName}
    />
  );
}
