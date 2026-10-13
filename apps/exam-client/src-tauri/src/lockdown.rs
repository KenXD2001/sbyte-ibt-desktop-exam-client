//! OS-level key/window-switch lockdown for the exam kiosk.
//!
//! Phase 1 — session-level, driven 1:1 by `kiosk_enter`/`kiosk_exit`:
//!   windows: `WH_KEYBOARD_LL` hook swallowing Alt+Tab, the Win/Cmd key,
//!            Alt+F4, Ctrl+Shift+Esc … (React never touches this — Rust does)
//!   linux:   GNOME keybindings disabled via `gsettings` (save → blank → restore)
//!
//! Elevation-resistant enforcement (real service / shell extension,
//! server-verified unlock) is the `apps/security-agent` phase — see
//! docs/security/overview.md. Ctrl+Alt+Del cannot be blocked by any user-mode
//! code on any OS; it is DETECTED instead (focus loss → security-violation).

pub fn engage(window: &tauri::WebviewWindow) {
    platform::engage(window);
}

pub fn release() {
    platform::release();
}

/// True once the low-level keyboard hook is pumping (Windows only).
pub fn hook_installed() -> bool {
    platform::hook_installed()
}

/// Keys swallowed by the hook while kiosk is active (Windows only).
/// Diagnostic counter: if Alt+Tab still switches while this stays flat,
/// the hook isn't seeing keystrokes (see module docs).
pub fn swallowed_count() -> u64 {
    platform::swallowed_count()
}

/// One-shot proctor escape-hatch request (Windows): true once Ctrl + Alt +
/// Shift have been held continuously for 5 seconds while the kiosk is active.
/// The kiosk watchdog forwards it to the frontend, which must supply the
/// password via `kiosk_emergency_exit` before any layer is released.
pub fn take_emergency_request() -> bool {
    platform::take_emergency_request()
}

