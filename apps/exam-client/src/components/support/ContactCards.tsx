import { Mail, Phone, Ticket } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

interface ContactCardsProps {
  onRaiseTicket: () => void
}

export default function ContactCards({ onRaiseTicket }: ContactCardsProps) {
  const items = [
    {
      title: "Email Support",
      description: "Get help via email. We typically respond within 24 hours.",
      icon: Mail,
      contact: "support@rtmnu-cbt.edu",
      action: "Send Email",
      href: "mailto:support@rtmnu-cbt.edu",
    },
    {
      title: "Phone Support",
      description: "Speak with our support team during business hours.",
      icon: Phone,
      contact: "+91-123-456-7890",
      action: "Call Now",
      href: "tel:+911234567890",
    },
    {
      title: "Raise Support Ticket",
      description: "Submit a ticket for personalized support and track its progress.",
      icon: Ticket,
      contact: "We typically respond within 24 hours",
      action: "Open Ticket Center",
      onClick: onRaiseTicket,
    },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {items.map((item) => (
        <Card
          key={item.title}
          className="group transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
        >
          <CardHeader>
            <div className="flex items-start gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                <item.icon className="size-5" />
              </div>
              <div className="space-y-1">
                <CardTitle className="text-base">{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm font-medium text-foreground/90">{item.contact}</p>
            {"onClick" in item && item.onClick ? (
              <button
                onClick={item.onClick}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium whitespace-nowrap text-foreground transition-all select-none hover:bg-accent hover:text-accent-foreground"
              >
                {item.action}
              </button>
            ) : (
              <a
                href={"href" in item ? item.href : "#"}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium whitespace-nowrap text-foreground transition-all select-none hover:bg-accent hover:text-accent-foreground"
              >
                {item.action}
              </a>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
