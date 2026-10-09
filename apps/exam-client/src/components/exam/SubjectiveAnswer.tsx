import { useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { FileText, Maximize2, QrCode, SquarePen, Trash2, UploadCloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import RichTextEditor from "@/components/ui/rich-text-editor";

interface StagedPdf {
  id: string;
  name: string;
  size: number;
}

interface SubjectiveAnswerProps {
  questionId: number;
  questionNumber: number;
  /** Display-only number within the Subjective section (falls back to questionNumber). */
  displayNumber?: number;
  examId: string | undefined;
  sessionId: number | undefined;
  /** Answer as HTML (rich-text editor output). */
  answerText: string;
  onAnswerTextChange: (html: string) => void;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Plain-text stats for an HTML answer string. */
function usePlainStats(html: string) {
  return useMemo(() => {
    const text = html
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return {
      words: text ? text.split(" ").length : 0,
      chars: text.length,
    };
  }, [html]);
}

/**
 * Subjective answer input: rich-text editor (same Tiptap base as the admin
 * exam-instructions editor) plus a frontend-only QR section for scanning
 * with a phone to upload PDF docs. PDF uploads are staged locally for now —
 * no backend call is made.
 */
export function SubjectiveAnswer({
  questionId,
  questionNumber,
  displayNumber,
  examId,
  sessionId,
  answerText,
  onAnswerTextChange,
}: SubjectiveAnswerProps) {
  const [qrOpen, setQrOpen] = useState(false);
  const [stagedPdfs, setStagedPdfs] = useState<StagedPdf[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const { words, chars } = usePlainStats(answerText);

  // Frontend-only payload: identifies the target answer slot so a future
  // phone-upload page can attach PDFs to this session + question.
  const qrPayload = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/exam/${examId ?? "0"}/upload?session=${sessionId ?? 0}&question=${questionId}`;
  }, [examId, sessionId, questionId]);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const next: StagedPdf[] = [];
    for (const f of Array.from(files)) {
      if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) continue;
      next.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: f.name, size: f.size });
    }
    if (next.length) setStagedPdfs((prev) => [...prev, ...next]);
  };

  return (
    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
      {/* Section 1 — typed answer */}
      <Card size="sm" className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <SquarePen className="size-4 text-muted-foreground" />
            Your Answer
          </CardTitle>
          <CardAction>
            <Badge variant="secondary" className="tabular-nums text-[10px]">
              {words} word{words === 1 ? "" : "s"} · {chars} chars
            </Badge>
          </CardAction>
          <CardDescription className="text-xs">
            Type and format your answer below — use Save &amp; Next to save it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RichTextEditor
            value={answerText}
            onChange={onAnswerTextChange}
            placeholder="Write your answer here..."
            minHeight="180px"
          />
        </CardContent>
      </Card>

      {/* Section 2 — scan & upload */}
      <Card size="sm" className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <QrCode className="size-4 text-muted-foreground" />
            Scan & Upload PDF
          </CardTitle>
          <CardDescription className="text-xs">
            Handwritten answer? Scan with your phone and upload a PDF.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setQrOpen(true)}
            title="Enlarge QR code"
            className="mx-auto block cursor-zoom-in rounded-lg border bg-card p-2 transition hover:opacity-90"
          >
            <QRCodeSVG value={qrPayload} size={132} level="M" role="img" aria-label={`Upload QR for question ${displayNumber ?? questionNumber}`} />
          </button>
          <ol className="list-inside list-decimal space-y-0.5 text-xs text-muted-foreground">
            <li>Point your phone camera at the QR code.</li>
            <li>Upload a photo or PDF of your answer.</li>
            <li>Linked files appear below.</li>
          </ol>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 flex-1 gap-1.5 text-xs" onClick={() => setQrOpen(true)}>
              <Maximize2 className="size-3" />
              Enlarge QR
            </Button>
            <Button variant="outline" size="sm" className="h-7 flex-1 gap-1.5 text-xs" onClick={() => fileRef.current?.click()}>
              <UploadCloud className="size-3.5" />
              Add PDF
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {stagedPdfs.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-3 text-center text-xs text-muted-foreground">
              No PDFs linked yet.
            </p>
          ) : (
            <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
              {stagedPdfs.map((pdf) => (
                <li
                  key={pdf.id}
                  className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5 text-xs"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-medium">{pdf.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{formatSize(pdf.size)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0"
                    title="Remove"
                    onClick={() => setStagedPdfs((prev) => prev.filter((p) => p.id !== pdf.id))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Badge variant="secondary" className="self-center text-[10px]">
            Preview only — backend coming soon
          </Badge>
        </CardContent>
      </Card>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Scan to upload — Q{displayNumber ?? questionNumber}</DialogTitle>
            <DialogDescription>
              Point your phone camera at this code to open the PDF upload page for this question.
            </DialogDescription>
          </DialogHeader>
          <div className="mx-auto rounded-lg border bg-card p-3">
            <QRCodeSVG value={qrPayload} size={220} level="M" role="img" aria-label={`Upload QR for question ${displayNumber ?? questionNumber}`} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
