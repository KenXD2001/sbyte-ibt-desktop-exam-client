import { Pause, Clock, ShieldCheck, Wifi, WifiOff, RefreshCw, ArrowLeft, Hourglass, MessageSquareText, ListChecks, Ban, Timer, RotateCcw, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const AUTO_EXIT_SECONDS = 10;
const END_RING_RADIUS = 54;
const END_RING_CIRCUMFERENCE = 2 * Math.PI * END_RING_RADIUS;

function useAutoExitCountdown(active: boolean, seconds: number, onExit: (() => void) | undefined) {
  const [countdown, setCountdown] = useState(seconds);
  useEffect(() => {
    setCountdown(seconds);
  }, [seconds]);
  useEffect(() => {
    if (!active) return;
    if (countdown <= 0) {
      onExit?.();
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [active, countdown, onExit]);
  return countdown;
}

/**
 * Mid-exam takeover shown when a proctor manually pauses a live session.
 * Full-screen, non-dismissible: the timer is frozen server-side and the
 * candidate must simply wait for the proctor to resume.
 */
export function MidExamPauseOverlay({
  reason,
  frozenTime,
  examTitle,
  candidateName,
  connected,
}: {
  reason: string | null;
  frozenTime: string;
  examTitle?: string;
  candidateName?: string;
  connected: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-gradient-to-b from-amber-950/95 via-background/95 to-background/95 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg animate-scaleIn rounded-2xl border border-amber-200/60 bg-card p-6 text-center shadow-2xl shadow-amber-900/20 sm:p-8">
        {/* Status pill */}
        <div className="mb-4 flex items-center justify-center gap-2">
          <Badge variant="warning" className="gap-1.5 px-3 py-1 text-xs">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
            </span>
            Paused by proctor
          </Badge>
          <Badge variant={connected ? "success" : "destructive"} className="gap-1 px-3 py-1 text-xs">
            {connected ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
            {connected ? "Connected" : "Reconnecting…"}
          </Badge>
        </div>

        {/* Icon */}
        <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-amber-100 ring-8 ring-amber-50 dark:bg-amber-500/15 dark:ring-amber-500/10">
          <Pause className="size-9 fill-amber-500 text-amber-500" />
        </div>

        <h2 className="text-xl font-bold tracking-tight">Exam Paused by Your Proctor</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {examTitle ? <span className="font-medium text-foreground">{examTitle}</span> : "Your exam"}
          {candidateName ? ` · ${candidateName}` : ""} is temporarily on hold. Stay on this screen — no action is needed from you.
        </p>

        {/* Frozen timer — this IS the exam countdown, now paused */}
        <div className="mx-auto mt-5 flex w-fit flex-col items-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-500/10">
          <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
            <Hourglass className="size-4 text-amber-600" />
            Your exam time — frozen
          </span>
          <span className="font-mono text-2xl font-bold tabular-nums tracking-widest text-amber-800 dark:text-amber-300">{frozenTime}</span>
          <span className="text-xs text-amber-700/80 dark:text-amber-400/80">remaining · not counting down while paused</span>
        </div>

        {/* Proctor's note */}
        {reason && (
          <div className="mt-4 rounded-xl border bg-muted/40 px-4 py-3 text-left">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <MessageSquareText className="size-3.5" /> Proctor&apos;s note
            </p>
            <p className="mt-1 text-sm leading-relaxed">“{reason}”</p>
          </div>
        )}

        {/* What happens next */}
        <div className="mt-4 rounded-xl border bg-card px-4 py-3 text-left">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <ListChecks className="size-3.5" /> What happens next
          </p>
          <ol className="mt-2 space-y-1.5">
            {[
              "Keep this tab open — do not refresh or close the browser.",
              "Your proctor is reviewing and will resume your exam shortly.",
              "Your timer restarts automatically the moment you are resumed.",
            ].map((step, i) => (
              <li key={step} className="flex items-start gap-2.5 text-[13px] leading-snug text-muted-foreground">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-emerald-600" />
          Every answer you saved is safe on the server.
        </p>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5" />
          No exam time is being counted while paused.
        </p>
      </div>
    </div>
  );
}

type ExamEndTone = "emerald" | "red" | "sky";

const END_TONE_STYLES: Record<ExamEndTone, { glow: string; ring: string; chip: string }> = {
  emerald: { glow: "bg-emerald-400/20", ring: "text-emerald-500", chip: "bg-emerald-50" },
  red: { glow: "bg-red-400/20", ring: "text-red-500", chip: "bg-red-50" },
  sky: { glow: "bg-sky-400/20", ring: "text-sky-500", chip: "bg-sky-50" },
};

/**
 * Shared end-of-exam screen — the exact UI + auto-close timer of the manual
 * submit success screen (ResultPage): centered card, animated status icon
 * with a circular auto-exit progress ring, title, exam info, message,
 * "{label} in Ns" countdown box and close button. The proctor terminated /
 * submitted / reset takeovers below are thin variants of this (tone, icon
 * and copy only), so every exam end looks and behaves the same.
 */
export function ExamEndScreen({
  tone,
  icon,
  title,
  examTitle,
  subjectName,
  message,
  remarksLabel,
  remarks,
  countdownLabel,
  primaryAction,
  closeLabel = "Close Now",
  onClose,
  autoExitSeconds = AUTO_EXIT_SECONDS,
  onAutoExit,
}: {
  tone: ExamEndTone;
  icon: React.ReactNode;
  title: string;
  examTitle?: string;
  subjectName?: string;
  message: string;
  remarksLabel?: string;
  remarks?: string | null;
  countdownLabel: string;
  primaryAction?: { label: string; icon?: React.ReactNode; onClick: () => void };
  closeLabel?: string;
  onClose?: () => void;
  autoExitSeconds?: number;
  onAutoExit?: () => void;
}) {
  const [countdown, setCountdown] = useState(autoExitSeconds);

  useEffect(() => {
    if (countdown <= 0) {
      (onAutoExit ?? onClose)?.();
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, onAutoExit, onClose]);

  const progress = countdown / autoExitSeconds;
  const strokeOffset = END_RING_CIRCUMFERENCE * (1 - progress);
  const styles = END_TONE_STYLES[tone];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md overflow-hidden shadow-lg animate-in fade-in-0 zoom-in-95 duration-500">
        <div className="flex flex-col items-center px-6 pt-10 pb-6">
          {/* Animated status icon with auto-exit progress ring */}
          <div className="relative mb-6">
            {/* Outer glow ring */}
            <div className={`absolute inset-0 animate-ping rounded-full duration-1000 ${styles.glow}`} />

            {/* SVG circular progress */}
            <svg
              className="relative size-32 -rotate-90"
              viewBox="0 0 120 120"
            >
              {/* Background track */}
              <circle
                cx="60"
                cy="60"
                r={END_RING_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                className="text-muted/50"
              />
              {/* Progress ring */}
              <circle
                cx="60"
                cy="60"
                r={END_RING_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                strokeLinecap="round"
                className={`${styles.ring} transition-all duration-1000 ease-linear`}
                strokeDasharray={END_RING_CIRCUMFERENCE}
                strokeDashoffset={strokeOffset}
              />
            </svg>

            {/* Icon centered inside */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className={`flex size-16 items-center justify-center rounded-full animate-in zoom-in-0 duration-500 delay-200 ${styles.chip}`}>
                {icon}
              </div>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-xl font-semibold tracking-tight text-foreground animate-in fade-in-0 duration-300 delay-300">
            {title}
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
            {message}
          </p>

          {remarks && (
            <p className="text-center text-sm leading-relaxed text-muted-foreground">
              {remarksLabel ? <span className="font-medium text-foreground">{remarksLabel}: </span> : null}
              “{remarks}”
            </p>
          )}

          {/* Countdown */}
          <div className="flex items-center justify-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
            <svg className="size-5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span className="text-sm text-muted-foreground">
              {countdownLabel}{" "}
              <span className="font-semibold tabular-nums text-foreground">{countdown}s</span>
            </span>
          </div>

          {/* Actions */}
          {primaryAction && (
            <Button
              size="sm"
              className="w-full gap-1.5"
              onClick={primaryAction.onClick}
            >
              {primaryAction.icon}
              {primaryAction.label}
            </Button>
          )}
          {onClose && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={onClose}
            >
              {closeLabel}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ExamEndCheckIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
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
  );
}

/**
 * Termination takeover shown when a proctor terminates a live session.
 * ExamEndScreen variant: same UI + auto-close timer as the manual submit
 * success screen, in the termination tone.
 */
export function TerminatedScreen({
  reason,
  examTitle,
  subjectName,
  autoExitSeconds = AUTO_EXIT_SECONDS,
  onExit,
  onAutoExit,
}: {
  reason: string | null;
  examTitle?: string;
  subjectName?: string;
  autoExitSeconds?: number;
  onExit?: () => void;
  onAutoExit?: () => void;
}) {
  return (
    <ExamEndScreen
      tone="red"
      icon={<Ban className="size-8 text-red-600" />}
      title="Your Exam Has Been Terminated"
      examTitle={examTitle}
      subjectName={subjectName}
      message="Your exam was ended by the examination team. Your submitted answers are saved and will be evaluated."
      remarksLabel="Proctor's remarks"
      remarks={reason}
      countdownLabel="Tab closes in"
      onClose={onExit}
      autoExitSeconds={autoExitSeconds}
      onAutoExit={onAutoExit ?? onExit}
    />
  );
}

/**
 * Pre-exam gate shown when the session is already terminated outside the
 * exam window (candidate visits instructions / tries to start). Entry is
 * blocked — this mirrors the in-window TerminatedScreen.
 */
export function PreExamTerminatedGate({
  reason,
  examTitle,
  onBack,
}: {
  reason?: string | null;
  examTitle?: string;
  onBack?: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md animate-scaleIn rounded-2xl border border-red-200/60 bg-card p-6 text-center shadow-soft-lg sm:p-8">
        <Badge variant="destructive" className="mb-4 gap-1.5 px-3 py-1 text-xs">
          <Ban className="size-3" />
          Exam terminated
        </Badge>

        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-red-100 ring-8 ring-red-50 dark:bg-red-500/15 dark:ring-red-500/10">
          <Ban className="size-8 text-red-600" />
        </div>

        <h1 className="text-lg font-semibold tracking-tight">Your Exam Was Terminated</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {examTitle ? <span className="font-medium text-foreground">{examTitle}</span> : "This exam"} was
          terminated by the examination team, so you can&apos;t enter. Your answers up to that point are saved.
        </p>

        {reason && (
          <div className="mt-4 rounded-xl border bg-muted/40 px-4 py-3 text-left">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Proctor&apos;s remarks</p>
            <p className="mt-1 text-sm leading-relaxed">“{reason}”</p>
          </div>
        )}

        <div className="mt-5 flex items-center gap-2">
          {onBack && (
            <Button variant="outline" className="flex-1 gap-1.5" onClick={onBack}>
              <ArrowLeft className="size-4" /> My Exams
            </Button>
          )}
        </div>

        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-emerald-600" />
          Nothing is lost — saved progress is on the server.
        </p>
      </div>
    </div>
  );
}

/**
 * Reset takeover shown when a proctor resets a live session.
 * ExamEndScreen variant: same UI + auto-exit timer as the manual submit
 * success screen, in the reset tone. The candidate restarts from scratch —
 * the primary action (and auto-exit) goes back to instructions.
 */
export function ExamResetScreen({
  reason,
  examTitle,
  subjectName,
  onRestart,
  autoExitSeconds = AUTO_EXIT_SECONDS,
  onAutoExit,
}: {
  reason: string | null;
  examTitle?: string;
  subjectName?: string;
  onRestart?: () => void;
  autoExitSeconds?: number;
  onAutoExit?: () => void;
}) {
  return (
    <ExamEndScreen
      tone="sky"
      icon={<RotateCcw className="size-8 text-sky-600" />}
      title="Your Exam Has Been Reset"
      examTitle={examTitle}
      subjectName={subjectName}
      message="Your exam was reset by the examination team. Your previous attempt has been cleared so you can start again from scratch."
      remarksLabel="Proctor's remarks"
      remarks={reason}
      countdownLabel="Restarting in"
      primaryAction={
        onRestart
          ? { label: "Start Exam Again", icon: <RotateCcw className="size-4" />, onClick: onRestart }
          : undefined
      }
      autoExitSeconds={autoExitSeconds}
      onAutoExit={onAutoExit ?? onRestart}
    />
  );
}

/**
 * Pre-exam gate shown on the Instructions / Verification steps (and exam
 * load failures) when the session is already in `manual_pause`. Entry is
 * blocked server-side — this explains why and what to do.
 */
export function PreExamPauseGate({
  examTitle,
  onCheckAgain,
  checking,
  onBack,
}: {
  examTitle?: string;
  onCheckAgain: () => void;
  checking?: boolean;
  onBack?: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md animate-scaleIn rounded-2xl border border-amber-200/60 bg-card p-6 text-center shadow-soft-lg sm:p-8">
        <Badge variant="warning" className="mb-4 gap-1.5 px-3 py-1 text-xs">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
          </span>
          Entry on hold
        </Badge>

        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-amber-100 ring-8 ring-amber-50 dark:bg-amber-500/15 dark:ring-amber-500/10">
          <Pause className="size-8 fill-amber-500 text-amber-500" />
        </div>

        <h1 className="text-lg font-semibold tracking-tight">Your Exam Is Paused</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {examTitle ? <span className="font-medium text-foreground">{examTitle}</span> : "This exam"} has been
          paused by the examination team, so you can&apos;t enter right now. Your slot and saved answers are
          untouched.
        </p>

        <div className="mt-5 rounded-xl border bg-muted/40 px-4 py-3 text-left">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">What to do</p>
          <ul className="mt-2 space-y-1.5">
            {[
              "Contact your invigilator or the examination administrator — only they can resume your exam.",
              "Keep this tab open and tap Check again once they confirm it's resumed.",
              "Do not attempt to start on another device; it won't bypass the hold.",
            ].map((tip) => (
              <li key={tip} className="flex items-start gap-2 text-[13px] leading-snug text-muted-foreground">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-amber-500" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5 flex items-center gap-2">
          {onBack && (
            <Button variant="outline" className="flex-1 gap-1.5" onClick={onBack}>
              <ArrowLeft className="size-4" /> My Exams
            </Button>
          )}
          <Button className="flex-1 gap-1.5" onClick={onCheckAgain} disabled={checking}>
            <RefreshCw className={`size-4 ${checking ? "animate-spin" : ""}`} />
            {checking ? "Checking…" : "Check again"}
          </Button>
        </div>

        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-emerald-600" />
          Nothing is lost — your progress is saved on the server.
        </p>
      </div>
    </div>
  );
}

/**
 * Mid-exam takeover shown when a proctor submits a live session on the
 * candidate's behalf. ExamEndScreen variant: same UI + auto-close timer as
 * the manual submit success screen, in the submitted tone.
 */
export function ManualSubmittedScreen({
  reason,
  examTitle,
  subjectName,
  onExit,
  autoExitSeconds = AUTO_EXIT_SECONDS,
  onAutoExit,
}: {
  reason: string | null;
  examTitle?: string;
  subjectName?: string;
  onExit?: () => void;
  autoExitSeconds?: number;
  onAutoExit?: () => void;
}) {
  return (
    <ExamEndScreen
      tone="emerald"
      icon={<ExamEndCheckIcon className="size-8 text-emerald-600" />}
      title="Your Exam Has Been Submitted"
      examTitle={examTitle}
      subjectName={subjectName}
      message="Your exam was submitted by your proctor. Your saved answers have been recorded and will be evaluated."
      remarksLabel="Proctor's remarks"
      remarks={reason}
      countdownLabel="Tab closes in"
      onClose={onExit}
      autoExitSeconds={autoExitSeconds}
      onAutoExit={onAutoExit ?? onExit}
    />
  );
}

/**
 * Exam-level refresh/reset takeover (bulk Reset Exam from Normal Exam
 * Dashboard). The whole exam was wiped for a fresh clean start: show the
 * refresh screen and auto-close the window after 10s. No restart — the
 * candidate must re-enter from My Exams if needed.
 */
export function ExamRefreshScreen({
  reason,
  examTitle,
  candidateName,
  onExit,
  autoExitSeconds = AUTO_EXIT_SECONDS,
  onAutoExit,
}: {
  reason: string | null;
  examTitle?: string;
  candidateName?: string;
  onExit?: () => void;
  autoExitSeconds?: number;
  onAutoExit?: () => void;
}) {
  const countdown = useAutoExitCountdown(true, autoExitSeconds, onAutoExit ?? onExit);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-gradient-to-b from-sky-950/95 via-background/95 to-background/95 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg animate-scaleIn rounded-2xl border border-sky-200/60 bg-card p-6 text-center shadow-2xl shadow-sky-900/20 sm:p-8">
        <div className="mb-4 flex items-center justify-center">
          <Badge variant="default" className="gap-1.5 px-3 py-1 text-xs">
            <RefreshCw className="size-3" />
            Exam refreshed by administrator
          </Badge>
        </div>

        <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-sky-100 ring-8 ring-sky-50 dark:bg-sky-500/15 dark:ring-sky-500/10">
          <RefreshCw className="size-9 text-sky-600" />
        </div>

        <h2 className="text-xl font-bold tracking-tight">This Exam Has Been Refreshed</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {examTitle ? <span className="font-medium text-foreground">{examTitle}</span> : "Your exam"}
          {candidateName ? ` · ${candidateName}` : ""} was reset by the examination team for a fresh start.
          This window will close automatically — please re-enter from My Exams if instructed.
        </p>

        {reason && (
          <div className="mt-4 rounded-xl border bg-muted/40 px-4 py-3 text-left">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <MessageSquareText className="size-3.5" /> Administrator&apos;s remarks
            </p>
            <p className="mt-1 text-sm leading-relaxed">“{reason}”</p>
          </div>
        )}

        <div className="mt-4 flex items-center justify-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
          <Timer className="size-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Closing in <span className="font-semibold tabular-nums text-foreground">{countdown}s</span>
          </span>
        </div>

        {onExit && (
          <Button variant="outline" className="mt-3 w-full gap-1.5" onClick={onExit}>
            <LogOut className="size-4" /> Close Now
          </Button>
        )}
      </div>
    </div>
  );
}
