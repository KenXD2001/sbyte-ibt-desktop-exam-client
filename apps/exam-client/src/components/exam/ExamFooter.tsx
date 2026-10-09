import { Button } from "@/components/ui/button";
import { ChevronLeft, RotateCcw, Bookmark, Loader2, BookmarkCheck, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { UniDirectionTip } from "./UniDirectionTip";

interface ExamFooterProps {
  hasPrev: boolean;
  hasNext: boolean;
  isMarkedForReview: boolean;
  selectedOption: string | null;
  isSaving: boolean;
  isMarking: boolean;
  /** Unidirectional exams: only Save & Next is usable. */
  navigationLocked?: boolean;
  onPrevious: () => void;
  onClear: () => void;
  onMarkForReview: () => void;
  onSaveNext: () => void;
}

export function ExamFooter({
  hasPrev,
  hasNext,
  isMarkedForReview,
  selectedOption,
  isSaving,
  isMarking,
  navigationLocked = false,
  onPrevious,
  onClear,
  onMarkForReview,
  onSaveNext,
}: ExamFooterProps) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t bg-background px-4 py-2.5">
      <UniDirectionTip active={navigationLocked} className="inline-flex">
        <Button
          variant="outline"
          size="sm"
          onClick={onPrevious}
          disabled={hasPrev === false || isSaving || isMarking || navigationLocked}
          className="h-8 text-xs gap-1"
        >
          <ChevronLeft className="size-3.5" />
          Previous
        </Button>
      </UniDirectionTip>

      <div className="flex items-center gap-1.5">
        <UniDirectionTip active={navigationLocked} className="inline-flex">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            disabled={!selectedOption || isSaving || isMarking || navigationLocked}
            className="h-8 text-xs gap-1.5 text-muted-foreground"
          >
            <RotateCcw className="size-3" />
            Clear
          </Button>
        </UniDirectionTip>
        <UniDirectionTip active={navigationLocked} className="inline-flex">
          <Button
            size="sm"
            onClick={onMarkForReview}
            disabled={isSaving || isMarking || navigationLocked}
            className={cn(
              "h-8 text-xs gap-1.5 font-medium",
              isMarkedForReview
                ? "bg-amber-500 text-white hover:bg-amber-600"
                : "bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 border border-amber-300",
            )}
          >
            {isMarking ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : isMarkedForReview ? (
              <BookmarkCheck className="size-3.5" />
            ) : (
              <Bookmark className="size-3.5" />
            )}
            {isMarking ? "Saving..." : isMarkedForReview ? "Marked" : "Mark for Review"}
          </Button>
        </UniDirectionTip>
      </div>

      <Button
        variant="default"
        size="sm"
        onClick={onSaveNext}
        disabled={isSaving || isMarking}
        className="h-8 text-xs gap-1.5 font-medium"
      >
        {isSaving ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ArrowRight className="size-3.5" />
        )}
        {isSaving ? "Saving..." : hasNext ? "Save & Next" : "Save"}
      </Button>
    </div>
  );
}
