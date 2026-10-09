import type { NavItemConfig } from "../types"
import { CollapsibleMenuItem } from "./CollapsibleMenuItem"
import { MainMenuItem } from "./MainMenuItem"

type Props = {
  item: NavItemConfig
  onNavigate?: () => void
}

/**
 * NavItem — router for MainSidebarMenu
 * Delegates to CollapsibleMenuItem if children, otherwise MainMenuItem.
 */
export function NavItem({ item, onNavigate }: Props) {
  if (item.children && item.children.length > 0) {
    return <CollapsibleMenuItem item={item} onNavigate={onNavigate} />
  }
  return <MainMenuItem item={item} onNavigate={onNavigate} />
}
