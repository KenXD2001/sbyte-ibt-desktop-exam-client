//! All Tauri commands (frontend-callable IPC) live here.
//! Keep handlers thin: parse args, call into network/device/security, return serde types.

#[tauri::command]
pub fn ping() -> String {
    "pong".to_string()
}
