import { Outlet } from "react-router-dom"

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { MainSidebar } from "@/components/layouts/sidebar"
import { Header } from "@/components/layouts/Header"
import { ErrorBoundary } from "@/components/ui/error-boundary"
import { BreadcrumbsProvider } from "@/hooks/useBreadcrumbs"

export function MainLayout() {
  return (
    <SidebarProvider>
      <BreadcrumbsProvider>
        <MainSidebar />
        <SidebarInset className="overflow-hidden h-svh">
          <Header />
          <div className="flex-1 overflow-y-auto p-4 md:p-6">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </SidebarInset>
      </BreadcrumbsProvider>
    </SidebarProvider>
  )
}
