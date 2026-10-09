import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu } from "@/components/ui/sidebar"
import type { NavSection } from "../types"
import { NavItem } from "./NavItem"

type Props = {
  section: NavSection
  onNavigate?: () => void
}

/**
 * SidebarSection — renders a grouped section with label + NavItems
 * Single-role portal: all items always visible, no hasAccess gating.
 */
export function SidebarSection({ section, onNavigate }: Props) {
  if (section.items.length === 0) return null

  return (
    <SidebarGroup className="py-0 group-data-[collapsible=icon]:py-1">
      <SidebarGroupLabel className="px-3 pb-1.5 pt-5 text-[11px] font-semibold tracking-widest text-indigo-200/40 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:pt-3 group-data-[collapsible=icon]:pb-1">
        <span className="group-data-[collapsible=icon]:hidden">{section.label}</span>
        <span className="hidden size-1 rounded-full bg-white/20 group-data-[collapsible=icon]:block" />
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-1 px-2 group-data-[collapsible=icon]:px-1.5">
          {section.items.map((item, idx) => (
            <NavItem key={`${section.id}-${item.label}-${idx}`} item={item} onNavigate={onNavigate} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
