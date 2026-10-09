import { ChevronRight } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SidebarMenuItem } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { useActive } from "../hooks/useActive"
import type { NavItemConfig } from "../types"
import { SubMenu } from "./SubMenu"

type Props = {
  item: NavItemConfig
  onNavigate?: () => void
}

/**
 * CollapsibleMenuItem — parent MainMenu with SubMenu
 * Handles expand/collapse, parent-active highlight, tooltip when collapsed.
 * Single-role portal: no hasAccess filtering, all children render.
 * Kept for parity with admin; candidate config currently has no children.
 */
export function CollapsibleMenuItem({ item, onNavigate }: Props) {
  const { isParentActive } = useActive()
  const { state, isMobile } = useSidebar()

  if (!item.children || item.children.length === 0) return null

  const parentActive = isParentActive(item.children)

  const trigger = (
    <CollapsibleTrigger
      className={cn(
        "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-indigo-400/30 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-2 group-data-[collapsible=icon]:mx-auto",
        parentActive ? "bg-white/10 text-white" : "text-indigo-200/70 hover:bg-white/10 hover:text-white"
      )}
    >
      <item.icon className="size-4 shrink-0" />
      <span className="flex-1 truncate text-left group-data-[collapsible=icon]:hidden">{item.label}</span>
      <ChevronRight className="size-3.5 shrink-0 text-indigo-300/50 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 group-data-[collapsible=icon]:hidden" />
    </CollapsibleTrigger>
  )

  return (
    <Collapsible defaultOpen={parentActive} className="group/collapsible">
      <SidebarMenuItem>
        {state === "collapsed" && !isMobile ? (
          <Tooltip>
            <TooltipTrigger render={trigger} />
            <TooltipContent side="right" align="center">
              {item.label}
            </TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}

        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <SubMenu items={item.children} onNavigate={onNavigate} />
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}
