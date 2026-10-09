import { SidebarHeader, SidebarSeparator } from "@/components/ui/sidebar"

/**
 * SidebarHeader — Branding block for MainSidebar
 * R logo block (from old AppSidebar) + "Candidate Portal" title.
 * Centers logo when collapsed.
 */
export function AppSidebarHeader() {
  return (
    <SidebarHeader className="gap-0 p-0">
      <div className="flex items-center gap-2.5 px-3 py-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
        <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-white text-indigo-900">
          <span className="text-sm font-bold">R</span>
        </div>
        <div className="min-w-0 flex-1 leading-none group-data-[collapsible=icon]:hidden">
          <p className="truncate text-sm font-semibold tracking-tight text-white">Candidate Portal</p>
          <p className="truncate text-xs font-medium text-indigo-200/60">Digiparikshak</p>
        </div>
      </div>
      <SidebarSeparator className="mx-3 bg-white/10 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:w-8" />
    </SidebarHeader>
  )
}
