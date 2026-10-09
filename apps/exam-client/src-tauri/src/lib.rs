//! Tauri backend entry. Modules mirror docs/architecture/rust.md.
//! React calls exam-server/SFU directly (HTTPS/WebRTC) — this layer only
//! serves native/privileged surface: device facts, security status, and
//! (next) kiosk / storage / agent IPC.
pub mod commands;
pub mod device;
pub mod errors;
pub mod kiosk;
pub mod lockdown;
pub mod network;
pub mod registry_lockdown;
pub mod security;
pub mod shell_lockdown;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .on_window_event(kiosk::on_window_event)
        // Crash repair before any UI: if the last session died mid-exam,
        // Explorer is still dead and the kiosk registry policies are still
        // applied — restore both now (SEB gets this from its service).
        .setup(|_app| {
            kiosk::selfheal_after_launch();
            Ok(())
        })
        // Proctoring needs camera/mic/screen but an embedded webview has no
        // browser chrome to prompt in — unhandled requests are denied by the
        // platform (NotAllowedError in JS). Grant media kinds outright; the
        // candidate already consented on the verification page.
        .on_permission_request(|_, kind| match kind {
            tauri::webview::PermissionKind::Camera
            | tauri::webview::PermissionKind::Microphone
            | tauri::webview::PermissionKind::DisplayCapture => {
                tauri::webview::PermissionResponse::Allow
            }
            _ => tauri::webview::PermissionResponse::Default,
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            device::device_info,
            security::security_status,
            kiosk::kiosk_enter,
            kiosk::kiosk_exit,
            kiosk::kiosk_emergency_exit,
            kiosk::kiosk_trace,
            kiosk::lockdown_status,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application");
}
