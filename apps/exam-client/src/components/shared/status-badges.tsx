import { CheckCircle2, Clock, Pencil, XCircle, MinusCircle, type LucideIcon } from "lucide-react"

import { Badge, type badgeVariants } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type BadgeVariant = NonNullable<Parameters<typeof badgeVariants>[0]>["variant"]

interface StatusMeta {
  label: string
  variant: BadgeVariant
  icon?: LucideIcon
  showPing?: boolean
  className?: string
}

const ACTIVITY_STATUS_META: Record<string, StatusMeta> = {
  Active: { label: "Active", variant: "default", icon: CheckCircle2 },
  Inactive: { label: "Inactive", variant: "secondary" },
}

const CANDIDATE_STATUS_META: Record<string, StatusMeta> = {
  Active: { label: "Active", variant: "default", icon: CheckCircle2 },
  Pending: { label: "Pending", variant: "secondary", icon: Clock },
}

const RESULT_STATUS_META: Record<string, StatusMeta> = {
  Published: { label: "Published", variant: "default", icon: CheckCircle2 },
  "Under Evaluation": { label: "Under Evaluation", variant: "secondary", icon: Clock },
  Pending: { label: "Pending", variant: "outline", icon: Clock },
  Cancelled: { label: "Cancelled", variant: "destructive", icon: XCircle },
}

const PARTICIPANT_STATUS_META: Record<string, StatusMeta> = {
  "In Progress": { label: "In Progress", variant: "default", showPing: true },
  "in-progress": { label: "In Progress", variant: "default", showPing: true },
  Completed: { label: "Completed", variant: "outline", icon: CheckCircle2 },
  "Not Started": { label: "Not Started", variant: "secondary", icon: Clock },
  Upcoming: { label: "Upcoming", variant: "secondary" },
  Expired: { label: "Expired", variant: "destructive", icon: XCircle },
  Abandoned: { label: "Abandoned", variant: "destructive", icon: MinusCircle },
  Paused: { label: "Paused", variant: "secondary" },
  "Manual Pause": { label: "Manual Pause", variant: "secondary" },
  manual_pause: { label: "Manual Pause", variant: "secondary" },
  Resumed: { label: "Resumed", variant: "outline" },
  Terminated: { label: "Terminated", variant: "destructive", icon: XCircle },
  terminated: { label: "Terminated", variant: "destructive", icon: XCircle },
  "Manual Terminate": { label: "Manual Terminate", variant: "destructive", icon: XCircle },
  manual_terminate: { label: "Manual Terminate", variant: "destructive", icon: XCircle },
  "Submitted by Proctor": { label: "Submitted by Proctor", variant: "default", icon: CheckCircle2 },
  manual_submit: { label: "Submitted by Proctor", variant: "default", icon: CheckCircle2 },
}

const EXAM_LIVE_STATUS_META: Record<string, StatusMeta> = {
  draft: { label: "Draft", variant: "secondary" },
  published: { label: "Published", variant: "default" },
  live: { label: "Live", variant: "default", showPing: true },
  completed: { label: "Completed", variant: "outline", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", variant: "destructive", icon: XCircle },
}

const EXAM_LIFECYCLE_STATUS_META: Record<string, StatusMeta> = {
  incomplete: { label: "incomplete", variant: "secondary", icon: Pencil, className: "bg-slate-100 text-slate-600 border-slate-600" },
  scheduled: { label: "scheduled", variant: "secondary", icon: Clock, className: "bg-amber-50 text-amber-700 border-amber-700" },
  active: { label: "active", variant: "default", showPing: true, className: "bg-emerald-50 text-emerald-700 border-emerald-700" },
  ended: { label: "ended", variant: "outline", icon: CheckCircle2, className: "bg-zinc-100 text-zinc-600 border-zinc-600" },
}

function PingDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex h-2 w-2", className)}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
    </span>
  )
}

interface StatusBadgeProps {
  meta: StatusMeta
  className?: string
}

function StatusBadge({ meta, className }: StatusBadgeProps) {
  const Icon = meta.icon
  return (
    <Badge
      variant={meta.variant}
      className={cn("inline-flex items-center gap-1.5 py-0 leading-none uppercase", meta.className, className)}
    >
      {meta.showPing && <PingDot />}
      {Icon && <Icon className="h-3 w-3" />}
      {meta.label}
    </Badge>
  )
}

/**
 * resolveMeta — exact match first, then case-insensitive fallback
 * (covers API values like "active" vs "Active"), else plain outline.
 */
function resolveMeta(map: Record<string, StatusMeta>, status: string): StatusMeta {
  if (map[status]) return map[status]
  const key = Object.keys(map).find((k) => k.toLowerCase() === status.toLowerCase())
  if (key) return map[key]
  return { label: status, variant: "outline" as const }
}

export function ActivityStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = ACTIVITY_STATUS_META[status] ?? { label: status, variant: "outline" as const }
  return <StatusBadge meta={meta} className={className} />
}

export function CandidateStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = CANDIDATE_STATUS_META[status] ?? { label: status, variant: "outline" as const }
  return <StatusBadge meta={meta} className={className} />
}

export function ResultStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = RESULT_STATUS_META[status] ?? { label: status, variant: "outline" as const }
  return <StatusBadge meta={meta} className={className} />
}

export function ParticipantStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = PARTICIPANT_STATUS_META[status] ?? { label: status, variant: "outline" as const }
  return <StatusBadge meta={meta} className={className} />
}

export function ExamLifecycleStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = resolveMeta(EXAM_LIFECYCLE_STATUS_META, status)
  return <StatusBadge meta={meta} className={className} />
}

interface LiveExamBadgeProps {
  isLive: boolean
  status: string
  className?: string
}

export function LiveExamStatusBadge({ isLive, status, className }: LiveExamBadgeProps) {
  if (isLive) {
    return (
      <Badge variant="default" className={cn("inline-flex items-center gap-1.5 text-green-50 bg-green-600 hover:bg-green-600", className)}>
        <PingDot className="text-green-200" />
        Live
      </Badge>
    )
  }
  const meta = EXAM_LIVE_STATUS_META[status] ?? { label: status, variant: "outline" as const }
  return <StatusBadge meta={meta} className={className} />
}
