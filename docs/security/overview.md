# Security overview (starter)

Trust boundary: everything in the webview (React) is untrusted for exam
decisions. Enforcement lives in Rust (`security/`, `integrity/`, `windows/`)
and server-side. The client reports signals; the server judges.

Current honest state (v0.1):
- Token lives in `localStorage` (candidate-portal parity) — moving it to the
  OS keychain via Rust (`storage/`) is the first lockdown task.
- **Single-owner kiosk lifetime.** One `useKioskMode` instance in
  `ExamSessionContext` owns the lock: armed on the **Second Loading** screen
  (Instructions *Start* / Verify *Proceed* click), held across
  subjects ↔ take navigation, and released on the **Exam Submitted** screen
  (`ResultPage`). Fullscreen is part of kiosk — never entered standalone.
- **Window-level lockdown** (`kiosk.rs`): Rust holds fullscreen +
  always-on-top + undecorated and refuses close while active, so Esc/Alt+F4
  can't escape like the portal's HTML-fullscreen kiosk. A ~750 ms watchdog
  re-asserts focus, pulls the window back onto the candidate's virtual
  desktop (IVirtualDesktopManager, when available) and re-applies the OS
  layers; focus loss is emitted as a `security-violation`.
- **Key lockdown** (`lockdown.rs`), driven 1:1 by `kiosk_enter`/`kiosk_exit`:
  - **Windows**: `WH_KEYBOARD_LL` hook swallows the Win key, any key while
    Win is held, plain Esc (the browser would drop HTML fullscreen on it,
    shrinking the exam inside the locked window), and Alt+Tab / Alt+Esc /
    Alt+F4 / Alt+Space (via `WM_SYSKEY*`), Ctrl+Tab, Ctrl+Esc,
    Ctrl+Shift+Esc, plus a best-effort Ctrl+Alt+Del swallow (the OS reserves
    that chord).
  - **Ubuntu/GNOME**: `gsettings` disables the Alt+Tab/Super/workspace/
    terminal/screenshot keybindings (previous values saved and restored on
    `kiosk_exit`); verified by the `gsettings_roundtrip` test.
- **Layered Windows hardening** (Safe Exam Browser parity; HKCU — no admin):
  - **Layer 2 — shell** (`shell_lockdown.rs`): minimizes other windows, then
    kills and keeps down `explorer.exe` (Start menu, taskbar, Task View,
    touchpad gestures), restoring it on exit; re-applied by the watchdog and
    self-healed at launch.
  - **Layer 4 — policy** (`registry_lockdown.rs`): sets `DisableTaskMgr`,
    `DisableLockWorkstation`, `DisableChangePassword`,
    `HideFastUserSwitching` and `NoClose`, backing up prior values under
    `HKCU\Software\SbyteIbt\KioskPolicyBackup`; re-applies if tampered and
    restores the pre-exam state on exit.
- **Proctor emergency exit.** Hold **Ctrl+Alt+Shift for 5 s** (detected by a
  100 ms `GetAsyncKeyState` monitor, independent of the hook), then enter a
  password; Rust validates it *before* releasing any layer. The release is
  latched on the frontend so the take page can't auto re-arm — the
  "Enter Fullscreen" gate re-arms only on a deliberate click. Every step is
  audit-logged (`kiosk_trace` + native `eprintln`).
- Focus loss and Ctrl+Alt+Del **cannot be blocked** by user-mode code, so they
  are *detected* and emitted as a `security-violation` — shown to the
  candidate and available for server-side reporting.
- `security_status` reports `integrity: "unenforced"` until the Security
  Agent exists — the UI must not pretend enforcement it doesn't have.
- React → exam-server traffic is plain HTTPS from the webview; TLS pinning
  lands in Rust only if the threat model requires it.

Non-goals for v0.1: kernel-level anti-cheat, DRM, watermarking, and the
secure desktop (Ctrl+Alt+Del), power/reboot and second-physical-monitor
escapes — none are stoppable from user mode.

Land next — promote the session-level / HKCU lockdown to the
`apps/security-agent` service (elevation-resistant: blocks keys even for
elevated input, blocks process launch e.g. Task Manager, **unlock only on
server confirmation**); move the emergency password out of the binary
(server/config/agent) and make the audit trail server-side; then secure token
storage (OS keychain via Rust), device binding, server-side violation
reporting. macOS needs CGEventTap/MDM (not implemented). Full threat model +
agent spec get written when that work starts — not as speculative docs now.