/// Windows: keep a low-level keyboard hook installed for the process
/// lifetime; the hook procedure itself gates on `kiosk::is_active()`, so the
/// lockdown is global while an exam holds the window (no foreground check —
/// gating on foreground is what let Win/Alt+Tab slip through once focus was
/// lost, leaving the candidate free on another desktop).
#[cfg(target_os = "windows")]
mod platform {
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};

    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_DELETE, VK_ESCAPE, VK_F4, VK_LCONTROL, VK_LMENU,
        VK_LSHIFT, VK_LWIN, VK_MENU, VK_RCONTROL, VK_RMENU, VK_RSHIFT, VK_RWIN, VK_SHIFT,
        VK_SPACE, VK_TAB,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, KBDLLHOOKSTRUCT, SetWindowsHookExW,
        TranslateMessage, MSG, WH_KEYBOARD_LL, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    static HOOK_INSTALLED: AtomicBool = AtomicBool::new(false);
    /// Diagnostic: keystrokes swallowed while kiosk is active.
    static SWALLOWED: AtomicU64 = AtomicU64::new(0);

    // ── Proctor escape hatch: hold Ctrl + Alt + Shift for 5 seconds ─────────
    // Detected by POLLING the physical modifier state (GetAsyncKeyState), not by
    // the keyboard hook: the hook only runs when it receives events and can be
    // starved, whereas polling is reliable and gives an accurate hold timer
    // that is immune to focus/hook quirks. Modifier keys sit outside the
    // keyboard's rollover/ghosting matrix, so (unlike a multi-letter chord)
    // this registers on virtually every keyboard. The hold only *requests* the
    // exit — the frontend must supply the password before anything is released
    // (kiosk::kiosk_emergency_exit), so even an accidental trigger is safe.
    //
    // (Chosen after a diagnostic proved the intended I+O+J+K+L letter chord was
    // physically impossible on the target hardware: the keyboard reported only
    // I, O and J and silently dropped K and L — key ghosting.)
    /// Bit per modifier: 0 = Ctrl, 1 = Alt, 2 = Shift.
    const HOLD_ALL: u32 = 0b111;
    /// How long the whole chord must stay held before it counts.
    const HOLD_MS: u64 = 5_000;
    /// How often the dedicated monitor samples the chord (ms).
    const HOLD_POLL_MS: u64 = 100;

    /// Ms timestamp (process-relative) when the chord first became complete,
    /// or 0 when it isn't complete. Reset whenever the chord is broken.
    static HELD_SINCE_MS: AtomicU64 = AtomicU64::new(0);
    /// Latch so one hold reports once; re-armed when the chord is released.
    static HOLD_REPORTED: AtomicBool = AtomicBool::new(false);
    /// Set by the monitor when a full hold completes; consumed by the kiosk
    /// watchdog (which owns the window and emits the dialog event).
    static REQUEST_PENDING: AtomicBool = AtomicBool::new(false);
    static MONITOR_STARTED: AtomicBool = AtomicBool::new(false);
    static START: OnceLock<Instant> = OnceLock::new();

    fn now_ms() -> u64 {
        START.get_or_init(Instant::now).elapsed().as_millis() as u64
    }

    pub fn hook_installed() -> bool {
        HOOK_INSTALLED.load(Ordering::SeqCst)
    }

    pub fn swallowed_count() -> u64 {
        SWALLOWED.load(Ordering::Relaxed)
    }

    fn reset_hold() {
        HELD_SINCE_MS.store(0, Ordering::SeqCst);
        HOLD_REPORTED.store(false, Ordering::SeqCst);
    }

    /// Which of Ctrl / Alt / Shift are physically down right now. The left/right
    /// variants are checked explicitly (the generic VK_CONTROL / VK_MENU are
    /// unreliable with GetAsyncKeyState).
    fn chord_mask() -> u32 {
        let mut mask = 0u32;
        if key_down(VK_LCONTROL as i32) || key_down(VK_RCONTROL as i32) {
            mask |= 1 << 0;
        }
        if key_down(VK_LMENU as i32) || key_down(VK_RMENU as i32) {
            mask |= 1 << 1;
        }
        if key_down(VK_LSHIFT as i32) || key_down(VK_RSHIFT as i32) {
            mask |= 1 << 2;
        }
        mask
    }

    /// Sampled by the monitor thread: logs detection / early release and latches
    /// REQUEST_PENDING once the full chord has been held for HOLD_MS.
    fn poll_hold() {
        if chord_mask() != HOLD_ALL {
            if HELD_SINCE_MS.load(Ordering::SeqCst) != 0
                && !HOLD_REPORTED.load(Ordering::SeqCst)
            {
                eprintln!("[kiosk] proctor combo released before 5s — no exit requested");
            }
            reset_hold();
            return;
        }
        let since = HELD_SINCE_MS.load(Ordering::SeqCst);
        if since == 0 {
            HELD_SINCE_MS.store(now_ms(), Ordering::SeqCst);
            eprintln!(
                "[kiosk] proctor combo detected: Ctrl+Alt+Shift all held — hold 5s to request exit"
            );
            return;
        }
        if now_ms().saturating_sub(since) >= HOLD_MS && !HOLD_REPORTED.swap(true, Ordering::SeqCst)
        {
            REQUEST_PENDING.store(true, Ordering::SeqCst);
            eprintln!("[kiosk] proctor combo held 5s — exit request latched");
        }
    }

    /// Dedicated ~100 ms monitor so the 5 s hold is timed accurately and never
    /// depends on the keyboard hook firing (see the note above).
    fn start_monitor_once() {
        if MONITOR_STARTED.swap(true, Ordering::SeqCst) {
            return;
        }
        std::thread::spawn(|| loop {
            std::thread::sleep(Duration::from_millis(HOLD_POLL_MS));
            if crate::kiosk::is_active() {
                poll_hold();
            } else {
                reset_hold();
                REQUEST_PENDING.store(false, Ordering::SeqCst);
            }
        });
    }

    /// Consumed by the kiosk watchdog: true once a full 5 s hold has completed.
    pub fn take_emergency_request() -> bool {
        if !crate::kiosk::is_active() {
            REQUEST_PENDING.store(false, Ordering::SeqCst);
            return false;
        }
        REQUEST_PENDING.swap(false, Ordering::SeqCst)
    }

    /// `KBDLLHOOKSTRUCT.flags` bit set when Alt is held (more reliable inside
    /// the hook than polling async state mid-combo).
    const LLKHF_ALTDOWN: u32 = 0x20;
    /// `nCode` value for real key data.
    const HC_ACTION: i32 = 0;

    fn key_down(vk: i32) -> bool {
        // SAFETY: GetAsyncKeyState is always callable.
        unsafe { GetAsyncKeyState(vk) as u16 & 0x8000 != 0 }
    }

    fn blocks(vk: u32, flags: u32, wparam: WPARAM) -> bool {
        // Alt-held combos arrive as SYSKEY messages — this is the trustworthy
        // Alt signal. Plain typing/navigation (Tab, F4, Esc, Space) arrives as
        // WM_KEYDOWN, so gating on the message type cannot over-block, and it
        // needs no async modifier polling (which proved unreliable for Alt).
        let w = wparam as u32;
        if w == WM_SYSKEYDOWN || w == WM_SYSKEYUP {
            match vk {
                v if v == VK_TAB as u32 => return true, // Alt+Tab / Alt+Shift+Tab
                v if v == VK_F4 as u32 => return true, // Alt+F4
                v if v == VK_ESCAPE as u32 => return true, // Alt+Esc
                v if v == VK_SPACE as u32 => return true, // Alt+Space (system menu)
                _ => {}
            }
        }
        let alt = (flags & LLKHF_ALTDOWN) != 0 || key_down(VK_MENU as i32);
        let ctrl = key_down(VK_CONTROL as i32);
        let shift = key_down(VK_SHIFT as i32);
        let win = key_down(VK_LWIN as i32) || key_down(VK_RWIN as i32);
        let _ = shift;

        // The Win keys themselves — swallowing the press keeps the OS from
        // ever entering Win-combo mode (Start, Win+Tab, Win+D/R/E/L/M, …).
        if vk == VK_LWIN as u32 || vk == VK_RWIN as u32 {
            return true;
        }
        // Belt-and-braces: ANY key while Win is physically held is swallowed.
        // Covers Win+Tab (Task View), Win+D (show desktop), Win+number,
        // Win+Ctrl+D / Win+Ctrl+Left-Right (virtual-desktop create/switch)
        // even if a Win press ever slips past the hook.
        if win {
            return true;
        }
        match vk {
            // Ctrl+Tab / Ctrl+Alt+Tab (Alt+Tab itself is swallowed above via
            // SYSKEYDOWN, no modifier polling involved).
            v if v == VK_TAB as u32 => alt || ctrl,
            // Esc — ALWAYS swallowed while kiosk is active, even bare. The
            // browser drops HTML fullscreen on a plain Esc, which shrank the
            // exam content inside the still-locked window (small page + black
            // corners). Covers Alt+Esc / Ctrl+Esc / Ctrl+Shift+Esc too.
            v if v == VK_ESCAPE as u32 => true,
            // Alt+F4 (close is also refused by kiosk.rs) and Alt+Space
            // (window system menu: move/size/minimize/close).
            v if v == VK_F4 as u32 => alt,
            v if v == VK_SPACE as u32 => alt,
            // Ctrl+Alt+Del attempt — the OS reserves this (Secure Attention
            // Sequence) and no user-mode hook can stop it; trying is harmless
            // and documents intent. Focus loss is DETECTED (kiosk.rs emit).
            v if v == VK_DELETE as u32 => ctrl && alt,
            _ => false,
        }
    }

    unsafe extern "system" fn hook_proc(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code == HC_ACTION {
            let kb = &*(lparam as *const KBDLLHOOKSTRUCT);
            // Scoped to an active kiosk; the proctor chord is detected by the
            // separate 100 ms monitor (see start_monitor_once), not here.
            if crate::kiosk::is_active() && blocks(kb.vkCode, kb.flags, wparam) {
                SWALLOWED.fetch_add(1, Ordering::Relaxed);
                return 1; // swallowed — no window ever sees it
            }
        }
        // LL hooks ignore the hhk argument; null is valid.
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }

    pub fn engage(_window: &tauri::WebviewWindow) {
        // Start the chord monitor first — it must run regardless of whether the
        // hook installs successfully.
        start_monitor_once();
        if HOOK_INSTALLED.swap(true, Ordering::SeqCst) {
            return; // already pumping — the hook gates on kiosk state
        }
        std::thread::spawn(|| unsafe {
            // hmod = null: procedure lives in this process (LL hook rule).
            let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), std::ptr::null_mut(), 0);
            if hook.is_null() {
                HOOK_INSTALLED.store(false, Ordering::SeqCst);
                eprintln!("[lockdown] SetWindowsHookExW failed — Win/Alt+Tab NOT blocked");
                return;
            }
            eprintln!("[lockdown] keyboard hook installed — Win/Alt+Tab/Alt+F4/Esc blocked while kiosk active");
            let mut msg = std::mem::zeroed::<MSG>();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    }

    pub fn release() {
        // Nothing to tear down: the hook passes everything through while
        // kiosk is inactive and dies with the process.
    }
}

