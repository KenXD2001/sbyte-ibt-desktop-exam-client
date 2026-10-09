import { SidebarContent } from "@/components/ui/sidebar"
import { useSidebar } from "@/components/ui/sidebar"
import { navSections } from "../config"
import { SidebarSection } from "./SidebarSection"

type Props = {
  onNavigate?: () => void
}

/**
 * SidebarMain — Main content area of MainSidebar
 * Maps navSections -> SidebarSection. Handles collapsed width via useSidebar.
 */
export function SidebarMain({ onNavigate }: Props) {
  const { setOpenMobile } = useSidebar()
  const handleNavigate = onNavigate ?? (() => setOpenMobile(false))

  return (
    <SidebarContent className="gap-0 px-0 py-2">
      {navSections.map((section) => (
        <SidebarSection key={section.id} section={section} onNavigate={handleNavigate} />
      ))}
    </SidebarContent>
  )
}
