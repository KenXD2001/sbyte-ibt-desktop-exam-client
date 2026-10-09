import { Sidebar } from "@/components/ui/sidebar"
import { AppSidebarHeader } from "./components/SidebarHeader"
import { SidebarMain } from "./components/SidebarMain"
import { AppSidebarFooter } from "./components/SidebarFooter"

/**
 * MainSidebar — composes Header + Main + Footer
 * Structure: MainSidebar -> Header -> Main (MainMenu -> SubMenu) -> Footer
 * Dark-blue theme (from-indigo-950 via-slate-900 to-slate-950) matches admin portal.
 * Icons properly centered when collapsed (icon mode, tooltip).
 */
export function MainSidebar() {
  return (
    <Sidebar collapsible="icon" variant="sidebar" className="border-white/10">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950" />
      <div className="relative z-10 flex h-full w-full flex-col">
        <AppSidebarHeader />
        <SidebarMain />
        <AppSidebarFooter />
      </div>
    </Sidebar>
  )
}

export default MainSidebar
