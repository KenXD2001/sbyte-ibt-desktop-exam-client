import { useState } from "react"
import { ChevronDown, Search, MessageSquare } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const faqs = [
  {
    question: "How do I start an exam?",
    answer: "Navigate to 'My Exams' from the sidebar, find your scheduled exam, and click 'Start Exam'. Ensure you have a stable internet connection before beginning. The button will be enabled only at the scheduled start time.",
  },
  {
    question: "What happens if I lose connection during an exam?",
    answer: "Your progress is auto-saved periodically (every 30 seconds). You can resume the exam from where you left off once your connection is restored. If the issue persists, contact support or raise a ticket from this page.",
  },
  {
    question: "How are my results calculated?",
    answer: "Results are calculated based on the total marks obtained divided by the maximum marks, converted to a percentage. Grade boundaries are determined by the examination board and published along with the results.",
  },
  {
    question: "Can I review my answers after submitting?",
    answer: "Yes, you can view your submitted answers and the correct answers in the 'My Results' section after the exam has been evaluated and published by the institution.",
  },
  {
    question: "How do I raise a support ticket?",
    answer: "Click on the 'Raise Support Ticket' card on this page, then go to the 'Raise a Ticket' tab. Fill in the subject, category, priority, and description. You can also attach relevant files. Our support team will respond within 24 hours.",
  },
  {
    question: "What should I do if I encounter a technical glitch?",
    answer: "First, try refreshing the page and clearing your browser cache. If the issue persists, take a screenshot, raise a support ticket with the screenshot attached, and our technical team will assist you promptly.",
  },
]

export default function FAQSection() {
  const [search, setSearch] = useState("")
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const filtered = faqs.filter(
    (f) =>
      f.question.toLowerCase().includes(search.toLowerCase()) ||
      f.answer.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Frequently Asked Questions</CardTitle>
            <CardDescription>Quick answers to common questions</CardDescription>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search FAQs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquare className="mb-3 size-10 text-muted-foreground" />
            <h3 className="text-sm font-semibold">No FAQs found</h3>
            <p className="mt-1 text-xs text-muted-foreground">Try searching with different keywords</p>
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map((faq, index) => (
              <div key={index}>
                <button
                  onClick={() => setOpenIndex(openIndex === index ? null : index)}
                  className="flex w-full items-center justify-between py-4 text-left transition-colors hover:text-foreground/80 gap-4"
                >
                  <span className="text-sm font-medium">{faq.question}</span>
                  <ChevronDown className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                    openIndex === index && "rotate-180",
                  )} />
                </button>
                {openIndex === index && (
                  <div className="pb-4 text-sm text-muted-foreground leading-relaxed">
                    {faq.answer}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
