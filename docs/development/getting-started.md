# Getting started

Prereqs: Node 20+, pnpm 9+, Rust stable. For `tauri:dev`, also the
[Tauri v2 system deps](https://v2.tauri.app/start/prerequisites/) for your OS
(Ubuntu/Debian: `libwebkit2gtk-4.1-dev build-essential curl wget file
libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libglib2.0-dev`).

```bash
pnpm install
pnpm dev:web        # React only, fastest loop — no Rust needed
pnpm dev:tauri      # full desktop shell (first run compiles Rust, slow once)
pnpm --filter @sbyte/exam-client typecheck
```

Env: copy the example and point at your deployment —
`cp apps/exam-client/.env.example apps/exam-client/.env`, then set:

- `VITE_API_BASE_URL` — exam-server REST (login, my-exams, exam flow),
  e.g. `"http://localhost:5051/api"`
- `VITE_SFU_URL` — mediasoup SFU base (proctoring), e.g. `http://localhost:5052`

The UI is the full candidate-portal port: `/auth`, `/my-exams`,
`/my-results`, `/support`, and `/exam/:id/{instructions,subjects,verify,take,result}`.
Start the exam-server (+ SFU for proctoring) from `sbyte-ibt-software` to
exercise the flows end-to-end.

## Build a release `.exe` (Windows)

```bash
# from the repo root — raw exe + NSIS setup.exe + MSI
pnpm --filter @sbyte/exam-client tauri:build

# single installer type / no installer
pnpm --filter @sbyte/exam-client exec tauri build --bundles nsis
pnpm --filter @sbyte/exam-client exec tauri build --no-bundle
```

Artifacts land under `apps/exam-client/src-tauri/target/release/`
(`exam-client.exe`) and `…/target/release/bundle/{nsis,msi}/`. Set
`apps/exam-client/.env` first — `VITE_*` values are baked in at build time.
Full details (outputs, prerequisites, signing, versioning):
`docs/deployment/build.md`.