/// Linux/GNOME: swap every window-switch / app-launch / screenshot
/// keybinding for an empty one, remembering the previous values.
#[cfg(target_os = "linux")]
mod platform {
    use std::process::Command;
    use std::sync::Mutex;

    /// (schema, key, value that disables it)
    const DISABLED: &[(&str, &str, &str)] = &[
        // Super key opens Activities
        ("org.gnome.mutter", "overlay-key", "''"),
        // Alt+Tab, Ctrl+Alt+Tab, Alt+Esc equivalents
        ("org.gnome.desktop.wm.keybindings", "switch-applications", "[]"),
        ("org.gnome.desktop.wm.keybindings", "switch-applications-backward", "[]"),
        ("org.gnome.desktop.wm.keybindings", "switch-windows", "[]"),
        ("org.gnome.desktop.wm.keybindings", "switch-windows-backward", "[]"),
        ("org.gnome.desktop.wm.keybindings", "switch-group", "[]"),
        ("org.gnome.desktop.wm.keybindings", "switch-group-backward", "[]"),
        ("org.gnome.desktop.wm.keybindings", "switch-panels", "[]"),
        ("org.gnome.desktop.wm.keybindings", "switch-panels-backward", "[]"),
        // Virtual desktops
        ("org.gnome.desktop.wm.keybindings", "switch-to-workspace-1", "[]"),
        ("org.gnome.desktop.wm.keybindings", "switch-to-workspace-2", "[]"),
        ("org.gnome.desktop.wm.keybindings", "switch-to-workspace-3", "[]"),
        ("org.gnome.desktop.wm.keybindings", "switch-to-workspace-4", "[]"),
        ("org.gnome.desktop.wm.keybindings", "switch-to-workspace-left", "[]"),
        ("org.gnome.desktop.wm.keybindings", "switch-to-workspace-right", "[]"),
        ("org.gnome.desktop.wm.keybindings", "switch-to-workspace-up", "[]"),
        ("org.gnome.desktop.wm.keybindings", "switch-to-workspace-down", "[]"),
        ("org.gnome.desktop.wm.keybindings", "show-desktop", "[]"),
        // Alt+F1 / Alt+F2 — app menu and run dialog
        ("org.gnome.desktop.wm.keybindings", "panel-main-menu", "[]"),
        ("org.gnome.desktop.wm.keybindings", "panel-run-dialog", "[]"),
        // Super+number, overview / app grid
        ("org.gnome.shell.keybindings", "switch-to-application-1", "[]"),
        ("org.gnome.shell.keybindings", "switch-to-application-2", "[]"),
        ("org.gnome.shell.keybindings", "switch-to-application-3", "[]"),
        ("org.gnome.shell.keybindings", "switch-to-application-4", "[]"),
        ("org.gnome.shell.keybindings", "switch-to-application-5", "[]"),
        ("org.gnome.shell.keybindings", "switch-to-application-6", "[]"),
        ("org.gnome.shell.keybindings", "switch-to-application-7", "[]"),
        ("org.gnome.shell.keybindings", "switch-to-application-8", "[]"),
        ("org.gnome.shell.keybindings", "switch-to-application-9", "[]"),
        ("org.gnome.shell.keybindings", "toggle-overview", "[]"),
        ("org.gnome.shell.keybindings", "toggle-application-view", "[]"),
        // PrintScreen family — no screenshots of questions
        ("org.gnome.shell.keybindings", "screenshot", "[]"),
        ("org.gnome.shell.keybindings", "screenshot-window", "[]"),
        ("org.gnome.shell.keybindings", "show-screenshot-ui", "[]"),
        ("org.gnome.shell.keybindings", "show-screen-recording-ui", "[]"),
        // Ctrl+Alt+T terminal
        ("org.gnome.settings-daemon.plugins.media-keys", "terminal", "[]"),
    ];

