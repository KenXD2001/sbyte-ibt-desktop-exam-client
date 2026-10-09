# Architecture overview

```
apps/exam-client/     React (Vite) + Tauri/Rust — the only runnable app
packages/types/       shared TS domain types
tooling/              installer / signing / OS scripts (stubs until first release)
docs/                 this folder
```

Deferred until a real consumer needs them (do not pre-scaffold):
`apps/security-agent` (Rust OS service), `packages/api-client`,
`packages/validation`, `packages/ui`, `packages/logging`.

## System shape

```
┌──────────────────────────────────────────────────────┐
│ DESKTOP APP                                          │
│  React (UI, exam flow, camera preview)               │
│      │ Tauri IPC                                     │
│  Rust (native/privileged: device, security status)   │
│      │ IPC (future)                                  │
│  Security Agent (future: OS enforcement)             │
└──────┬───────────────────────────┬───────────────────┘
       │ HTTPS/WSS                │ WebRTC
       ▼                          ▼
  Exam Server (NestJS)       SFU Server (mediasoup)
```

## Data flow — two cloud paths, not a proxy

```
React ──── fetch (HTTPS) ────▶ Exam Server   (auth, exams, answers, results)
React ──── WebRTC ──────────▶ SFU           (camera/screen/mic media)
React ──── invoke() ────────▶ Rust commands (device facts, security status)
              ◀── events ────── Rust        (future: violations, connectivity)
```

Rules:
1. Normal application APIs (exam-server REST, WS) are called by React
   **directly** over HTTPS/WSS (`src/services/api.ts` + `src/api/`). Rust is
   NOT a generic network proxy — no value routing tokens/TLS twice.
2. Rust serves only the native/privileged surface the webview must not own:
   device info, kiosk state, secure storage, integrity checks, Security
   Agent IPC. Frontend calls it exclusively via
   `src/services/tauri/commands.ts` (the sole `invoke()` caller).
3. Rust never renders UI — it emits events (`services/tauri/events.ts` names).
4. Proctoring media is WebRTC in the webview (`lib/sfu.ts`,
   `contexts/ProctorMediaContext.tsx`) straight to the SFU; Rust only
   handles device enumeration/permissions when lockdown lands.
5. The server is authoritative: the client reports signals (answers,
   flags, security events); the exam-server judges exam/session state.

## Module map (what exists today)

| Area | Frontend | Rust |
|---|---|---|
| Auth / results / support (portal ports) | `services/api.ts`, `api/auth.ts`, `hooks/queries/` | — (direct HTTPS) |
| Exam flow (instructions → verify → take → result) | `pages/exam/`, `pages/ExamPage.tsx`, `contexts/ExamSessionContext.tsx`, `components/exam/` | — (direct HTTPS) |
| Proctoring media | `contexts/ProctorMediaContext.tsx`, `lib/sfu.ts`, `lib/ai-proctor.ts` | — (WebRTC direct) |
| Device / security posture | `services/tauri/commands.ts` | `device.rs`, `security.rs` |
| Kiosk lockdown | `contexts/ExamSessionContext.tsx` + `hooks/useKioskMode.ts` (Tauri branch) | `kiosk.rs` (window + single-owner lifetime) + `lockdown.rs` (keys) + `shell_lockdown.rs` (Explorer teardown) + `registry_lockdown.rs` (HKCU policy); proctor emergency exit = Ctrl+Alt+Shift hold + password ✅; elevation-resistant service = Security Agent (next) |
| Violations (next) | `features/security/` dialog, server reporting | `kiosk.rs` focus-loss events → agent IPC |
