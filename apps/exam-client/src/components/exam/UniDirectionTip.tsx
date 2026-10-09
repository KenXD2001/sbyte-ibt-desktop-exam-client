import type { ReactNode } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

/**
 * Wraps a disabled control in unidirectional exams: the trigger span keeps
 * hover alive (disabled buttons have pointer-events:none), shows the
 * not-allowed cursor, and opens the shadcn tooltip after a 1s hover.
 */
export function UniDirectionTip({
  active,
  className,
  children,
}: {
  active: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (!active) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger
        delay={1000}
        render={<span className={className ? `${className} cursor-not-allowed` : "cursor-not-allowed"} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">
        This exam is unidirectional — use Save &amp; Next to move forward.
      </TooltipContent>
    </Tooltip>
  );
}
