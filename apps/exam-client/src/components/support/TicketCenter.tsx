import { useState, useMemo } from "react"
import { Ticket, Plus, Search } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import TicketList from "./TicketList"
import NewTicketForm from "./NewTicketForm"
import { useSupportTickets } from "@/hooks/queries/use-support"
import type { SupportTicket } from "@/services/api"
import { TICKET_STATUSES, STATUS_LABELS } from "@/lib/support-constants"

type Tab = "my-tickets" | "new-ticket"

export default function TicketCenter() {
  const [activeTab, setActiveTab] = useState<Tab>("my-tickets")
  const [statusFilter, setStatusFilter] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")

  const { data, isLoading } = useSupportTickets()
  const tickets = useMemo<SupportTicket[]>(() => data || [], [data])

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        return (
          t.subject.toLowerCase().includes(q) ||
          t.ticketId.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [tickets, statusFilter, searchQuery])

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)}>
      <TabsList variant="line" className="w-full justify-start gap-0 overflow-x-auto overflow-y-hidden border-b bg-transparent px-0">
        <TabsTrigger value="my-tickets" className="gap-2 rounded-none px-4">
          <Ticket className="size-4" />
          My Tickets
          {tickets.length > 0 && (
            <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
              {tickets.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="new-ticket" className="gap-2 rounded-none px-4">
          <Plus className="size-4" />
          Raise a Ticket
        </TabsTrigger>
      </TabsList>

      <TabsContent value="my-tickets" className="mt-6">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by subject, ticket ID, or category..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
              <SelectTrigger className="w-full sm:w-[160px] h-8">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {TICKET_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 rounded-lg border px-4 py-3.5">
                  <Skeleton className="size-9 shrink-0 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-5 w-20" />
                </div>
              ))}
            </div>
          ) : (
            <TicketList tickets={filteredTickets} />
          )}
        </div>
      </TabsContent>
      <TabsContent value="new-ticket" className="mt-6">
        <NewTicketForm onSuccess={() => setActiveTab("my-tickets")} />
      </TabsContent>
    </Tabs>
  )
}
