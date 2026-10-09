import { NavLink } from "react-router-dom"
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { useActive } from "../hooks/useActive"
import type { NavItemConfig } from "../types"

type Props = {
  item: NavItemConfig
  onNavigate?: () => void
}

/**
 * MainMenuItem — leaf menu entry (no children)
 * Renders a single NavLink with active/hover styles for dark-blue theme.
 * Single-role portal: all items always visible, no hasAccess gating.
 */
export function MainMenuItem({ item, onNavigate }: Props) {
  const { isActive } = useActive()

  if (!item.to) return null

  const active = isActive(item.to)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={item.label}
        className={cn(
          "h-8 rounded-md gap-2.5 px-2 text-sm font-medium transition-colors",
          active
            ? "bg-white text-indigo-950 shadow-sm hover:bg-white hover:text-indigo-950"
            : "text-indigo-200/70 hover:bg-white/10 hover:text-white"
        )}
        render={<NavLink to={item.to!} onClick={onNavigate} />}
      >
        <item.icon className="size-4 shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
