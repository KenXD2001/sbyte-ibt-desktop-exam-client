import { useState } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import PageHeader from "@/components/shared/page-header"
import { ContactCards, FAQSection, TicketCenter } from "@/components/support"
import { useSetBreadcrumbs } from "@/hooks/useBreadcrumbs"

export default function SupportPage() {
  const [view, setView] = useState<"main" | "tickets">("main")

  useSetBreadcrumbs(
    view === "tickets"
      ? [
          { label: "My Exams", href: "/my-exams" },
          { label: "Help & Support", href: "/support" },
          { label: "Ticket Center" },
        ]
      : [{ label: "Help & Support" }],
  )

  if (view === "tickets") {
    return (
      <div className="flex flex-1 flex-col gap-6 pb-8">
        <PageHeader
          title="Ticket Center"
          description="Manage and track your support tickets"
          actions={
            <Button variant="outline" size="sm" onClick={() => setView("main")}>
              <ArrowLeft className="size-4" />
              Back to Support
            </Button>
          }
        />
        <TicketCenter />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-6 pb-8">
      <PageHeader
        title="Help & Support"
        description="Get help with the examination portal and manage your support tickets"
      />

      <ContactCards onRaiseTicket={() => setView("tickets")} />

      <FAQSection />
    </div>
  )
}
