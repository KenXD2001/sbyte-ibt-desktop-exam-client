# API contracts

The desktop client uses the **same contracts as the candidate portal** —
the source of truth is the exam-server OpenAPI/implementation plus
`sbyte-ibt-software/candidate-exam-portal/src/services/api.ts`, which this
app mirrors (`apps/exam-client/src/services/api.ts`).

Base URL: `VITE_API_BASE_URL` (e.g. `http://<host>:<port>/api`).
Auth: `Authorization: Bearer <token>` from `localStorage.token`
(portal parity; move to OS-keychain via Rust when lockdown starts).

| Surface | Transport | Owner | Status |
|---|---|---|---|
| REST: auth (`/auth/candidate-login`), candidate-exam (kpis, upcoming, session, questions, answers, submit, results), support, uploads | HTTPS direct from React | `services/api.ts`, `api/auth.ts` | ported ✅ |
| Exam lifecycle WS | WSS direct (`hooks/useWebSocket.ts`) | same | ported ✅ |
| SFU signalling (Socket.IO `/signaling`) + WebRTC media | direct to SFU | `lib/sfu.ts`, `contexts/ProctorMediaContext.tsx` | ported ✅ |
| Native: `ping`, `device_info`, `security_status` | Tauri IPC | `services/tauri/commands.ts` ↔ `src-tauri/src/` | scaffold ✅ |

Change process: edit the portal first, then re-sync the mirror file here so
both apps keep one contract.
