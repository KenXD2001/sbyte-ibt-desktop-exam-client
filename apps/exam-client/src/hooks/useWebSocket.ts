import { useState, useEffect, useCallback, useRef, useMemo } from "react";

function resolveWsBase(): string {
  const explicit = import.meta.env.VITE_WS_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const apiBase = import.meta.env.VITE_API_BASE_URL;
  if (apiBase) {
    try {
      const url = new URL(apiBase);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "";
      url.search = "";
      return url.toString().replace(/\/$/, "");
    } catch {
      // fall through to location-based derivation
    }
  }

  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

const WS_BASE = resolveWsBase();
const WS_PATH = "/ws/exam";
const HEARTBEAT_INTERVAL = Number(import.meta.env.VITE_WS_HEARTBEAT_INTERVAL) || 12000;
const RECONNECT_BASE_DELAY = Number(import.meta.env.VITE_WS_RECONNECT_BASE_DELAY) || 1000;
const RECONNECT_MAX_DELAY = Number(import.meta.env.VITE_WS_RECONNECT_MAX_DELAY) || 30000;
const RECONNECT_MAX_ATTEMPTS = Number(import.meta.env.VITE_WS_RECONNECT_MAX_ATTEMPTS) || 15;
const CLOCK_SKEW_WARN_THRESHOLD = 30000;


export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected" | "failed";

export interface WsMessage {
  type: string;
  payload: Record<string, unknown>;
}

interface UseWebSocketOptions {
  sessionId: number | null;
  examId: number | null;
  enabled?: boolean;
  onConnected?: (payload: Record<string, unknown>) => void;
  onSessionRestored?: (payload: Record<string, unknown>) => void;
  onHeartbeatAck?: (payload: Record<string, unknown>) => void;
  onTimerUpdate?: (payload: Record<string, unknown>) => void;
  onForceSubmit?: (payload: Record<string, unknown>) => void;
  onWarning?: (payload: Record<string, unknown>) => void;
  onSessionExpired?: (payload: Record<string, unknown>) => void;
  onReconnectSuccess?: (payload: Record<string, unknown>) => void;
  onExtraTime?: (payload: Record<string, unknown>) => void;
  onResumed?: (payload: Record<string, unknown>) => void;
  onTerminated?: (payload: Record<string, unknown>) => void;
  onManualSubmitted?: (payload: Record<string, unknown>) => void;
  onReset?: (payload: Record<string, unknown>) => void;
  onResetAll?: (payload: Record<string, unknown>) => void;
  onRemainingTime?: (payload: Record<string, unknown>) => void;
  onError?: (payload: Record<string, unknown>) => void;
  onClockSkew?: (offsetMs: number) => void;
  onChatMessage?: (payload: Record<string, unknown>) => void;
  onChatSent?: (payload: Record<string, unknown>) => void;
  onChatStatus?: (payload: Record<string, unknown>) => void;
  onFlagRaised?: (payload: Record<string, unknown>) => void;
}

export function useWebSocket({
  sessionId,
  examId,
  enabled = true,
  onConnected,
  onSessionRestored,
  onHeartbeatAck,
  onTimerUpdate,
  onForceSubmit,
  onWarning,
  onSessionExpired,
  onReconnectSuccess,
  onExtraTime,
  onResumed,
  onTerminated,
  onManualSubmitted,
  onReset,
  onResetAll,
  onRemainingTime,
  onError,
  onClockSkew,
  onChatMessage,
  onChatSent,
  onChatStatus,
  onFlagRaised,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const intentionalCloseRef = useRef(false);
  const outboxRef = useRef<Array<{ msg: WsMessage; id: string }>>([]);
  const clockOffsetRef = useRef(0);
  const rttSamplesRef = useRef<number[]>([]);

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [lastServerTime, setLastServerTime] = useState<number>(Date.now());
  const [serverRemainingMs, setServerRemainingMs] = useState<number | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [avgRtt, setAvgRtt] = useState(0);

  const callbacksRef = useRef({
    onConnected,
    onSessionRestored,
    onHeartbeatAck,
    onTimerUpdate,
    onForceSubmit,
    onWarning,
    onSessionExpired,
    onReconnectSuccess,
    onExtraTime,
    onResumed,
    onTerminated,
    onManualSubmitted,
    onReset,
    onResetAll,
    onRemainingTime,
    onError,
    onClockSkew,
    onChatMessage,
    onChatSent,
    onChatStatus,
    onFlagRaised,
  });

  callbacksRef.current = {
    onConnected,
    onSessionRestored,
    onHeartbeatAck,
    onTimerUpdate,
    onForceSubmit,
    onWarning,
    onSessionExpired,
    onReconnectSuccess,
    onExtraTime,
    onResumed,
    onTerminated,
    onManualSubmitted,
    onReset,
    onResetAll,
    onRemainingTime,
    onError,
    onClockSkew,
    onChatMessage,
    onChatSent,
    onChatStatus,
    onFlagRaised,
  };

  const clearHeartbeatInterval = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const flushOutbox = useCallback(() => {
    const outbox = outboxRef.current;
    outboxRef.current = [];
    for (const item of outbox) {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(item.msg));
      } else {
        outboxRef.current.push(item);
      }
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    clearHeartbeatInterval();
    heartbeatRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "client:heartbeat",
          payload: { sessionId },
        }));
      }
    }, HEARTBEAT_INTERVAL);
  }, [sessionId, clearHeartbeatInterval]);

  const sendJson = useCallback((message: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      outboxRef.current.push({ msg: message, id: crypto.randomUUID() });
      if (outboxRef.current.length > 50) {
        outboxRef.current = outboxRef.current.slice(-50);
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (!sessionId || !examId || !enabled) {
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      return;
    }

    if (wsRef.current) {
      intentionalCloseRef.current = true;
      wsRef.current.close();
      wsRef.current = null;
    }

    intentionalCloseRef.current = false;
    setStatus(reconnectAttemptsRef.current > 0 ? "reconnecting" : "connecting");

    const url = `${WS_BASE}${WS_PATH}?token=${token}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      reconnectAttemptsRef.current = 0;
      setStatus("connected");

      ws.send(JSON.stringify({
        type: "client:connect",
        payload: { sessionId, examId },
      }));

      startHeartbeat();
      flushOutbox();
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      let msg: WsMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      const { type, payload } = msg;

      switch (type) {
        case "server:connected":
          setConnectionId(payload.connectionId as string);
          callbacksRef.current.onConnected?.(payload);
          break;
        case "server:session_restored":
          callbacksRef.current.onSessionRestored?.(payload);
          break;
        case "server:heartbeat_ack": {
          const serverTime = payload.serverTime as number;
          if (serverTime) {
            const clientNow = Date.now();
            const rtt = clientNow - (payload.pingAt as number || clientNow);
            rttSamplesRef.current.push(rtt);
            if (rttSamplesRef.current.length > 10) rttSamplesRef.current.shift();

            const offset = serverTime - clientNow + Math.round(rtt / 2);
            const prevOffset = clockOffsetRef.current;
            const newOffset = Math.abs(offset) > 5000 ? offset : Math.round(prevOffset * 0.8 + offset * 0.2);
            clockOffsetRef.current = newOffset;

            const samples = rttSamplesRef.current;
            setAvgRtt(Math.round(samples.reduce((a, b) => a + b, 0) / samples.length));

            if (Math.abs(newOffset) > CLOCK_SKEW_WARN_THRESHOLD) {
              callbacksRef.current.onClockSkew?.(newOffset);
            }
          }

          if (payload.serverTime) setLastServerTime(serverTime as number);
          if (payload.remainingTimeMs != null) setServerRemainingMs(payload.remainingTimeMs as number);
          callbacksRef.current.onHeartbeatAck?.(payload);
          break;
        }
        case "server:timer_update":
          if (payload.remainingTimeMs != null) setServerRemainingMs(payload.remainingTimeMs as number);
          callbacksRef.current.onTimerUpdate?.(payload);
          break;
        case "server:remaining_time":
          if (payload.remainingTimeMs != null) setServerRemainingMs(payload.remainingTimeMs as number);
          if (payload.serverTime) setLastServerTime(payload.serverTime as number);
          callbacksRef.current.onRemainingTime?.(payload);
          break;
        case "server:force_submit":
          callbacksRef.current.onForceSubmit?.(payload);
          break;
        case "server:warning":
          callbacksRef.current.onWarning?.(payload);
          break;
        case "server:session_expired":
          callbacksRef.current.onSessionExpired?.(payload);
          break;
        case "server:reconnect_success":
          callbacksRef.current.onReconnectSuccess?.(payload);
          break;
        case "server:extra_time_allotted":
          if (payload.remainingTimeMs != null) setServerRemainingMs(payload.remainingTimeMs as number);
          callbacksRef.current.onExtraTime?.(payload);
          break;
        case "server:exam_resumed":
          if (payload.remainingTimeMs != null) setServerRemainingMs(payload.remainingTimeMs as number);
          callbacksRef.current.onResumed?.(payload);
          break;
        case "server:exam_terminated":
          callbacksRef.current.onTerminated?.(payload);
          break;
        case "server:manual_submit":
          callbacksRef.current.onManualSubmitted?.(payload);
          break;
        case "server:exam_reset":
          callbacksRef.current.onReset?.(payload);
          break;
        case "server:exam_reset_all":
          callbacksRef.current.onResetAll?.(payload);
          break;
        case "server:chat_message":
          callbacksRef.current.onChatMessage?.(payload);
          break;
        case "server:chat_sent":
          callbacksRef.current.onChatSent?.(payload);
          break;
        case "server:chat_status":
          callbacksRef.current.onChatStatus?.(payload);
          break;
        case "server:flag_raised":
          callbacksRef.current.onFlagRaised?.(payload);
          break;
        case "error":
          callbacksRef.current.onError?.(payload);
          break;
      }
    };

    ws.onclose = (event) => {
      if (!mountedRef.current) return;
      clearHeartbeatInterval();
      wsRef.current = null;

      if (intentionalCloseRef.current) return;

      if (event.code === 4001 || event.code === 4010) {
        setStatus("failed");
        return;
      }

      if (reconnectAttemptsRef.current < RECONNECT_MAX_ATTEMPTS) {
        const base = Math.min(
          RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttemptsRef.current),
          RECONNECT_MAX_DELAY,
        );
        const jitter = base * 0.5 + Math.random() * base * 0.5;
        reconnectAttemptsRef.current += 1;
        setStatus("reconnecting");
        reconnectTimeoutRef.current = setTimeout(connect, jitter);
      } else {
        setStatus("failed");
      }
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      console.error("[WS] Error");
    };
  }, [sessionId, examId, enabled, startHeartbeat, clearHeartbeatInterval, flushOutbox]);

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    clearHeartbeatInterval();
    clearReconnectTimeout();
    reconnectAttemptsRef.current = 0;
    outboxRef.current = [];
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, [clearHeartbeatInterval, clearReconnectTimeout]);

  const requestRemainingTime = useCallback(() => {
    sendJson({
      type: "client:request_remaining_time",
      payload: {},
    });
  }, [sendJson]);

  const reportTabSwitch = useCallback(() => {
    sendJson({
      type: "client:tab_switch",
      payload: {},
    });
  }, [sendJson]);

  const notifyExamSubmitted = useCallback(() => {
    sendJson({
      type: "client:exam_submitted",
      payload: {},
    });
  }, [sendJson]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && wsRef.current?.readyState === WebSocket.OPEN && sessionId) {
        wsRef.current.send(JSON.stringify({
          type: "client:heartbeat",
          payload: { sessionId },
        }));
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled && sessionId && examId) {
      connect();
    }
    return () => {
      mountedRef.current = false;
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connect/disconnect intentionally excluded to prevent reconnect loops
  }, [enabled, sessionId, examId]);

  return useMemo(
    () => ({
      status,
      connectionId,
      lastServerTime,
      serverRemainingMs,
      clockOffsetMs: clockOffsetRef.current,
      avgRtt,
      sendJson,
      requestRemainingTime,
      reportTabSwitch,
      notifyExamSubmitted,
      disconnect,
      reconnect: connect,
    }),
    [status, connectionId, lastServerTime, serverRemainingMs, avgRtt, sendJson, requestRemainingTime, reportTabSwitch, notifyExamSubmitted, disconnect, connect],
  );
}
