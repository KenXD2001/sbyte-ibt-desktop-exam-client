import { Wifi, WifiOff, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import type { ConnectionStatus } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";

interface ConnectionStatusIndicatorProps {
  status: ConnectionStatus;
  className?: string;
  showLabel?: boolean;
}

const STATUS_CONFIG: Record<ConnectionStatus, {
  icon: typeof Wifi;
  label: string;
  color: string;
  bgColor: string;
  pulse?: boolean;
}> = {
  connecting: {
    icon: Loader2,
    label: "Connecting...",
    color: "text-amber-600",
    bgColor: "bg-amber-100",
    pulse: true,
  },
  connected: {
    icon: Wifi,
    label: "Connected",
    color: "text-emerald-600",
    bgColor: "bg-emerald-100",
  },
  reconnecting: {
    icon: RefreshCw,
    label: "Reconnecting...",
    color: "text-amber-600",
    bgColor: "bg-amber-100",
    pulse: true,
  },
  disconnected: {
    icon: WifiOff,
    label: "Disconnected",
    color: "text-red-600",
    bgColor: "bg-red-100",
  },
  failed: {
    icon: AlertTriangle,
    label: "Connection Failed",
    color: "text-red-600",
    bgColor: "bg-red-100",
  },
};

export function ConnectionStatusIndicator({ status, className, showLabel = true }: ConnectionStatusIndicatorProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        config.bgColor,
        config.color,
        className,
      )}
    >
      <Icon
        className={cn(
          "size-3",
          (config.pulse || status === "connected") && "animate-pulse",
          status === "reconnecting" && "animate-spin",
        )}
      />
      {showLabel && <span>{config.label}</span>}
    </div>
  );
}
