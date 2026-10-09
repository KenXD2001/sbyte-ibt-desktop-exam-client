import type { ComponentProps, ReactNode } from "react"
import { MoreHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export { DropdownMenuItem } from "@/components/ui/dropdown-menu"

/**
 * RowActionButton — subtle icon-only action for table action columns.
 * Ghost hover effect + pointer cursor, never a full boxed button.
 */
export function RowActionButton({
  className,
  type = "button",
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      type={type}
      className={cn("cursor-pointer", className)}
      {...props}
    />
  )
}

/**
 * RowActionsMenu — canonical row-actions dropdown (reference pattern).
 * Ghost icon trigger aligned to the row end; actions live in menu items.
 */
export function RowActionsMenu({
  label = "Row actions",
  children,
}: {
  label?: string
  children: ReactNode
}) {
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              aria-label={label}
              className="cursor-pointer"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          }
        >
          <span className="sr-only">{label}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{children}</DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
