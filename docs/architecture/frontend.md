# Frontend conventions

## services/ + api/ — transport only, no UI

```
src/
├── services/
│   ├── api.ts        exam-server REST (ported from candidate portal) ✅ exists
│   └── tauri/        commands.ts (sole invoke() caller), events.ts     ✅ exists
├── api/auth.ts       candidate-login call                              ✅ exists
├── contexts/         ExamSessionContext, ProctorMediaContext           ✅ exists
└── lib/              sfu.ts, ai-proctor.ts, validations, utils, ...    ✅ exists
```

- **Exam-server calls**: React fetches directly (`services/api.ts`) with the
  bearer token from localStorage — same contract as the candidate portal.
  Desktop does not proxy these through Rust (see architecture/overview.md).
- **Native calls**: only via `services/tauri/commands.ts` → Rust commands
  (`device_info`, `security_status`, `ping`). Never `invoke()` directly.
- Create `realtime/` helpers only when a desktop-specific WS need appears;
  the portal's `hooks/useWebSocket.ts` already covers exam lifecycle events.

## pages/ — ported verbatim from the candidate portal

```
pages/
├── auth/LoginPage.tsx
├── MyExamsPage.tsx, MyResultsPage.tsx, SupportPage.tsx
├── ExamPage.tsx
└── exam/  InstructionsPage, SubjectsPage, VerificationPage, ResultPage
```

Desktop-specific adjustments are minimal and marked in-file, e.g.
`MyExamsPage` uses in-window `navigate()` instead of `window.open("_blank")`
(the Tauri webview has no new tabs). Re-sync from the portal by copying the
file and re-applying that one-line difference.

## features/ — one folder per domain (reserved)

```
features/<name>/{components/, hooks/, api.ts, types.ts, store.ts}
```

Existing: `authentication/store.ts` (zustand reference). Other folders are
created on demand — only when a desktop-specific concern (not portal
parity) lands: kiosk readiness, violation dialogs, device binding.

Rules: features import shared types from `@sbyte/types`, call transport
only via `services/`/`api/`, state in zustand `store.ts`.