    /// (schema, key, previous value)
    static SAVED: Mutex<Vec<(String, String, String)>> = Mutex::new(Vec::new());

    fn gsettings(args: &[&str]) -> Option<String> {
        let out = Command::new("gsettings").args(args).output().ok()?;
        if !out.status.success() {
            return None; // schema/key absent on this DE — skip gracefully
        }
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    fn disable_all() {
        let mut saved = SAVED.lock().unwrap_or_else(|p| p.into_inner());
        for (schema, key, empty) in DISABLED {
            if let Some(previous) = gsettings(&["get", schema, key]) {
                if gsettings(&["set", schema, key, empty]).is_some() {
                    saved.push((schema.to_string(), key.to_string(), previous));
                }
            }
        }
        if saved.is_empty() {
            eprintln!("[lockdown] gsettings unavailable or non-GNOME session — no keybindings disabled");
        }
    }

    fn restore_all() {
        let mut saved = SAVED.lock().unwrap_or_else(|p| p.into_inner());
        for (schema, key, previous) in saved.drain(..) {
            let _ = gsettings(&["set", &schema, &key, &previous]);
        }
    }

    pub fn engage(_window: &tauri::WebviewWindow) {
        disable_all();
    }

    pub fn release() {
        restore_all();
    }

    pub fn hook_installed() -> bool {
        false // Linux uses gsettings, not a key hook
    }

    pub fn swallowed_count() -> u64 {
        0
    }

    pub fn take_emergency_request() -> bool {
        false // no emergency hotkey on Linux (no shell kill to escape)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        /// The one runnable check: disable actually blanks a binding, and
        /// restore puts the exact previous value back.
        #[test]
        fn gsettings_roundtrip() {
            let key = ("org.gnome.desktop.wm.keybindings", "switch-applications");
            let Some(before) = gsettings(&["get", key.0, key.1]) else {
                return; // no gsettings (headless CI) — nothing to verify
            };
            disable_all();
            let during = gsettings(&["get", key.0, key.1]);
            restore_all(); // restore BEFORE asserting so a failure can't leave
                           // the user's session crippled
            let after = gsettings(&["get", key.0, key.1]);
            assert!(
                during.as_deref() == Some("[]") || during.as_deref() == Some("@as []"),
                "binding not disabled, got {during:?}"
            );
            assert_eq!(after.as_deref(), Some(before.as_str()), "restore mismatch");
        }
    }
}

/// macOS: needs CGEventTap (accessibility permission) or an MDM profile —
/// not implemented; kiosk stays window-level there.
#[cfg(target_os = "macos")]
mod platform {
    pub fn engage(_window: &tauri::WebviewWindow) {
        eprintln!("[lockdown] macOS key lockdown not implemented (CGEventTap/MDM — docs/security/overview.md)");
    }

    pub fn release() {}

    pub fn hook_installed() -> bool {
        false
    }

    pub fn swallowed_count() -> u64 {
        0
    }

    pub fn take_emergency_request() -> bool {
        false
    }
}
