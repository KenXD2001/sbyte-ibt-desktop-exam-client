import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Clock, PanelLeft, PanelRight } from "lucide-react";
import { ConnectionStatusIndicator } from "./ConnectionStatus";
import type { ConnectionStatus } from "@/hooks/useWebSocket";

interface ExamHeaderProps {
  examTitle: string;
  subjectName: string;
  formattedTime: string;
  isLowTime: boolean;
  isCriticalTime: boolean;
  sidebarOpen: boolean;
  connectionStatus: ConnectionStatus;
  onToggleSidebar: () => void;
  onSubmitExam: () => void;
  submitLabel?: string;
  showProctorToggle?: boolean;
  proctorPanelOpen?: boolean;
  onToggleProctorPanel?: () => void;
}

export function ExamHeader({
  examTitle,
  subjectName,
  formattedTime,
  isLowTime,
  isCriticalTime,
  sidebarOpen,
  connectionStatus,
  onToggleSidebar,
  onSubmitExam,
  submitLabel = "Submit Exam",
  showProctorToggle = false,
  proctorPanelOpen = false,
  onToggleProctorPanel,
}: ExamHeaderProps) {
  const timerColor = isCriticalTime
    ? "text-destructive"
    : isLowTime
      ? "text-amber-500"
      : "text-foreground";

  const timerBorder = isCriticalTime
    ? "border-destructive/30 bg-destructive/5"
    : isLowTime
      ? "border-amber-500/30 bg-amber-500/5"
      : "border-border bg-muted";

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl border bg-card px-4 py-2.5 shadow-sm">
      <div className="flex items-center gap-3 min-w-0">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSidebar}
          className="lg:hidden shrink-0"
          aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          <PanelLeft className="size-4" />
        </Button>

        <div className="size-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-primary">CBT</span>
        </div>

        <div className="min-w-0 hidden sm:block">
          <h1 className="text-sm font-semibold leading-tight">Exam: {examTitle}</h1>
          <p className="text-[10px] text-muted-foreground truncate max-w-[240px]">{subjectName}</p>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <ConnectionStatusIndicator
          status={connectionStatus}
          className="hidden sm:inline-flex"
        />

        <div
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 transition-colors duration-300",
            timerBorder,
          )}
        >
          <Clock className={cn("size-3.5 shrink-0", timerColor)} />
          <span
            className={cn(
              "font-mono text-sm font-bold tabular-nums tracking-wider transition-colors duration-300",
              timerColor,
            )}
          >
            {formattedTime}
          </span>
        </div>

        <Button
          variant="destructive"
          size="sm"
          onClick={onSubmitExam}
          className="h-auto min-h-8 gap-1.5 py-1.5 text-center text-xs leading-tight whitespace-normal shrink-0"
        >
          {submitLabel}
        </Button>

        {showProctorToggle && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleProctorPanel}
            className="shrink-0"
            aria-label={proctorPanelOpen ? "Hide proctor panel" : "Show proctor panel"}
          >
            <PanelRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
