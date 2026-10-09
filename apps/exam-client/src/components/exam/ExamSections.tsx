import { CheckCircle2, ListChecks, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ExamSectionId = "mcq" | "subjective";

export interface ExamSectionInfo {
  id: ExamSectionId;
  label: string;
  count: number;
  completed: boolean;
}

interface ExamSectionsProps {
  sections: ExamSectionInfo[];
  activeId: ExamSectionId;
  /** Restricted direction: only the active section is selectable. */
  locked: boolean;
  onSelect: (id: ExamSectionId) => void;
  /** Restricted mode: submit the active section to advance. */
  onSubmitSection?: () => void;
  submitLabel?: string;
  submitting?: boolean;
}

const icons = { mcq: ListChecks, subjective: PenLine } as const;

/**
 * Section switcher rendered between the status block and the question
 * palette. Hidden by callers when the exam has a single section.
 */
export function ExamSections({
  sections,
  activeId,
  locked,
  onSelect,
  onSubmitSection,
  submitLabel = "Submit Section & Continue",
  submitting,
}: ExamSectionsProps) {
  if (sections.length <= 1) return null;
  return (
    <div className="border-b px-3 py-2.5">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Sections
      </p>
      <div className="flex flex-col gap-1.5">
        {sections.map((section) => {
          const Icon = icons[section.id];
          const active = section.id === activeId;
          const disabled = locked && !active;
          return (
            <button
              key={section.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(section.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-foreground hover:bg-muted/60",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="flex-1 truncate">{section.label}</span>
              {section.completed ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
              ) : (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {section.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {onSubmitSection && (
        <Button
          size="sm"
          className="mt-2 h-auto min-h-9 w-full gap-1.5 py-2 text-xs leading-snug whitespace-normal"
          onClick={onSubmitSection}
          disabled={submitting}
        >
          {submitLabel}
        </Button>
      )}
    </div>
  );
}
