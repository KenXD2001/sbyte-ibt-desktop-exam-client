import { useMemo } from "react"
import { useLocation } from "react-router-dom"
import type { SubItem } from "../types"

export function useActive() {
  const { pathname } = useLocation()

  return useMemo(() => {
    const isActive = (to: string) => {
      if (to === "/my-exams") return pathname === "/" || pathname === "/my-exams" || pathname.startsWith("/my-exams/")
      return pathname === to || pathname.startsWith(to + "/")
    }

    const isParentActive = (children?: SubItem[]) => !!children?.some((c) => isActive(c.to))

    return { isActive, isParentActive }
  }, [pathname])
}
