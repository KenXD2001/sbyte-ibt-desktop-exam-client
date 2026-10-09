import type { ComponentType } from "react"

export type SubItem = {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  badge?: string
}

export type NavItemConfig = {
  label: string
  icon: ComponentType<{ className?: string }>
  to?: string
  badge?: string
  children?: SubItem[]
}

export type NavSection = {
  id: string
  label: string
  items: NavItemConfig[]
}
