import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import type { ExamOption } from "@/types/exam";

interface OptionCardProps {
  option: ExamOption;
  selected: boolean;
  disabled: boolean;
  onSelect: (optionId: string) => void;
}

const labelColor = "text-muted-foreground";

export function OptionCard({ option, selected, disabled, onSelect }: OptionCardProps) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onSelect(option.id)}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border-2 p-3.5 text-left transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected
          ? "border-primary bg-primary/5"
          : "border-border bg-card hover:border-primary/40 hover:bg-muted/40",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-all duration-150",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : cn("border-muted-foreground/30", labelColor),
        )}
        aria-hidden="true"
      >
        {selected ? <Check className="size-3.5" /> : option.label}
      </div>
      <span
        className="text-sm leading-relaxed pt-0.5 [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded [&_img]:my-1 [&_p]:my-0.5"
        dangerouslySetInnerHTML={{ __html: option.text }}
      />
    </button>
  );
}
