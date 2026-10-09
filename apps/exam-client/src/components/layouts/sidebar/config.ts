import { ClipboardList, BarChart3 } from "lucide-react"
import type { NavSection } from "./types"

export const navSections: NavSection[] = [
  {
    id: "main",
    label: "Main",
    items: [
      { label: "My Exams", icon: ClipboardList, to: "/my-exams" },
      { label: "My Results", icon: BarChart3, to: "/my-results" },
    ],
  },
]
