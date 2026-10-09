# SBYTE IBT Desktop Exam Client

Secure desktop exam client: React (Vite) frontend + Tauri/Rust shell + optional OS security-agent service. Ships the full candidate-portal exam experience as a locked-down desktop app.

## What exists now

Full port of the candidate-portal frontend (`apps/exam-client/src` mirrors
`sbyte-ibt-software/candidate-exam-portal/src`):

- `/auth` — `AuthLayout` + `LoginPage`
- `/my-exams`, `/my-results`, `/support` — `MainLayout` (sidebar + header)
- `/exam/:id/{instructions,subjects,verify,take,result}` — full exam flow
  (`ExamSessionContext` + `ProctorMediaContext`, AI proctoring, SFU media)

Native Tauri layer: `ping`, `device_info`, `security_status`,
`kiosk_enter`/`kiosk_exit`, `kiosk_emergency_exit`, `kiosk_trace`, `lockdown_status`
commands (`src-tauri/src/`) behind the sole IPC wrapper
`services/tauri/commands.ts`. The kiosk arms on the Second Loading screen,
holds through the whole exam, and releases on the Exam Submitted screen
(ResultPage). Windows hardening is layered for Safe-Exam-Browser parity:
window-level Rust lockdown (fullscreen, always-on-top, close blocked,
focus-loss + virtual-desktop watchdog), a `WH_KEYBOARD_LL` key hook
(Win key, Alt+Tab / Alt+F4 / Alt+Esc / Alt+Space), Explorer shell teardown
(`shell_lockdown.rs`), and HKCU policy lockdown (`registry_lockdown.rs`) —
plus Ubuntu/GNOME keybinding disable via `gsettings` (`lockdown.rs`). A
proctor can hold **Ctrl+Alt+Shift for 5 s** and enter a password to release
everything. See `docs/security/overview.md`.

### How requests flow (agreed architecture)

```text
React ── HTTPS ──────▶ Exam Server     (auth, exams, answers, results)
React ── WebRTC ─────▶ SFU Server      (camera/screen/mic)
React ── invoke() ───▶ Rust            (device, security status → future agent)
```

Rust is **not** a generic API proxy — only native/privileged surface lives
there (`docs/architecture/overview.md`). The server stays authoritative.

Existing scaffold untouched: `features/authentication/store.ts` (zustand).

## Prerequisites

- Node 20+, pnpm 9+
- For `dev:tauri` / `tauri:build`: Rust stable + [Tauri v2 system deps](https://v2.tauri.app/start/prerequisites/) for your OS
- A running exam-server (all app data flows); the SFU server for proctoring media

## Layout

```
apps/exam-client/      # the only runnable app for now (React + Tauri)
packages/types/        # shared TS types (single source of truth)
tooling/               # installer / signing / OS scripts (docs + stubs for now)
docs/                  # architecture, security, api, deployment, development
```

Planned but **not scaffolded yet** (see `docs/architecture/overview.md`):
`apps/security-agent`, `packages/api-client`, `packages/validation`, `packages/ui`, `packages/logging`.
They get created when the first real consumer needs them — not before.

## Quick start

Run from the repo root (`sbyte-ibt-desktop-exam-client/`):

```bash
pnpm install
cp apps/exam-client/.env.example apps/exam-client/.env
# set VITE_API_BASE_URL (exam-server, e.g. http://localhost:5051/api)
# and VITE_SFU_URL (SFU, e.g. http://localhost:5052)

pnpm dev:web        # browser only at http://localhost:1420 — fastest, no Rust needed
pnpm dev:tauri      # full desktop window (first run compiles Rust, slow once)
```

Verify / package:

```bash
pnpm --filter @sbyte/exam-client typecheck   # tsc --noEmit
pnpm --filter @sbyte/exam-client build       # tsc + vite production bundle
```

### Build the Windows `.exe`

A release build compiles the Rust shell and produces the standalone
executable **plus** installers (NSIS `-setup.exe` and MSI, because
`bundle.targets = "all"`):

```bash
# from the repo root
pnpm --filter @sbyte/exam-client tauri:build

# equivalent, from apps/exam-client/
pnpm tauri:build
```

Tighter options (skip a format, or skip installers entirely):

```bash
# NSIS installer .exe only (skip the MSI)
pnpm --filter @sbyte/exam-client exec tauri build --bundles nsis

# standalone executable only (no installer)
pnpm --filter @sbyte/exam-client exec tauri build --no-bundle
```

Output (Windows, `x64`):

```text
apps/exam-client/src-tauri/target/release/exam-client.exe
apps/exam-client/src-tauri/target/release/bundle/nsis/SBYTE IBT Exam Client_0.1.0_x64-setup.exe
apps/exam-client/src-tauri/target/release/bundle/msi/SBYTE IBT Exam Client_0.1.0_x64_en-US.msi
```

Notes: `VITE_*` values are **baked in at build time**, so set
`apps/exam-client/.env` before building; the first release build compiles
Rust (slow once); the bundle is unsigned until signing lands in
`tooling/signing/`. Full details: `docs/deployment/build.md`.

Details: `docs/development/getting-started.md`

## Docs

- `docs/architecture/overview.md` — final architecture + what lives where
- `docs/architecture/frontend.md` — services/ + features/ conventions
- `docs/architecture/rust.md` — Tauri backend module map
- `docs/security/overview.md` — trust boundaries, non-goals
- `docs/api/contracts.md` — exam-server / realtime / SFU surface
- `docs/deployment/build.md` — build the Windows `.exe` + versioning/signing
