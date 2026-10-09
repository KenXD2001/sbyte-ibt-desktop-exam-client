import { useState, useRef, useCallback } from "react"
import {
  Send, Paperclip, X, FileText, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import TicketMessageBubble from "./TicketMessageBubble"
import { useSupportTicketDetail, useAddSupportMessage, useUploadFile } from "@/hooks/queries/use-support"
import type { SupportTicket } from "@/services/api"
import { toast } from "sonner"
import {
  STATUS_LABELS,
  STATUS_VARIANTS,
  PRIORITY_LABELS,
  PRIORITY_VARIANTS,
  type TicketStatus,
  type TicketPriority,
} from "@/lib/support-constants"

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

interface TicketDetailProps {
  ticket: SupportTicket
}

export default function TicketDetail({ ticket: initialTicket }: TicketDetailProps) {
  const [replyContent, setReplyContent] = useState("")
  const [replyFiles, setReplyFiles] = useState<File[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: ticketData } = useSupportTicketDetail(initialTicket.ticketId)
  const addMessage = useAddSupportMessage()
  const uploadFile = useUploadFile()

  const ticket = ticketData || initialTicket
  const status = ticket.status as TicketStatus
  const priority = ticket.priority as TicketPriority

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setReplyFiles((prev) => [...prev, ...Array.from(e.target.files!)])
    }
  }, [])

  const removeFile = useCallback((index: number) => {
    setReplyFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleSubmitReply = useCallback(async () => {
    if (!replyContent.trim()) return
    setIsSubmitting(true)
    try {
      const attachments: { fileName: string; fileSize: number; fileType: string; fileUrl: string }[] = []
      for (const file of replyFiles) {
        const result = await uploadFile.mutateAsync(file)
        attachments.push({
          fileName: result.fileName,
          fileSize: result.fileSize,
          fileType: result.fileType,
          fileUrl: result.url,
        })
      }
      await addMessage.mutateAsync({
        ticketId: ticket.ticketId,
        content: replyContent.trim(),
        attachments: attachments.length > 0 ? attachments : undefined,
      })
      toast.success("Reply sent successfully")
      setReplyContent("")
      setReplyFiles([])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send reply. Please try again after some time..")
    } finally {
      setIsSubmitting(false)
    }
  }, [replyContent, replyFiles, ticket.ticketId, addMessage, uploadFile])

  const canReply = status !== "closed" && status !== "resolved"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANTS[status]}>
            {STATUS_LABELS[status]}
          </Badge>
          <Badge variant={PRIORITY_VARIANTS[priority]}>
            {PRIORITY_LABELS[priority]}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">{formatDate(ticket.createdAt)}</span>
      </div>

      <Separator />

      <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto pr-1">
        {ticket.messages?.map((msg) => (
          <TicketMessageBubble key={msg.id} message={msg} />
        ))}
      </div>

      {canReply && (
        <>
          <Separator />
          <div className="space-y-3">
            <Textarea
              placeholder="Type your reply..."
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              className="min-h-20 resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleSubmitReply()
                }
              }}
            />

            {replyFiles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {replyFiles.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-1.5 text-xs"
                  >
                    <FileText className="size-3.5 text-muted-foreground" />
                    <span className="max-w-[120px] truncate font-medium">{file.name}</span>
                    <span className="text-muted-foreground">({formatFileSize(file.size)})</span>
                    <button
                      onClick={() => removeFile(index)}
                      className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between">
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                  accept="image/*,.pdf,.doc,.docx,.txt,.zip"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-muted-foreground"
                >
                  <Paperclip className="mr-1.5 size-4" />
                  Attach Files
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground hidden sm:inline">Cmd+Enter to send</span>
                <Button
                  size="sm"
                  onClick={handleSubmitReply}
                  disabled={!replyContent.trim() || isSubmitting}
                >
                  {isSubmitting ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <Send className="mr-1.5 size-4" />
                  )}
                  Send
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
