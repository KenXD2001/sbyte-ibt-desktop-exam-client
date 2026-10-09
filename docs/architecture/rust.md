# Rust (Tauri backend) conventions

Current modules (all compile today, `cargo check` clean):

```
src/
├── main.rs        binary entry → lib.rs
├── lib.rs         Builder + invoke_handler + window-event wiring +
│                  on_permission_request (grant Camera/Mic/DisplayCapture —
│                  embedded webviews have no prompt UI; media capture stays
│                  in JS/mediasoup-client by design, never native)
├── commands.rs    ping (health probe)
├── device.rs      device_info — platform/arch/screen facts
├── security.rs    security_status — readiness posture (unenforced until agent)
├── kiosk.rs       single-owner exam lockdown lifetime (Second Loading →
│                  Result): kiosk_enter/kiosk_exit, window-level lockdown
│                  (fullscreen/undecorated/always-on-top, close blocked),
│                  focus-loss + virtual-desktop watchdog,
│                  release_all_layers, kiosk_emergency_exit (proctor
│                  password), kiosk_trace, lockdown_status
├── lockdown.rs    OS key lockdown driven by kiosk enter/exit — Windows
│                  WH_KEYBOARD_LL swallow hook + 100 ms Ctrl+Alt+Shift
│                  emergency-hold monitor / GNOME gsettings disable+restore
├── registry_lockdown.rs  (Windows) SEB Layer 4 — HKCU policy lockdown
│                  (Task Manager / lock / change password / switch user /
│                  shut down), backed up + restored + reapply-if-tampered
├── shell_lockdown.rs     (Windows) SEB Layer 2 — minimize other windows,
│                  kill/keep-down explorer.exe, restore on exit
├── network.rs     connectivity / exam_server / websocket stubs (unused —
│                  app APIs go direct HTTPS from React by design)
└── errors.rs      AppError / AppResult for command handlers
```

## Scope rule (see architecture/overview.md)

Rust is **not** an API proxy. Only native/privileged surface lives here:
device info, kiosk, secure storage, integrity, Security Agent IPC.
Exam-server REST and SFU media never route through Rust.

## Growth rule

Split `foo.rs` → `foo/mod.rs` + children only when it passes ~200 lines
or gains a 2nd subdomain. Planned growth:

```
src/
├── commands/        # one file per domain when commands.rs gets big
├── storage/         # OS-keychain token storage (replaces localStorage)
├── security/ windows/ integrity/   # lockdown checks
└── agent/           # IPC client to the Security Agent service
```

Keep command handlers thin (parse args → call module → return `AppResult<T>`);
all errors funnel through `errors.rs::AppError`.
