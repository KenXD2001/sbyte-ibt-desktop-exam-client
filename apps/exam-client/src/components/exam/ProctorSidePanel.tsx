import { useEffect, useRef, useState } from "react";
import { Check, CheckCheck, MessagesSquare, Mic, MicOff, MonitorUp, SendHorizonal, User, Video, VideoOff, Volume2, VolumeX, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useProctorMedia } from "@/contexts/ProctorMediaContext";

export type ChatMessageStatus = "sent" | "delivered" | "read";

export interface ProctorChatMessage {
  id: string;
  sender: "candidate" | "proctor";
  text: string;
  timestamp: string;
  status?: ChatMessageStatus;
}

interface ProctorSidePanelProps {
  open: boolean;
  messages: ProctorChatMessage[];
  onSend: (text: string) => void;
  onToggle: () => void;
}

export function ProctorSidePanel({ open, messages, onSend, onToggle }: ProctorSidePanelProps) {
  const { cameraStatus, screenStatus, screenShareSupported, cameraStream, screenStream, sfuConnected, proctorAudioStream, audioBlocked, unlockProctorAudio } = useProctorMedia();
  const webcamRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoLive = !!cameraStream?.getVideoTracks().some((t) => t.readyState === "live");
  const micLive = !!cameraStream?.getAudioTracks().some((t) => t.readyState === "live" && t.enabled);
  const screenLive = !!screenStream?.getVideoTracks().some((t) => t.readyState === "live");
  const proctorAudioLive = !!proctorAudioStream?.getAudioTracks().some((t) => t.readyState === "live");
  const isCameraLive = cameraStatus === "granted" && cameraVideoLive;
  const isMicLive = cameraStatus === "granted" && micLive;
  const isScreenLive = screenStatus === "granted" && screenLive;
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isCameraLive && webcamRef.current && cameraStream) {
      webcamRef.current.srcObject = cameraStream;
      webcamRef.current.play().catch(() => {});
    }
  }, [isCameraLive, cameraStream]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, open]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput("");
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 xl:hidden"
          onClick={onToggle}
        />
      )}

      <aside
        className={cn(
          "flex flex-col border-l bg-card w-80",
          "fixed inset-y-0 right-0 z-50",
          "xl:static xl:z-0",
          open ? "translate-x-0" : "translate-x-full xl:hidden",
          "transition-transform duration-300 xl:transition-none",
        )}
      >
        {/* ── Live self preview ─────────────────────────────────────────── */}
        <div className="shrink-0 p-3 pb-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2">
                <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", isCameraLive ? "bg-emerald-500" : "bg-muted-foreground/50")} />
                <span className={cn("relative inline-flex size-2 rounded-full", isCameraLive ? "bg-emerald-500" : "bg-muted-foreground/50")} />
              </span>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Live Preview
              </p>
            </div>
            <div className="flex items-center gap-1">
              {isCameraLive && (
                <Badge variant="success" className="h-5 px-1.5 text-[10px]">Live</Badge>
              )}
              <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label="Close proctor panel" className="xl:hidden">
                <X className="size-4" />
              </Button>
            </div>
          </div>

          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-border">
            <video
              ref={webcamRef}
              autoPlay
              muted
              playsInline
              style={{ transform: "scaleX(-1)" }}
              className={cn("h-full w-full object-cover", isCameraLive ? "block" : "hidden")}
            />
            {!isCameraLive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-muted">
                <span className="flex size-10 items-center justify-center rounded-full bg-muted-foreground/10">
                  <User className="size-5 text-muted-foreground/60" strokeWidth={1.5} />
                </span>
                <span className="text-xs font-medium text-muted-foreground">Camera off</span>
                <span className="px-4 text-center text-[11px] leading-snug text-muted-foreground/70">
                  Your proctor can&apos;t see you — check Step 1 permissions
                </span>
              </div>
            )}
            {isCameraLive && (
              <>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/60 to-transparent" />
                <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                  You
                </span>
              </>
            )}
            <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full backdrop-blur-sm",
                    isCameraLive ? "bg-emerald-600 text-white" : "bg-black/60 text-white/70",
                  )}
                >
                  {isCameraLive ? <Video className="size-3" /> : <VideoOff className="size-3" />}
                </TooltipTrigger>
                <TooltipContent side="left">{isCameraLive ? "Camera on" : "Camera off"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full backdrop-blur-sm",
                    isMicLive ? "bg-emerald-600 text-white" : "bg-black/60 text-white/70",
                  )}
                >
                  {isMicLive ? <Mic className="size-3" /> : <MicOff className="size-3" />}
                </TooltipTrigger>
                <TooltipContent side="left">{isMicLive ? "Mic on" : "Mic off"}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* ── Stream health ─────────────────────────────────────────────── */}
          <div className="mt-2 space-y-1 rounded-xl border bg-muted/40 p-2">
            <StreamStatusRow
              icon={isCameraLive ? <Video className="size-3.5" /> : <VideoOff className="size-3.5" />}
              label="Camera Streaming"
              live={isCameraLive}
              activeClassName="bg-emerald-600/15 text-emerald-700"
              iconActiveClassName="text-emerald-600"
            />
            <StreamStatusRow
              icon={isMicLive ? <Mic className="size-3.5" /> : <MicOff className="size-3.5" />}
              label="Mic Streaming"
              live={isMicLive}
              activeClassName="bg-sky-600/15 text-sky-700"
              iconActiveClassName="text-sky-600"
            />
            <StreamStatusRow
              icon={<MonitorUp className="size-3.5" />}
              label={screenShareSupported ? "Screen Streaming" : "Screen Streaming (N/A on this device)"}
              live={isScreenLive}
              activeClassName="bg-violet-600/15 text-violet-700"
              iconActiveClassName="text-violet-600"
            />
            {!sfuConnected && (isCameraLive || isScreenLive) && (
              <p className="px-1 pt-0.5 text-[10px] leading-snug text-amber-700">
                Local preview is live — reconnecting proctor monitoring…
              </p>
            )}
            {/* Mobile browsers pause proctor audio until the candidate taps. */}
            {proctorAudioLive && audioBlocked && (
              <button
                onClick={unlockProctorAudio}
                className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-800"
              >
                <VolumeX className="size-3.5" />
                Tap to hear your proctor
              </button>
            )}
            {proctorAudioLive && !audioBlocked && (
              <p className="flex items-center gap-1 px-1 pt-0.5 text-[10px] leading-snug text-emerald-700">
                <Volume2 className="size-3" />
                Proctor audio on
              </p>
            )}
          </div>
        </div>

        <Separator />

        {/* ── Proctor chat ──────────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2.5 px-3 py-2.5">
            <div className="relative">
              <Avatar size="sm" className="bg-primary/10 text-primary">
                <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">P</AvatarFallback>
              </Avatar>
              <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card bg-emerald-500" />
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[13px] font-semibold">Proctor</p>
              <p className="text-[11px] text-emerald-600">Online — replies here</p>
            </div>
          </div>

          <Separator />

          <ScrollArea className="min-h-0 flex-1 bg-muted/30">
            <div className="flex flex-col gap-1.5 px-3 py-3">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <span className="flex size-11 items-center justify-center rounded-full bg-muted">
                    <MessagesSquare className="size-5 text-muted-foreground" strokeWidth={1.5} />
                  </span>
                  <p className="text-[13px] font-medium">No messages yet</p>
                  <p className="max-w-[200px] text-xs leading-relaxed text-muted-foreground">
                    Your proctor can reach you here during the exam. You can reply below.
                  </p>
                </div>
              ) : (
                messages.map((m) => {
                  const isMine = m.sender === "candidate";
                  return (
                    <div key={m.id} className={cn("flex", isMine ? "justify-end" : "justify-start")}>
                      {!isMine && (
                        <Avatar size="sm" className="mr-1.5 mt-0.5 bg-primary/10">
                          <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">P</AvatarFallback>
                        </Avatar>
                      )}
                      <div
                        className={cn(
                          "max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                          isMine
                            ? "rounded-br-md bg-primary text-primary-foreground"
                            : "rounded-bl-md border bg-card text-card-foreground",
                        )}
                      >
                        <p className="leading-relaxed break-words whitespace-pre-wrap">{m.text}</p>
                        <div className={cn("mt-1 flex items-center gap-1 text-[10px]", isMine ? "justify-end text-primary-foreground/70" : "text-muted-foreground")}>
                          <span>{formatTime(m.timestamp)}</span>
                          {isMine && <MessageTicks status={m.status} />}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <div className="shrink-0 border-t bg-card p-2.5">
            <div className="flex items-end gap-1.5">
              <Textarea
                placeholder="Reply to proctor…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                className="max-h-[96px] min-h-[38px] resize-none rounded-xl text-[13px]"
              />
              <Button
                size="icon"
                className="size-[38px] shrink-0 rounded-xl"
                disabled={!input.trim()}
                onClick={handleSend}
                aria-label="Send message"
              >
                <SendHorizonal className="size-4" />
              </Button>
            </div>
            <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">Enter to send · Shift+Enter for a new line</p>
          </div>
        </div>
      </aside>
    </>
  );
}

function StreamStatusRow({
  icon,
  label,
  live,
  activeClassName,
  iconActiveClassName,
}: {
  icon: React.ReactNode;
  label: string;
  live: boolean;
  activeClassName: string;
  iconActiveClassName: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-1 py-0.5">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md",
            live ? activeClassName : "bg-muted text-muted-foreground",
          )}
        >
          <span className={cn(!live && "text-muted-foreground", live && iconActiveClassName)}>{icon}</span>
        </span>
        <span className="truncate text-xs font-medium text-foreground">{label}</span>
      </span>
      <Badge variant={live ? "success" : "destructive"} className="h-5 shrink-0 px-2 text-[10px] font-semibold">
        <span className={cn("size-1.5 rounded-full", live ? "bg-emerald-600" : "bg-destructive")} />
        {live ? "Enabled" : "Disabled"}
      </Badge>
    </div>
  );
}

function MessageTicks({ status }: { status?: ChatMessageStatus }) {
  if (!status || status === "sent") {
    return <Check className="size-3 opacity-80" />;
  }
  if (status === "delivered") {
    return <CheckCheck className="size-3 opacity-80" />;
  }
  return <CheckCheck className="size-3 text-sky-300" />;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
