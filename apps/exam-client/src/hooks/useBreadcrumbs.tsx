import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useLocation } from "react-router-dom"

export interface Crumb {
  label: string
  href?: string
}

interface BreadcrumbsContextValue {
  crumbs: Crumb[]
  setCrumbs: (crumbs: Crumb[]) => void
}

const BreadcrumbsContext = createContext<BreadcrumbsContextValue | null>(null)

export function BreadcrumbsProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const [state, setState] = useState<{ path: string; crumbs: Crumb[] }>(() => ({
    path: location.pathname,
    crumbs: [],
  }))

  // Reset crumbs on route change. Done during render (not in an effect) so the
  // reset happens before the newly-mounted page's effect sets its own crumbs.
  if (state.path !== location.pathname) {
    setState({ path: location.pathname, crumbs: [] })
  }

  const setCrumbs = useCallback((crumbs: Crumb[]) => {
    setState((prev) =>
      prev.crumbs === crumbs ? prev : { ...prev, crumbs },
    )
  }, [])

  const value = useMemo(
    () => ({ crumbs: state.crumbs, setCrumbs }),
    [state.crumbs, setCrumbs],
  )

  return (
    <BreadcrumbsContext.Provider value={value}>
      {children}
    </BreadcrumbsContext.Provider>
  )
}

export function useBreadcrumbs() {
  const ctx = useContext(BreadcrumbsContext)
  if (!ctx) {
    throw new Error("useBreadcrumbs must be used within a BreadcrumbsProvider")
  }
  return ctx
}

export function useSetBreadcrumbs(crumbs: Crumb[]) {
  const { setCrumbs } = useBreadcrumbs()
  const key = JSON.stringify(crumbs)

  useEffect(() => {
    setCrumbs(JSON.parse(key))
  }, [key, setCrumbs])
}
