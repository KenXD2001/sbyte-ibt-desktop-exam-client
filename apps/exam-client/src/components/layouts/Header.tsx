import { useNavigate } from "react-router-dom"
import { LogOut, User, Settings } from "lucide-react"

import { useAuth } from "@/hooks/useAuth"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Link } from "react-router-dom"
import { useBreadcrumbs } from "@/hooks/useBreadcrumbs"

export function Header() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { crumbs } = useBreadcrumbs()

  const handleLogout = () => {
    logout()
    navigate("/auth")
  }

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "CN"

  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b bg-card px-4 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <SidebarTrigger />
        {crumbs.length > 0 && (
          <Breadcrumb className="min-w-0">
            <BreadcrumbList>
              {crumbs.map((c, i) => {
                const last = i === crumbs.length - 1
                return (
                  <span key={i} className="inline-flex items-center gap-1.5">
                    {i > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbItem>
                      {last || !c.href ? (
                        <BreadcrumbPage>{c.label}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink render={<Link to={c.href} />}>
                          {c.label}
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </span>
                )
              })}
            </BreadcrumbList>
          </Breadcrumb>
        )}
      </div>

      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button className="flex items-center gap-2 rounded-md p-1 outline-none hover:bg-accent" />
            }
          >
            <span className="hidden text-sm font-medium md:inline">
              {user?.name}
            </span>
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span>{user?.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {user?.candidateProfile?.rollNumber}
                  </span>
                  <span className="mt-1 inline-flex w-fit rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase text-primary">
                    {user?.role}
                  </span>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/settings/profile")}>
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/settings/security")}>
              <Settings className="mr-2 h-4 w-4" />
              Security
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
