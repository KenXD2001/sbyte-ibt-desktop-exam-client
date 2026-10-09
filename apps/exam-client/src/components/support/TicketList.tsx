import { useState } from "react"
import {
  Ticket, Clock, CheckCircle, AlertCircle, MessageSquare,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import TicketDetail from "./TicketDetail"
import type { SupportTicket } from "@/services/api"
import {
  STATUS_LABELS,
  STATUS_VARIANTS,
  PRIORITY_LABELS,
  PRIORITY_VARIANTS,
  type TicketStatus,
  type TicketPriority,
} from "@/lib/support-constants"

const STATUS_ICONS: Record<string, typeof Clock> = {
  open: AlertCircle,
  'in-progress': Clock,
  resolved: CheckCircle,
  closed: CheckCircle,
}

interface TicketListProps {
  tickets: SupportTicket[]
}

export default function TicketList({ tickets }: TicketListProps) {
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null)

  if (tickets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Ticket className="mb-3 size-12 text-muted-foreground" />
        <h3 className="text-base font-semibold">No tickets found</h3>
        <p className="mt-1 text-sm text-muted-foreground max-w-md">
          You haven&apos;t raised any support tickets yet. Go to &quot;Raise a Ticket&quot; to create one.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-2">
        {tickets.map((ticket) => {
          const status = ticket.status as TicketStatus
          const priority = ticket.priority as TicketPriority
          const StatusIcon = STATUS_ICONS[status] || AlertCircle
          const hasSupportReply = ticket.messages?.some((m) => m.senderRole !== "CANDIDATE")
          const isUnread = hasSupportReply && ticket.messages?.[ticket.messages.length - 1]?.senderRole !== "CANDIDATE"

          return (
            <Card
              key={ticket.ticketId}
              className="shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer"
              onClick={() => setSelectedTicket(ticket)}
            >
              <CardContent className="flex items-center gap-4 px-4 py-3.5">
                <div className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg",
                  status === "open" ? "bg-yellow-100 text-yellow-700" :
                  status === "in-progress" ? "bg-blue-100 text-blue-700" :
                  status === "resolved" ? "bg-green-100 text-green-700" :
                  "bg-muted text-muted-foreground",
                )}>
                  <Ticket className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{ticket.subject}</span>
                    {isUnread && (
                      <span className="size-2 shrink-0 rounded-full bg-primary" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] font-mono text-muted-foreground">{ticket.ticketId}</span>
                    <span className="text-[10px] text-muted-foreground">&middot;</span>
                    <span className="text-[11px] text-muted-foreground">{ticket.category}</span>
                  </div>
                </div>
                <div className="hidden sm:flex items-center gap-2">
                  <Badge variant={STATUS_VARIANTS[status]} className="gap-1">
                    <StatusIcon className="size-3" />
                    {STATUS_LABELS[status]}
                  </Badge>
                  <Badge variant={PRIORITY_VARIANTS[priority]}>
                    {PRIORITY_LABELS[priority]}
                  </Badge>
                </div>
                <div className="flex sm:hidden items-center gap-1.5">
                  <Badge variant={STATUS_VARIANTS[status]} className="text-[10px] px-1.5 py-0">
                    {STATUS_LABELS[status]}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground shrink-0">
                  <MessageSquare className="size-3.5" />
                  <span className="text-xs">{ticket.messages?.length || 0}</span>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Dialog open={!!selectedTicket} onOpenChange={(open) => { if (!open) setSelectedTicket(null) }}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedTicket?.subject}</DialogTitle>
            <DialogDescription>
              {selectedTicket?.ticketId} &middot; {selectedTicket?.category}
            </DialogDescription>
          </DialogHeader>
          {selectedTicket && (
            <TicketDetail ticket={selectedTicket} />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
