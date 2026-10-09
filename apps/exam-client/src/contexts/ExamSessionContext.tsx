import { createContext, useContext, useState, useCallback, useRef, useMemo, useEffect, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useWebSocket, type ConnectionStatus, type WsMessage } from "@/hooks/useWebSocket";
import { useKioskMode, requestKioskFullscreenNow } from "@/hooks/useKioskMode";
import { isTauriEnv } from "@/services/tauri/commands";
import { KioskEmergencyExitDialog } from "@/components/exam/KioskEmergencyExitDialog";

interface ExamSessionContextValue {
  sessionId: number | null;
  examId: number | null;
  setSessionId: (id: number) => void;
  setExamId: (id: number) => void;

  // ─── Exam-flow kiosk (single owner) ──────────────────────────────────────
  // Kiosk lifetime: armed once on the Second Loading screen's initial load
  // (Instructions start / Verify proceed) and stays ON across subjects ↔ take
  // navigation until the Exam Submitted screen disarms it. One hook instance
  // lives here (provider mounts once per exam flow) so there is no
  // exit/enter churn between pages.
  kioskMode: boolean;
  kioskArmed: boolean;
  // True after a password-authorized emergency exit — the take page must not
  // auto re-arm the kiosk while this is set.
  kioskSuppressed: boolean;
  armKiosk: (mode: boolean) => void;
  disarmKiosk: () => void;
  emergencyReleaseKiosk: () => void;
  kioskFullscreen: boolean;
  requestKioskFullscreen: () => Promise<void>;
  // Second-Loading gesture entry: arms the exam-flow kiosk AND captures
  // browser fullscreen inside the click task (activation expires across the
  // async start flow). Call only from the click that opens Second Loading.
  // Fullscreen is part of kiosk — this is its only gesture entry point.
  startKioskFromGesture: (mode: boolean) => Promise<void>;
  // Kiosk violation enforcement slot: take plugs its tab-switch pipeline so
  // escapes are reported + counted (pause/auto-submit), not just toasted.
  setOnKioskViolation: (cb: ((kind: string) => void) | undefined) => void;

  status: ConnectionStatus;
  connectionId: string | null;
  lastServerTime: number;
  serverRemainingMs: number | null;
  clockOffsetMs: number;
  avgRtt: number;

  sendJson: (message: WsMessage) => void;
  requestRemainingTime: () => void;
  reportTabSwitch: () => void;
  notifyExamSubmitted: () => void;
  disconnect: () => void;
  reconnect: () => void;

  setOnConnected: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
  setOnSessionRestored: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
  setOnHeartbeatAck: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
  setOnForceSubmit: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
  setOnWarning: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
  setOnSessionExpired: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
  setOnReconnectSuccess: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
  setOnExtraTime: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
  setOnResumed: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
  setOnTerminated: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
  setOnManualSubmitted: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
  setOnReset: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
  setOnResetAll: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
  setOnError: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
  setOnChatMessage: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
  setOnChatSent: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
  setOnChatStatus: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
  setOnFlagRaised: (cb: ((payload: Record<string, unknown>) => void) | undefined) => void;
}

const ExamSessionContext = createContext<ExamSessionContextValue | null>(null);

export function useExamSession(): ExamSessionContextValue {
  const ctx = useContext(ExamSessionContext);
  if (!ctx) throw new Error("useExamSession must be used within ExamSessionProvider");
  return ctx;
}

interface ExamSessionProviderProps {
  initialExamId?: number;
  children: ReactNode;
}

