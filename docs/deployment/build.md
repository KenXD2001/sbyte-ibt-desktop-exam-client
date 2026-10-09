# Build & release

## Quick commands

```bash
pnpm install
pnpm build                                    # web bundle + shared packages (turbo)
pnpm --filter @sbyte/exam-client tauri:build  # release .exe + installers
```

## Windows — build the `.exe`

`tauri:build` runs `beforeBuildCommand` (`pnpm build` → `tsc --noEmit && vite
build`) and then compiles the Rust shell in release mode. Because
`apps/exam-client/src-tauri/tauri.conf.json` sets `bundle.targets = "all"`,
Windows produces **both** an NSIS `-setup.exe` and an MSI.

```bash
# from the repo root
pnpm --filter @sbyte/exam-client tauri:build

# or from apps/exam-client/
pnpm tauri:build
```

Build a single installer type, or skip installers entirely:

```bash
# NSIS installer only (skip the MSI)
pnpm --filter @sbyte/exam-client exec tauri build --bundles nsis

# MSI only
pnpm --filter @sbyte/exam-client exec tauri build --bundles msi

# standalone executable only (no installer)
pnpm --filter @sbyte/exam-client exec tauri build --no-bundle
```

### Output (Windows, x64)

| Artifact | Path |
|---|---|
| Raw executable | `apps/exam-client/src-tauri/target/release/exam-client.exe` |
| NSIS installer | `apps/exam-client/src-tauri/target/release/bundle/nsis/SBYTE IBT Exam Client_0.1.0_x64-setup.exe` |
| MSI installer | `apps/exam-client/src-tauri/target/release/bundle/msi/SBYTE IBT Exam Client_0.1.0_x64_en-US.msi` |

The version (`0.1.0`), architecture (`x64`) and MSI language (`en-US`) come from
`tauri.conf.json` / the host and change per release. The executable/bundle name
derives from the Cargo package (`exam-client`) and `productName`
(`SBYTE IBT Exam Client`).

### Prerequisites (Windows)

- Rust stable with the **MSVC** toolchain (`x86_64-pc-windows-msvc`).
- **Visual Studio Build Tools** with the "Desktop development with C++" workload
  (MSVC linker + Windows SDK).
- **WebView2 runtime** — ships with Windows 11 and is pre-installed on updated
  Windows 10; the installer bootstraps it when absent.
- Tauri downloads the NSIS/WiX bundling tools on first build — nothing to
  install by hand.

### Before you build

- `VITE_*` variables are **inlined at build time** (Vite), so `.env` must
  already point at the target environment:
  `cp apps/exam-client/.env.example apps/exam-client/.env`, then set
  `VITE_API_BASE_URL` and `VITE_SFU_URL` (see
  `docs/development/getting-started.md`).
- Dev-only shortcuts (the DevTools hatch in `hooks/useKioskMode.ts`) are gated on
  `import.meta.env.DEV` and are **off** in the release build.

### Signing

Installers are **unsigned** by default — Windows SmartScreen will warn until a
certificate is applied. Production releases are code-signed (Windows
Authenticode + timestamping) via `tooling/signing/` (stub until the first
internal release). `--no-sign` skips signing when you only need a local build.

## Versioning

Bump the single `version` together in:

- `package.json` (root)
- `apps/exam-client/package.json`
- `apps/exam-client/src-tauri/Cargo.toml`
- `apps/exam-client/src-tauri/tauri.conf.json`

Installers/signing/OS scripts live in `tooling/` — see `tooling/README.md`.
