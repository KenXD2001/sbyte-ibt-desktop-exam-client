# tooling/

Ships installer / signing / OS setup scripts. Currently stubs — real scripts
land with the first release (see `docs/deployment/build.md`).

- `installer/` — NSIS (Windows) / deb+rpm/AppImage (Linux) packaging config
- `signing/` — cert handling, timestamping
- `windows/` — lockdown helpers, service install for `security-agent`
- `linux/` — desktop entry, permissions
