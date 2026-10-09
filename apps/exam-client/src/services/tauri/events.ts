// Tauri event names emitted by Rust. Keep in sync with src-tauri/src/commands/.
export const TAURI_EVENTS = {
  connectivityChanged: "connectivity-changed",
  securityViolation: "security-violation",
} as const;
