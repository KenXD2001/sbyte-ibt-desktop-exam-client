import { useEffect, useCallback, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { isTauriEnv, kioskEnter, kioskExit } from "@/services/tauri/commands";
import { TAURI_EVENTS } from "@/services/tauri/events";

const DEBUG = true;

// Dev builds (`pnpm dev` / `pnpm dev:tauri`, `vite build` excluded): leave a
// DevTools hatch open — right-click menu, F12, Ctrl+Shift+I/J/C. Production
// (`import.meta.env.PROD`) blocks all of them. Rust key lockdown is
// unaffected (it never blocked DevTools keys anyway).
const ALLOW_DEVTOOLS = import.meta.env.DEV === true;

// ─── Fullscreen lives in kiosk ─────────────────────────────────────────────
// Canonical gesture-valid fullscreen entry. MUST be called synchronously
// inside a button onClick: the async exam flows (API calls, navigation)
// outlive transient activation, and SPA navigation keeps the same document
// so fullscreen entered here persists onto later pages. This is kiosk's ONLY
// fullscreen entry — pages never touch the Fullscreen API directly; the take
// gate reuses the hook's requestFullscreen (same Rust/HTML state machine).
export async function requestKioskFullscreenNow(origin: string): Promise<boolean> {
  try {
    if (typeof document === "undefined") return false;
    if (document.fullscreenElement) return true;
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    if (el.requestFullscreen) {
      await el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen();
    } else {
      return false;
    }
    console.info(`[Kiosk] fullscreen entered via user gesture — origin: ${origin}`);
    return true;
  } catch {
    console.warn(`[Kiosk] gesture fullscreen failed — origin: ${origin}, gate fallback remains`);
    return false;
  }
}

const BLOCKED_KEYS: Record<string, boolean> = {
  c: true, // Ctrl+C
  v: true, // Ctrl+V
  x: true, // Ctrl+X
  a: true, // Ctrl+A
  u: true, // Ctrl+U (view source)
  s: true, // Ctrl+S (save)
  p: true, // Ctrl+P (print)
  j: true, // Ctrl+J (downloads)
  h: true, // Ctrl+H (history)
  r: true, // Ctrl+R / F5 (refresh — allow normal reload, block forced)
  l: true, // Ctrl+L (address bar)
};

function preventDefault(e: Event) {
  e.preventDefault();
}

function handleKeyDown(e: KeyboardEvent) {
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const key = e.key.toLowerCase();

  if (ctrl && BLOCKED_KEYS[key]) {
    if (DEBUG) console.log("[Kiosk] Blocked Ctrl+" + e.key.toUpperCase());
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  if (shift && key === "f10") {
    if (ALLOW_DEVTOOLS) return; // DEV: context-menu key (DevTools hatch)
    if (DEBUG) console.log("[Kiosk] Blocked Shift+F10");
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  if (key === "f12") {
    if (ALLOW_DEVTOOLS) return; // DEV: DevTools hatch
    if (DEBUG) console.log("[Kiosk] Blocked F12");
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  if (ctrl && shift && (key === "i" || key === "j" || key === "c")) {
    if (ALLOW_DEVTOOLS) return; // DEV: DevTools hatch
    if (DEBUG) console.log("[Kiosk] Blocked DevTools shortcut");
    e.preventDefault();
    e.stopPropagation();
    return;
  }
}

function handleContextMenu(e: MouseEvent) {
  if (ALLOW_DEVTOOLS) return; // DEV: right-click kept for Inspect Element
  if (DEBUG) console.log("[Kiosk] Blocked right-click");
  e.preventDefault();
}

export function useKioskMode(enabled: boolean, tag = "kiosk", onViolation?: (kind: string) => void) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  // Latest violation forwarder (ExamPage plugs its tab-switch pipeline here
  // so kiosk escapes are punished, not just toasted). Ref avoids re-running
  // the effect when the callback identity changes.
  const onViolationRef = useRef(onViolation);
  onViolationRef.current = onViolation;
  // Previous value — lets exit logs state WHY we are leaving (flag flipped
  // vs page unmounted while still enabled, e.g. route change / StrictMode).
  // null = first mount (no previous value yet).
  const prevEnabledRef = useRef<boolean | null>(null);

  const [isFullscreen, setIsFullscreen] = useState<boolean>(() =>
    typeof document !== "undefined" ? !!document.fullscreenElement : false,
  );

  // Track fullscreen state regardless of `enabled` so entry/exit gates stay accurate.
  // Desktop: Rust window kiosk owns the state — ignore the webview's HTML
  // fullscreen layer (Esc may pop it without leaving the kiosk window).
  useEffect(() => {
    const sync = () => {
      if (isTauriEnv()) return;
      const fs = !!document.fullscreenElement;
      if (DEBUG) console.log("[Kiosk] fullscreenchange — isFullscreen:", fs);
      setIsFullscreen(fs);
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const requestFullscreen = useCallback(async () => {
    if (DEBUG) console.log(`[Kiosk:${tag}] requestFullscreen called — enabled:`, enabledRef.current);
    if (!enabledRef.current) {
      if (DEBUG) console.log(`[Kiosk:${tag}] requestFullscreen skipped — reason: enabled=false`);
      return;
    }

    // Desktop: Rust holds the window — no user gesture needed, Esc can't exit.
    // Idempotent with the auto-enter below (gate button path).
    if (isTauriEnv()) {
      try {
        await kioskEnter();
        setIsFullscreen(true);
        if (DEBUG) console.log(`[Kiosk:${tag}] ENTER kiosk — path: requestFullscreen (gate/auto), env: tauri`);
      } catch (err) {
        if (DEBUG) console.warn(`[Kiosk:${tag}] ENTER kiosk failed — path: requestFullscreen, reason:`, err);
      }
      return;
    }

    if (document.fullscreenElement) {
      if (DEBUG) console.log(`[Kiosk:${tag}] requestFullscreen skipped — reason: already fullscreen (browser)`);
      return;
    }
    try {
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      };
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      }
      if (DEBUG) console.log(`[Kiosk:${tag}] ENTER fullscreen ok — path: requestFullscreen, env: browser`);
    } catch {
      if (DEBUG) console.warn(`[Kiosk:${tag}] ENTER fullscreen failed — reason: needs an active user gesture (auto-entry expired, use the gate button)`);
    }
  }, [tag]);

  useEffect(() => {
    if (!enabled) {
      if (DEBUG) console.log(`[Kiosk:${tag}] skip enable — reason: enabled=false (prev=${prevEnabledRef.current ?? "∅-first-mount"})`);
      prevEnabledRef.current = enabled;
      return;
    }

    if (DEBUG) console.log(`[Kiosk:${tag}] ENTER kiosk — enabled effect mount (prev=${prevEnabledRef.current ?? "∅-first-mount"})`);
    prevEnabledRef.current = enabled;

    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";

    document.addEventListener("selectstart", preventDefault, true);
    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("copy", preventDefault, true);
    document.addEventListener("cut", preventDefault, true);
    document.addEventListener("paste", preventDefault, true);

    // Desktop: engage the Rust window kiosk immediately — it needs no user
    // gesture (unlike HTML fullscreen). Previously kiosk_enter ran only via
    // requestFullscreen() (gate button / auto effect), so a missed gesture
    // left the exam unprotected with Rust ACTIVE=false (Alt+F4 close +
    // Alt+Tab/Win escapes all worked). Now ACTIVE=true for the whole `take`
    // lifetime, including pauses and submits.
    // listen() requires the "core:event:allow-listen" capability for this
    // window (see src-tauri/capabilities/default.json) — fail soft if denied
    // so a capability misconfig never breaks the exam flow with an uncaught
    // promise rejection.
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    // Throttle the focus-loss toast: Rust already cooldowns emits (2s), but
    // a sustained DevTools/overlay fight would still stack toasts — one per
    // 5s max, console logs every event for debugging.
    let lastToastAt = 0;
    if (isTauriEnv()) {
      if (DEBUG) console.log(`[Kiosk:${tag}] ENTER kiosk — path: auto-enter on mount, env: tauri`);
      void kioskEnter()
        .then(() => {
          if (!cancelled) {
            setIsFullscreen(true);
            if (DEBUG) console.log(`[Kiosk:${tag}] ENTER kiosk ok — path: auto-enter, env: tauri`);
          } else {
            if (DEBUG) console.log(`[Kiosk:${tag}] ENTER kiosk superseded — reason: unmounted before enter resolved, exiting again`);
            void kioskExit().catch(() => {});
          }
        })
        .catch((err) => {
          if (DEBUG) console.warn(`[Kiosk:${tag}] ENTER kiosk failed — path: auto-enter, reason:`, err);
        });
      void listen<{ kind: string }>(TAURI_EVENTS.securityViolation, (ev) => {
        if (DEBUG) console.log(`[Kiosk:${tag}] security-violation:`, ev.payload);
        if (ev.payload.kind === "focus-lost") {
          const now = Date.now();
          if (now - lastToastAt > 5000) {
            lastToastAt = now;
            toast.warning("Focus left the exam window — this event has been recorded.");
          }
        }
        // Forward to whoever enforces (take plugs the tab-switch pipeline:
        // report + count toward pause/auto-submit per exam settings).
        try {
          onViolationRef.current?.(ev.payload.kind);
        } catch (err) {
          if (DEBUG) console.warn(`[Kiosk:${tag}] violation forwarder failed — reason:`, err);
        }
      })
        .then((fn) => {
          if (cancelled) {
            fn();
          } else {
            unlisten = fn;
          }
        })
        .catch((err) => {
          if (DEBUG) console.warn(`[Kiosk:${tag}] security-violation listener unavailable — reason:`, err);
        });
    }

    return () => {
      // Reason: enabledRef reflects the LATEST render. false => the page's
      // flag flipped (e.g. take paused/terminated/submitted, instructions
      // still loading); true => page unmounted while locked (route change
      // subjects<->take, or StrictMode double-effect in dev).
      const reason = enabledRef.current
        ? "unmounted while enabled=true (route change or StrictMode remount)"
        : "enabled flipped to false (page flag off)";
      if (DEBUG) console.log(`[Kiosk:${tag}] EXIT kiosk — reason: ${reason}`);
      prevEnabledRef.current = enabledRef.current;

      cancelled = true;

      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";

      document.removeEventListener("selectstart", preventDefault, true);
      document.removeEventListener("contextmenu", handleContextMenu, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("copy", preventDefault, true);
      document.removeEventListener("cut", preventDefault, true);
      document.removeEventListener("paste", preventDefault, true);

      unlisten?.();

      if (isTauriEnv()) {
        if (DEBUG) console.log(`[Kiosk:${tag}] EXIT kiosk — path: cleanup kioskExit, env: tauri`);
        void kioskExit()
          .then(() => {
            setIsFullscreen(false);
            if (DEBUG) console.log(`[Kiosk:${tag}] EXIT kiosk ok — env: tauri`);
          })
          .catch((err) => {
            if (DEBUG) console.warn(`[Kiosk:${tag}] EXIT kiosk failed — reason:`, err);
          });
      }

      if (document.fullscreenElement || (document as unknown as Record<string, unknown>).webkitFullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    };
  }, [enabled, requestFullscreen, tag]);

  return { requestFullscreen, isFullscreen };
}