export function ExamSessionProvider({ initialExamId, children }: ExamSessionProviderProps) {
  const [sessionId, setSessionIdState] = useState<number | null>(null);
  const [examId, setExamIdState] = useState<number | null>(initialExamId ?? null);
  const mountedRef = useRef(true);

  const setSessionId = useCallback((id: number) => {
    setSessionIdState(id);
  }, []);

  const setExamId = useCallback((id: number) => {
    setExamIdState(id);
  }, []);

  // Single kiosk owner for the whole exam flow (see interface docs above).
  const [kioskMode, setKioskMode] = useState(false);
  const [kioskArmed, setKioskArmed] = useState(false);
  // Set by a password-authorized emergency exit. The take page re-arms the
  // kiosk on mount when it finds it disarmed mid-exam (crash/refresh recovery),
  // which otherwise bounced the app straight back into lockdown the instant the
  // proctor released it. This latch suppresses that automatic re-arm until the
  // kiosk is deliberately armed again (Start/Proceed gesture, or the take
  // page's Enter Fullscreen button).
  const [kioskSuppressed, setKioskSuppressed] = useState(false);
  const armKiosk = useCallback((mode: boolean) => {
    setKioskMode(mode);
    setKioskArmed(true);
    setKioskSuppressed(false);
  }, []);
  const disarmKiosk = useCallback(() => {
    setKioskArmed(false);
  }, []);
  // Emergency exit: release the kiosk AND latch suppression so the take page
  // does not pull the candidate straight back into lockdown. Unlike
  // disarmKiosk (normal end-of-exam release) this must survive the take page's
  // mid-exam re-arm effect.
  const emergencyReleaseKiosk = useCallback(() => {
    setKioskSuppressed(true);
    setKioskArmed(false);
  }, []);
  const onKioskViolationRef = useRef<((kind: string) => void) | undefined>(undefined);
  const setOnKioskViolation = useCallback((cb: ((kind: string) => void) | undefined) => {
    onKioskViolationRef.current = cb;
  }, []);
  const { requestFullscreen: requestKioskFullscreen, isFullscreen: kioskFullscreen } =
    useKioskMode(kioskArmed && kioskMode, "exam-flow", useCallback((kind: string) => {
      onKioskViolationRef.current?.(kind);
    }, []));
  // Gesture entry for the Second Loading open (Start / Proceed click):
  // arm first (hook effect auto-enters Rust — needs no gesture), then capture
  // browser fullscreen NOW while the click is valid. Awaited by callers but
  // the fullscreen request itself fires synchronously in the click task.
  const startKioskFromGesture = useCallback(async (mode: boolean) => {
    console.log("[Kiosk:exam-flow] ENTER kiosk — reason: second loading opened from user gesture");
    armKiosk(mode);
    await requestKioskFullscreenNow("second-loading");
  }, [armKiosk]);

  // Proctor emergency exit (Rust: password-authorized Ctrl+Alt+Shift hold).
  // When `kiosk_emergency_exit` succeeds, Rust has already released the
  // window/shell/registry lockdown and emits this event — flipping our state
  // makes the kiosk hook run its normal exit path (HTML fullscreen off,
  // listeners torn down). `emergencyReleaseKiosk` (not plain disarm) also
  // latches suppression so the take page's mid-exam re-arm effect cannot pull
  // the candidate straight back into lockdown.
  useEffect(() => {
    if (!isTauriEnv()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("kiosk-emergency-exit", () => {
      console.warn("[Kiosk:exam-flow] EMERGENCY EXIT authorized — releasing frontend kiosk state (suppression latched)");
      toast.warning("Kiosk emergency exit engaged — lockdown released.");
      emergencyReleaseKiosk();
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((err) => {
        console.warn("[Kiosk:exam-flow] emergency-exit listener unavailable — reason:", err);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [emergencyReleaseKiosk]);

  const wsEnabled = !!sessionId && !!examId;

  const onConnectedRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);
  const onSessionRestoredRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);
  const onHeartbeatAckRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);
  const onForceSubmitRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);
  const onWarningRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);
  const onSessionExpiredRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);
  const onReconnectSuccessRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);
  const onExtraTimeRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);
  const onResumedRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);
  const onTerminatedRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);
  const onManualSubmittedRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);
  const onResetRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);
  const onResetAllRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);
  const onErrorRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);
  const onChatMessageRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);
  const onChatSentRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);
  const onChatStatusRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);
  const onFlagRaisedRef = useRef<((payload: Record<string, unknown>) => void) | undefined>(undefined);

  const ws = useWebSocket({
    sessionId,
    examId,
    enabled: wsEnabled,
    onConnected: (p) => onConnectedRef.current?.(p),
    onSessionRestored: (p) => onSessionRestoredRef.current?.(p),
    onHeartbeatAck: (p) => onHeartbeatAckRef.current?.(p),
    onForceSubmit: (p) => onForceSubmitRef.current?.(p),
    onWarning: (p) => onWarningRef.current?.(p),
    onSessionExpired: (p) => onSessionExpiredRef.current?.(p),
    onReconnectSuccess: (p) => onReconnectSuccessRef.current?.(p),
    onExtraTime: (p) => onExtraTimeRef.current?.(p),
    onResumed: (p) => onResumedRef.current?.(p),
    onTerminated: (p) => onTerminatedRef.current?.(p),
    onManualSubmitted: (p) => onManualSubmittedRef.current?.(p),
    onReset: (p) => onResetRef.current?.(p),
    onResetAll: (p) => onResetAllRef.current?.(p),
    onError: (p) => onErrorRef.current?.(p),
    onChatMessage: (p) => onChatMessageRef.current?.(p),
    onChatSent: (p) => onChatSentRef.current?.(p),
    onChatStatus: (p) => onChatStatusRef.current?.(p),
    onFlagRaised: (p) => onFlagRaisedRef.current?.(p),
  });

  const setOnConnected = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onConnectedRef.current = cb;
  }, []);
  const setOnSessionRestored = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onSessionRestoredRef.current = cb;
  }, []);
  const setOnHeartbeatAck = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onHeartbeatAckRef.current = cb;
  }, []);
  const setOnForceSubmit = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onForceSubmitRef.current = cb;
  }, []);
  const setOnWarning = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onWarningRef.current = cb;
  }, []);
  const setOnSessionExpired = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onSessionExpiredRef.current = cb;
  }, []);
  const setOnReconnectSuccess = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onReconnectSuccessRef.current = cb;
  }, []);
  const setOnExtraTime = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onExtraTimeRef.current = cb;
  }, []);
  const setOnResumed = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onResumedRef.current = cb;
  }, []);
  const setOnTerminated = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onTerminatedRef.current = cb;
  }, []);
  const setOnManualSubmitted = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onManualSubmittedRef.current = cb;
  }, []);
  const setOnReset = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onResetRef.current = cb;
  }, []);
  const setOnResetAll = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onResetAllRef.current = cb;
  }, []);
  const setOnError = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onErrorRef.current = cb;
  }, []);
  const setOnChatMessage = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onChatMessageRef.current = cb;
  }, []);
  const setOnChatSent = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onChatSentRef.current = cb;
  }, []);
  const setOnChatStatus = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onChatStatusRef.current = cb;
  }, []);
  const setOnFlagRaised = useCallback((cb: ((payload: Record<string, unknown>) => void) | undefined) => {
    onFlagRaisedRef.current = cb;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const value = useMemo<ExamSessionContextValue>(() => ({
    sessionId,
    examId,
    setSessionId,
    setExamId,
    kioskMode,
    kioskArmed,
    kioskSuppressed,
    armKiosk,
    disarmKiosk,
    emergencyReleaseKiosk,
    kioskFullscreen,
    requestKioskFullscreen,
    startKioskFromGesture,
    setOnKioskViolation,
    status: ws.status,
    connectionId: ws.connectionId,
    lastServerTime: ws.lastServerTime,
    serverRemainingMs: ws.serverRemainingMs,
    clockOffsetMs: ws.clockOffsetMs,
    avgRtt: ws.avgRtt,
    sendJson: ws.sendJson,
    requestRemainingTime: ws.requestRemainingTime,
    reportTabSwitch: ws.reportTabSwitch,
    notifyExamSubmitted: ws.notifyExamSubmitted,
    disconnect: ws.disconnect,
    reconnect: ws.reconnect,
    setOnConnected,
    setOnSessionRestored,
    setOnHeartbeatAck,
    setOnForceSubmit,
    setOnWarning,
    setOnSessionExpired,
    setOnReconnectSuccess,
    setOnExtraTime,
    setOnResumed,
    setOnTerminated,
    setOnManualSubmitted,
    setOnReset,
    setOnResetAll,
    setOnError,
    setOnChatMessage,
    setOnChatSent,
    setOnChatStatus,
    setOnFlagRaised,
  }), [
    sessionId, examId, setSessionId, setExamId,
    kioskMode, kioskArmed, kioskSuppressed, armKiosk, disarmKiosk, emergencyReleaseKiosk, kioskFullscreen, requestKioskFullscreen, startKioskFromGesture, setOnKioskViolation,
    ws.status, ws.connectionId, ws.lastServerTime, ws.serverRemainingMs, ws.clockOffsetMs, ws.avgRtt,
    ws.sendJson, ws.requestRemainingTime, ws.reportTabSwitch, ws.notifyExamSubmitted,
    ws.disconnect, ws.reconnect,
    setOnConnected, setOnSessionRestored, setOnHeartbeatAck, setOnForceSubmit,
    setOnWarning, setOnSessionExpired, setOnReconnectSuccess, setOnExtraTime, setOnResumed, setOnTerminated, setOnManualSubmitted, setOnReset, setOnResetAll, setOnError,
    setOnChatMessage, setOnChatSent, setOnChatStatus, setOnFlagRaised,
  ]);

  return (
    <ExamSessionContext.Provider value={value}>
      {children}
      {/* Proctor password prompt for the native emergency combo — present for
          the whole exam flow, never rendered outside it. */}
      <KioskEmergencyExitDialog />
    </ExamSessionContext.Provider>
  );
}
