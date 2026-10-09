import { NavLink } from "react-router-dom"
import { SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { useActive } from "../hooks/useActive"
import type { SubItem } from "../types"

type Props = {
  items: SubItem[]
  onNavigate?: () => void
}

/**
 * SubMenu — renders submenu items for a parent MainMenu
 * Used inside CollapsibleMenuItem. Handles active/hover for dark-blue theme.
 * No search filtering — static per config.
 */
export function SubMenu({ items, onNavigate }: Props) {
  const { isActive } = useActive()

  return (
    <SidebarMenuSub className="mt-1.5 mr-0 mb-0 ml-3 gap-1 border-l border-white/10 pr-0 pl-3">
      {items.map((child) => {
        const active = isActive(child.to)
        return (
          <SidebarMenuSubItem key={child.to}>
            <SidebarMenuSubButton
              isActive={active}
              className={cn(
                "flex h-7 items-center gap-2 rounded-md px-2 text-[13px] font-normal transition-colors",
                active
                  ? "bg-white text-indigo-950 font-medium shadow-sm hover:bg-white hover:text-indigo-950"
                  : "text-indigo-200/60 hover:bg-white/10 hover:text-white"
              )}
              render={<NavLink to={child.to} onClick={onNavigate} />}
            >
              <child.icon className="size-3.5 shrink-0" />
              <span className="truncate">{child.label}</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        )
      })}
    </SidebarMenuSub>
  )
}
