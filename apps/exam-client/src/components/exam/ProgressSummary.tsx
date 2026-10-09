import { cn } from "@/lib/utils";

interface ProgressSummaryProps {
  answered: number;
  notAnswered: number;
  markedAnswered: number;
  markedNotAnswered: number;
  notViewed: number;
  total: number;
}

const items = [
  { key: "answered", label: "Ans", bg: "bg-emerald-500" },
  { key: "not-answered", label: "Not Ans", bg: "bg-red-500" },
  { key: "marked-answered", label: "Marked & Ans", bg: "bg-violet-500" },
  { key: "marked-not-answered", label: "Marked", bg: "bg-orange-500" },
  { key: "not-viewed", label: "Not Viewed", bg: "bg-muted-foreground/30" },
] as const;

export function ProgressSummary({ answered, notAnswered, markedAnswered, markedNotAnswered, notViewed, total }: ProgressSummaryProps) {
  const values = { answered, "not-answered": notAnswered, "marked-answered": markedAnswered, "marked-not-answered": markedNotAnswered, "not-viewed": notViewed };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-5 gap-1">
        {items.map(({ key, label, bg }) => (
          <div key={key} className="flex flex-col items-center gap-0.5 rounded-md bg-muted/50 py-1.5 px-1">
            <span className={cn("size-1.5 rounded-full shrink-0", bg)} />
            <span className="text-[9px] text-muted-foreground text-center leading-tight">{label}</span>
            <span className="text-xs font-bold tabular-nums leading-tight">
              {values[key as keyof typeof values]}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
        <span>Total:</span>
        <span className="font-semibold tabular-nums text-foreground">{total}</span>
      </div>
    </div>
  );
}
