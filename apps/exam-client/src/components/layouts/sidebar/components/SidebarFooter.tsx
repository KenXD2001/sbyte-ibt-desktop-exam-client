import { NavLink } from "react-router-dom"
import { HelpCircle } from "lucide-react"
import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarSeparator, useSidebar } from "@/components/ui/sidebar"

/**
 * SidebarFooter — Bottom area of MainSidebar
 * Help & Support link (admin pattern) above the signed-in
 * candidate profile (avatar initials + name/email) with logout.
 * Dark-blue theme to match MainSidebar.
 */
export function AppSidebarFooter() {
  const { setOpenMobile } = useSidebar()

  return (
    <div className="mt-auto">
      <SidebarSeparator className="mx-3 bg-white/10 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:w-8" />
      <SidebarGroup className="py-2 group-data-[collapsible=icon]:py-1.5">
        <SidebarGroupContent>
          <SidebarMenu className="gap-1 px-2 group-data-[collapsible=icon]:px-1.5">
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Help & Support"
                className="h-8 rounded-md gap-2.5 px-2 text-indigo-200/60 hover:bg-white/10 hover:text-white"
                render={<NavLink to="/support" onClick={() => setOpenMobile(false)} />}
              >
                <HelpCircle className="size-4 shrink-0" />
                <span className="text-sm font-medium">Help & Support</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </div>
  )
}
