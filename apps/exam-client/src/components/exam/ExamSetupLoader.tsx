import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SetupStepStatus = "pending" | "active" | "done" | "error" | "skipped";

export interface SetupStep {
  id: string;
  /** Layman-facing label — never mention internals (APIs, models, SFU). */
  label: string;
  status: SetupStepStatus;
}

/**
 * ExamSetupLoader — premium full-screen setup experience for candidates.
 *
 * Used twice on the Instructions flow:
 *  1. Initial load — fetching everything before instructions are shown.
 *  2. Submit phase — preparing + saving before entering the main exam.
 *
 * Copy rule: labels must stay in plain language so candidates never learn
 * what is technically being fetched (no "API", "model", "mediasoup", "SFU").
 */
export default function ExamSetupLoader({
  title,
  subtitle,
  steps,
  progress,
  currentMessage,
  error,
  onRetry,
  onClose,
  overlay = false,
}: {
  title: string;
  subtitle?: string;
  steps: SetupStep[];
  /** 0–100 */
  progress: number;
  currentMessage: string;
  error?: string | null;
  onRetry?: () => void;
  onClose?: () => void;
  /** Render as an overlay above the instructions instead of a full page. */
  overlay?: boolean;
}) {
  const failed = !!error;
  const doneCount = steps.filter((s) => s.status === "done" || s.status === "skipped").length;

  return (
    <div
      className={cn(
        "flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10",
        overlay && "fixed inset-0 z-50 min-h-0 bg-background/80 py-4 backdrop-blur-sm",
      )}
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-md animate-scaleIn overflow-hidden rounded-2xl border bg-card shadow-soft-lg">
        {/* Brand header */}
        <div className="relative overflow-hidden border-b bg-gradient-to-br from-primary/10 via-primary/[0.06] to-transparent px-6 pb-5 pt-6">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-10 size-36 rounded-full bg-primary/10 blur-2xl"
          />
          <div className="relative flex items-start gap-4">
            <div className="relative shrink-0">
              {!failed && (
                <span
                  aria-hidden
                  className="absolute inset-0 animate-ping rounded-2xl bg-primary/20 [animation-duration:1.8s]"
                />
              )}
              <div
                className={cn(
                  "relative flex size-13 items-center justify-center rounded-2xl p-3 transition-colors duration-500",
                  failed ? "bg-destructive/10" : "bg-primary/10",
                )}
              >
                {failed ? (
                  <XCircle className="size-6 text-destructive" />
                ) : progress >= 100 ? (
                  <CheckCircle2 className="size-6 text-emerald-600" />
                ) : (
                  <Loader2 className="size-6 animate-spin text-primary" />
                )}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <ShieldCheck className="size-3.5 text-primary" />
                Secure exam setup
              </p>
              <h1 className="mt-1 text-lg font-semibold leading-tight tracking-tight">{title}</h1>
              {subtitle && <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>}
            </div>
          </div>

          {/* Progress bar */}
          <div className="relative mt-5">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500 ease-out",
                  failed ? "bg-destructive" : "bg-gradient-to-r from-primary/80 to-primary",
                )}
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span key={currentMessage} className="animate-fadeIn truncate text-muted-foreground">
                {currentMessage}
              </span>
              <span className="ml-3 shrink-0 font-semibold tabular-nums text-foreground">
                {Math.round(Math.min(100, Math.max(0, progress)))}%
              </span>
            </div>
          </div>
        </div>

        {/* Steps */}
        <ul className="space-y-1 px-4 py-4">
          {steps.map((step, i) => (
            <li
              key={step.id}
              className={cn(
                "flex animate-slideUp items-center gap-3 rounded-xl px-3 py-2 transition-colors duration-300",
                step.status === "active" && "bg-primary/[0.07]",
                step.status === "error" && "bg-destructive/[0.06]",
              )}
              style={{ animationDelay: `${Math.min(i * 60, 300)}ms` }}
            >
              <span className="flex size-6 shrink-0 items-center justify-center">
                {step.status === "done" ? (
                  <CheckCircle2 className="size-5 text-emerald-600" />
                ) : step.status === "active" ? (
                  <Loader2 className="size-5 animate-spin text-primary" />
                ) : step.status === "error" ? (
                  <XCircle className="size-5 text-destructive" />
                ) : step.status === "skipped" ? (
                  <span className="size-2 rounded-full bg-muted-foreground/30" />
                ) : (
                  <span className="size-2 rounded-full bg-muted-foreground/25" />
                )}
              </span>
              <span
                className={cn(
                  "flex-1 text-[13px] leading-snug",
                  step.status === "done"
                    ? "font-medium text-foreground"
                    : step.status === "active"
                      ? "font-semibold text-foreground"
                      : step.status === "error"
                        ? "font-medium text-destructive"
                        : "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
              <span
                className={cn(
                  "shrink-0 text-[11px] font-medium",
                  step.status === "done"
                    ? "text-emerald-600"
                    : step.status === "active"
                      ? "text-primary"
                      : step.status === "error"
                        ? "text-destructive"
                        : "text-muted-foreground/60",
                )}
              >
                {step.status === "done"
                  ? "Ready"
                  : step.status === "active"
                    ? "Working…"
                    : step.status === "error"
                      ? "Failed"
                      : step.status === "skipped"
                        ? "Skipped"
                        : doneCount > i
                          ? "Waiting…"
                          : "Queued"}
              </span>
            </li>
          ))}
        </ul>

        {/* Error panel */}
        {failed && (
          <div className="mx-4 mb-2 flex animate-fadeIn items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/[0.05] px-3.5 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-destructive">Something didn&apos;t load correctly</p>
              <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">{error}</p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t bg-muted/30 px-4 py-3.5">
          {failed ? (
            <div className="flex items-center gap-2">
              {onClose && (
                <Button variant="outline" className="flex-1" onClick={onClose}>
                  Close
                </Button>
              )}
              {onRetry && (
                <Button className="flex-1" onClick={onRetry}>
                  Try again
                </Button>
              )}
            </div>
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              Please wait — don&apos;t close or refresh this window.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
