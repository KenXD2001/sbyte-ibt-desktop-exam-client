// Thin wrapper over Tauri IPC. All native calls route through here —
// never call @tauri-apps/api invoke() directly from features.
// NOTE: exam-server REST calls stay in services/api.ts (direct HTTPS) and
// media stays in WebRTC — they do NOT route through Tauri per docs/architecture/overview.md.
import { invoke } from "@tauri-apps/api/core";

export function ping(): Promise<string> {
  return invoke<string>("ping");
}

export interface ScreenInfo {
  width: number;
  height: number;
  scaleFactor: number;
}

export interface DeviceInfo {
  platform: string;
  arch: string;
  screen: ScreenInfo | null;
}

export function deviceInfo(): Promise<DeviceInfo> {
  return invoke<DeviceInfo>("device_info");
}

export interface SecurityStatus {
  agentInstalled: boolean;
  kioskActive: boolean;
  integrity: string;
}

export function securityStatus(): Promise<SecurityStatus> {
  return invoke<SecurityStatus>("security_status");
}

/** True inside the Tauri webview (false in plain `dev:web` browser). */
export function isTauriEnv(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// System-level kiosk — Rust holds the window (fullscreen, undecorated,
// always-on-top, close blocked) so Esc/Alt+F4 can't escape like they do
// with the portal's HTML-fullscreen kiosk.
export function kioskEnter(): Promise<void> {
  return invoke<void>("kiosk_enter");
}

export function kioskExit(): Promise<void> {
  return invoke<void>("kiosk_exit");
}

export interface LockdownStatus {
  kiosk_active: boolean;
  hook_installed: boolean;
  keys_swallowed: number;
  /** SEB Layer 4: HKCU policies (Task Manager / Lock / …) applied + monitored. */
  registry_enforced: boolean;
  /** SEB Layer 2: shell killed for the exam — false while kiosk active. */
  explorer_running: boolean;
}

/** Native lockdown diagnostics: proves the key hook is installed + swallowing. */
export function lockdownStatus(): Promise<LockdownStatus> {
  return invoke<LockdownStatus>("lockdown_status");
}

/**
 * Proctor emergency exit (hold Ctrl+Alt+Shift for 5s). Rust validates the password
 * and, only on success, releases every native lockdown layer (window + hook +
 * shell + registry). Rejects with an error string on a wrong password.
 */
export function kioskEmergencyExit(password: string): Promise<void> {
  return invoke<void>("kiosk_emergency_exit", { password });
}

/**
 * Frontend breadcrumb for the emergency-exit audit trail → terminal log.
 * The webview console isn't visible while the kiosk is locked down, so the
 * password dialog reports key milestones (shown / cancelled) through here.
 */
export function kioskTrace(stage: string): Promise<void> {
  return invoke<void>("kiosk_trace", { stage });
}
