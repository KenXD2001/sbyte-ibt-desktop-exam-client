import { User, FileText, Eye } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SupportTicketMessage } from "@/services/api"

const formatDate = (date: string) => {
  const d = new Date(date)
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface TicketMessageBubbleProps {
  message: SupportTicketMessage
}

export default function TicketMessageBubble({ message }: TicketMessageBubbleProps) {
  const isUser = message.senderRole === "CANDIDATE"

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        isUser
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground",
      )}>
        {isUser ? <User className="size-3.5" /> : "S"}
      </div>
      <div className={cn("flex max-w-[80%] flex-col gap-1", isUser ? "items-end" : "items-start")}>
        <div className={cn("flex items-center gap-2", isUser && "flex-row-reverse")}>
          <span className="text-xs font-medium">{message.senderName}</span>
          <span className="text-[10px] text-muted-foreground">{formatDate(message.createdAt)}</span>
        </div>
        <div className={cn(
          "rounded-2xl px-4 py-2.5 text-sm",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted text-foreground rounded-tl-sm",
        )}>
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
        {message.attachments && message.attachments.length > 0 && (
          <div className={cn("flex flex-wrap gap-1.5 mt-1", isUser && "justify-end")}>
            {message.attachments.map((att) => (
              <button
                key={att.id}
                onClick={() => window.open(att.fileUrl, '_blank', 'noopener,noreferrer')}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors hover:opacity-80",
                  isUser ? "bg-primary-foreground/50 border-primary-foreground/20" : "bg-background border-border",
                )}
              >
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="font-medium max-w-[120px] truncate">{att.fileName}</span>
                <span className="text-muted-foreground">({formatFileSize(att.fileSize)})</span>
                <Eye className="size-3 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
