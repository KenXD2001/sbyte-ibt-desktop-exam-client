//! Security posture queries for the pre-exam readiness screen.
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityStatus {
    pub agent_installed: bool,
    pub kiosk_active: bool,
    pub integrity: String,
}

#[tauri::command]
pub fn security_status() -> SecurityStatus {
    // ponytail: no security-agent yet — always reports "unenforced" so the
    // UI can render a honest readiness state. Wire real IPC when
    // apps/security-agent lands (kiosk/process/integrity checks).
    SecurityStatus {
        agent_installed: false,
        kiosk_active: false,
        integrity: "unenforced".to_string(),
    }
}
