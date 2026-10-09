import { useState, useEffect, useCallback, useRef, useMemo } from "react";

interface UseTimerOptions {
  initialTime: number;
  endsAt?: string | number | Date | null;
  onTimeUp?: () => void;
  autoStart?: boolean;
}

const computeRemaining = (
  initialTime: number,
  endsAt: UseTimerOptions["endsAt"],
): number => {
  if (!endsAt) return initialTime;
  const ms =
    endsAt instanceof Date
      ? endsAt.getTime()
      : typeof endsAt === "number"
      ? endsAt
      : new Date(endsAt).getTime();
  if (Number.isNaN(ms)) return initialTime;
  const remaining = Math.ceil((ms - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
};

export function useTimer({
  initialTime,
  endsAt,
  onTimeUp,
  autoStart = false,
}: UseTimerOptions) {
  const safeInitial = initialTime > 0 ? initialTime : 0;
  const [timeRemaining, setTimeRemaining] = useState(() =>
    computeRemaining(safeInitial, endsAt),
  );
  const [isRunning, setIsRunning] = useState(
    autoStart && timeRemaining > 0,
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTimeUpRef = useRef(onTimeUp);
  onTimeUpRef.current = onTimeUp;

  // Recalculate timeRemaining when initialTime or endsAt changes (e.g. async session data load)
  useEffect(() => {
    if (isRunning) return;
    setTimeRemaining(computeRemaining(safeInitial, endsAt));
  }, [safeInitial, endsAt, isRunning]);

  // Stable interval — only depends on isRunning, not timeRemaining
  useEffect(() => {
    if (!isRunning) return undefined;

    intervalRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          setIsRunning(false);
          onTimeUpRef.current?.();
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRunning]);

  const start = useCallback(() => {
    setTimeRemaining((prev) => {
      if (prev <= 0) {
        const next = computeRemaining(safeInitial, endsAt);
        if (next <= 0) return 0;
        setIsRunning(true);
        return next;
      }
      setIsRunning(true);
      return prev;
    });
  }, [safeInitial, endsAt]);

  const pause = useCallback(() => setIsRunning(false), []);

  const reset = useCallback(
    (time?: number) => {
      setIsRunning(false);
      setTimeRemaining(
        typeof time === "number" ? time : computeRemaining(safeInitial, endsAt),
      );
    },
    [safeInitial, endsAt],
  );

  const formatTime = useCallback((seconds: number) => {
    const safe = Math.max(0, seconds);
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, []);

  const isLowTime = useMemo(() => timeRemaining > 0 && timeRemaining <= 600, [timeRemaining]);
  const isCriticalTime = useMemo(() => timeRemaining > 0 && timeRemaining <= 300, [timeRemaining]);

  return {
    timeRemaining,
    isRunning,
    formattedTime: formatTime(timeRemaining),
    isLowTime,
    isCriticalTime,
    start,
    pause,
    reset,
    formatTime,
  };
}
