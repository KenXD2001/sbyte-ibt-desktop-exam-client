import { cn } from "@/lib/utils";
import { UniDirectionTip } from "./UniDirectionTip";
import type { ExamQuestion } from "@/types/exam";

type QuestionStatus = "current" | "answered" | "not-answered" | "marked-answered" | "marked-not-answered" | "not-viewed";

interface QuestionNavigatorProps {
  questions: ExamQuestion[];
  currentQuestionNumber: number;
  getQuestionStatus: (questionNumber: number) => QuestionStatus;
  onQuestionClick: (questionNumber: number) => void;
  /** Unidirectional exams: palette is display-only, all jumps disabled. */
  disabled?: boolean;
}

const statusStyles: Record<QuestionStatus, string> = {
  current:
    "bg-indigo-500 text-white hover:bg-indigo-600",
  "not-viewed": "bg-muted text-muted-foreground hover:bg-muted/80",
  "not-answered": "bg-red-500 text-white hover:bg-red-600",
  answered: "bg-emerald-500 text-white hover:bg-emerald-600",
  "marked-answered":
    "bg-violet-500 text-white hover:bg-violet-600",
  "marked-not-answered":
    "bg-orange-500 text-white hover:bg-orange-600",
};

export function QuestionNavigator({
  questions,
  currentQuestionNumber,
  getQuestionStatus,
  onQuestionClick,
  disabled = false,
}: QuestionNavigatorProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-1">
        {[
          { status: "current" as const, label: "Current", dot: "bg-indigo-500" },
          { status: "answered" as const, label: "Answered", dot: "bg-emerald-500" },
          { status: "not-answered" as const, label: "Not Ans", dot: "bg-red-500" },
          { status: "marked-answered" as const, label: "Marked & Ans", dot: "bg-violet-500" },
          { status: "marked-not-answered" as const, label: "Marked", dot: "bg-orange-500" },
          { status: "not-viewed" as const, label: "Not Viewed", dot: "bg-muted-foreground/30" },
        ].map(({ status, label, dot }) => (
          <div key={status} className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1.5">
            <div className={cn("size-3.5 rounded-full shrink-0 ring-1 ring-black/5", dot)} />
            <span className="text-xs font-medium text-foreground min-w-0">{label}</span>
          </div>
        ))}
      </div>

      <UniDirectionTip active={disabled} className="block">
        <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Question navigator">
        {questions.map((q) => {
          const status = getQuestionStatus(q.questionNumber);
          const isActive = q.questionNumber === currentQuestionNumber;
          const display = q.displayNumber ?? q.questionNumber;
          const sectionLabel = q.questionType === "subjective" ? "Subjective" : "MCQ";
          return (
            <button
              key={q.questionNumber}
              onClick={disabled ? undefined : () => onQuestionClick(q.questionNumber)}
              aria-disabled={disabled || undefined}
              tabIndex={disabled ? -1 : undefined}
              className={cn(
                "flex items-center justify-center rounded-md text-[11px] font-medium",
                "aspect-square w-full min-w-0",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                disabled && "cursor-not-allowed opacity-60",
                statusStyles[status],
                isActive && status !== "current" && "ring-2 ring-primary ring-offset-1",
              )}
              aria-label={`${sectionLabel} question ${display}, ${status.replace(/-/g, " ")}`}
              aria-current={isActive ? "true" : undefined}
            >
              {display}
            </button>
          );
        })}
        </div>
      </UniDirectionTip>
    </div>
  );
}
