//! Native device facts the UI should not read from the webview.
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenInfo {
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub platform: String,
    pub arch: String,
    pub screen: Option<ScreenInfo>,
}

#[tauri::command]
pub fn device_info(window: tauri::WebviewWindow) -> DeviceInfo {
    let screen = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let size = m.size();
            ScreenInfo {
                width: size.width,
                height: size.height,
                scale_factor: m.scale_factor(),
            }
        });

    DeviceInfo {
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        screen,
    }
}
