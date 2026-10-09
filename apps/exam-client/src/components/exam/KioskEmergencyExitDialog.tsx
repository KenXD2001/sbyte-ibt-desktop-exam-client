import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isTauriEnv, kioskEmergencyExit, kioskTrace } from "@/services/tauri/commands";

const DEBUG = true;

/**
 * Proctor emergency-exit prompt.
 *
 * The native chord monitor (hold Ctrl + Alt + Shift for 5 seconds) only
 * *requests* an exit and emits `kiosk-emergency-request`. This dialog asks for
 * the proctor password and calls the Rust command, which is the ONLY thing that
 * actually releases the lockdown (window + hook + shell + registry). A
 * candidate would need to know both the hold chord AND the password.
 *
 * Rendered by ExamSessionProvider, so it is present for the whole exam flow
 * (Second Loading → Result). It cannot be dismissed by Esc/outside-click —
 * only by Cancel or a correct password.
 */
export function KioskEmergencyExitDialog() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mirror frontend milestones into the native terminal log too (the webview
  // console is not visible while the kiosk is locked down).
  const trace = useCallback((stage: string) => {
    if (!isTauriEnv()) return;
    void kioskTrace(stage).catch(() => { /* best-effort */ });
  }, []);

  useEffect(() => {
    if (!isTauriEnv()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("kiosk-emergency-request", () => {
      if (DEBUG) console.warn("[Kiosk:exam-flow] EMERGENCY combo accepted — request received, showing proctor password dialog");
      trace("request received — showing password dialog");
      setPassword("");
      setError(null);
      setSubmitting(false);
      setOpen(true);
    })
      .then((fn) => {
        if (disposed) fn();
        else {
          unlisten = fn;
          if (DEBUG) console.log("[Kiosk:exam-flow] emergency password dialog armed (listening for kiosk-emergency-request)");
        }
      })
      .catch((err) => {
        if (DEBUG) console.warn("[Kiosk:exam-flow] emergency-request listener unavailable — reason:", err);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [trace]);

  // Focus the password field whenever the prompt opens (and log the visible
  // dialog so the audit trail shows whether it actually came up).
  useEffect(() => {
    if (!open) return;
    if (DEBUG) console.warn("[Kiosk:exam-flow] EMERGENCY dialog OPEN — awaiting proctor password");
    trace("shown — awaiting proctor password");
    const t = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open, trace]);

  const cancel = useCallback(() => {
    if (DEBUG) console.warn("[Kiosk:exam-flow] EMERGENCY dialog cancelled — kiosk stays locked, no exit requested");
    trace("cancelled — kiosk stays locked");
    setOpen(false);
    setPassword("");
    setError(null);
  }, [trace]);

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await kioskEmergencyExit(password);
      if (DEBUG) console.warn("[Kiosk:exam-flow] EMERGENCY exit AUTHORIZED — password accepted, releasing lockdown");
      setOpen(false);
      setPassword("");
    } catch (err) {
      if (DEBUG) console.warn("[Kiosk:exam-flow] EMERGENCY exit REJECTED — wrong password, kiosk stays locked. reason:", err);
      setError(typeof err === "string" && err.trim() ? err : "Incorrect password");
      setPassword("");
      inputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }, [password, submitting]);

  return (
    // Controlled open with a no-op handler: Esc / outside-click must not
    // release the prompt (and therefore never the kiosk). Cancel is explicit.
    <Dialog open={open} onOpenChange={() => { /* closed only via Cancel or success */ }}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Proctor emergency exit</DialogTitle>
          <DialogDescription>
            Enter the proctor password to release the exam lockdown. This restores
            the desktop and re-enables Task Manager, Lock and Shut down.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-3"
        >
          <Input
            ref={inputRef}
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Proctor password"
            aria-label="Proctor password"
            aria-invalid={error ? true : undefined}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={cancel} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || password.length === 0}>
              {submitting ? "Unlocking…" : "Unlock exam"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
