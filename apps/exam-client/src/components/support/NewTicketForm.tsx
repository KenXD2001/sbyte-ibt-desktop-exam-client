import { useState, useRef, useCallback } from "react"
import {
  Send, Paperclip, X, FileText, Loader2,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useCreateSupportTicket, useUploadFile } from "@/hooks/queries/use-support"
import { toast } from "sonner"
import { TICKET_CATEGORIES, TICKET_PRIORITIES, PRIORITY_LABELS, type TicketPriority } from "@/lib/support-constants"

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface NewTicketFormProps {
  onSuccess?: () => void
}

export default function NewTicketForm({ onSuccess }: NewTicketFormProps) {
  const [subject, setSubject] = useState("")
  const [category, setCategory] = useState("")
  const [priority, setPriority] = useState<TicketPriority>("medium")
  const [description, setDescription] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const createTicket = useCreateSupportTicket()
  const uploadFile = useUploadFile()

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)])
    }
  }, [])

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!subject.trim() || !category || !description.trim()) return
    setIsSubmitting(true)
    try {
      const attachments: { fileName: string; fileSize: number; fileType: string; fileUrl: string }[] = []

      for (let i = 0; i < files.length; i++) {
        setUploadProgress(`Uploading ${files[i].name} (${i + 1}/${files.length})...`)
        const result = await uploadFile.mutateAsync(files[i])
        attachments.push({
          fileName: result.fileName,
          fileSize: result.fileSize,
          fileType: result.fileType,
          fileUrl: result.url,
        })
      }

      setUploadProgress(null)

      await createTicket.mutateAsync({
        subject: subject.trim(),
        description: description.trim(),
        category,
        priority,
        attachments: attachments.length > 0 ? attachments : undefined,
      })
      toast.success("Support ticket submitted successfully")
      setSubject("")
      setCategory("")
      setPriority("medium")
      setDescription("")
      setFiles([])
      onSuccess?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit ticket. Please try again after some time..")
    } finally {
      setIsSubmitting(false)
      setUploadProgress(null)
    }
  }, [subject, category, priority, description, files, createTicket, uploadFile, onSuccess])

  const isFormValid = subject.trim() && category && description.trim()

  return (
    <Card>
      <CardContent className="p-6">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Subject *</label>
              <Input
                placeholder="Brief title of your issue"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Category *</label>
              <Select value={category} onValueChange={(v) => setCategory(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Priority</label>
            <div className="flex gap-2">
              {TICKET_PRIORITIES.map((p) => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all",
                    priority === p
                      ? p === "high"
                        ? "border-red-300 bg-red-50 text-red-700"
                        : p === "medium"
                        ? "border-yellow-300 bg-yellow-50 text-yellow-700"
                        : "border-green-300 bg-green-50 text-green-700"
                      : "border-input bg-background text-muted-foreground hover:border-muted-foreground/30",
                  )}
                >
                  {PRIORITY_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description *</label>
            <Textarea
              placeholder="Describe your issue in detail..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-32 resize-y text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Attachments</label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/30 px-4 py-6 transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <Paperclip className="mb-2 size-6 text-muted-foreground" />
              <p className="text-sm font-medium">Click to upload files</p>
              <p className="text-xs text-muted-foreground mt-1">PDF, Images, Docs, ZIP (max 10MB each)</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileChange}
              className="hidden"
              accept="image/*,.pdf,.doc,.docx,.txt,.zip"
            />
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-xs"
                  >
                    <FileText className="size-3.5 text-muted-foreground" />
                    <span className="max-w-[150px] truncate font-medium">{file.name}</span>
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
          </div>

          <div className="flex items-center justify-end gap-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              {uploadProgress || "Our team typically responds within 24 hours"}
            </p>
            <Button onClick={handleSubmit} disabled={!isFormValid || isSubmitting} size="default">
              {isSubmitting ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Send className="mr-1.5 size-4" />
              )}
              Submit Ticket
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
