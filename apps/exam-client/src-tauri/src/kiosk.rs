//! Exam kiosk lockdown — window level, enforced by Rust, not the webview.
//!
//! The portal's kiosk is HTML fullscreen + JS key handlers, which Esc and
//! Alt+Tab defeat trivially. Here the *window* is fullscreen, undecorated,
//! always-on-top, and close requests are swallowed while an exam is active.
//! OS key lockdown lives in lockdown.rs (`WH_KEYBOARD_LL` while active):
//! Win keys, Alt+Tab, Win+Tab, virtual-desktop combos, Ctrl+Esc, Alt+Esc,
//! Alt+F4, Alt+Space, Ctrl+Shift+Esc. Ctrl+Alt+Del cannot be blocked by any
//! user-mode code on Windows (Secure Attention Sequence) — it is DETECTED
//! via focus loss and re-focused best-effort (see below).
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{Emitter, WebviewWindow, WindowEvent};

static ACTIVE: AtomicBool = AtomicBool::new(false);
/// Throttle for focus-loss handling: DevTools / overlay focus ping-pongs
/// otherwise emit + refocus in a tight loop (25+ toasts in the log).
/// First event acts immediately, repeats within the window are dropped.
static LAST_VIOLATION: Mutex<Option<Instant>> = Mutex::new(None);
const VIOLATION_COOLDOWN: Duration = Duration::from_millis(2000);
/// Watchdog (Windows): polls the foreground window while active so escapes
/// that never fire `Focused(false)` — precision-touchpad virtual-desktop
/// gestures, Task View / Start focus theft — are still detected within ~1.5s.
static WATCHDOG_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static KIOSK_HWND: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

pub fn is_active() -> bool {
    ACTIVE.load(Ordering::SeqCst)
}

#[derive(Clone, Serialize)]
struct SecurityViolation {
    kind: &'static str,
}

/// Diagnostic snapshot for the frontend log: proves the native lockdown is
/// really engaged (hook installed + swallowing keys + policies applied)
/// instead of silently dead.
#[derive(Clone, Serialize)]
pub struct LockdownStatus {
    kiosk_active: bool,
    hook_installed: bool,
    keys_swallowed: u64,
    registry_enforced: bool,
    explorer_running: bool,
}

#[tauri::command]
pub fn lockdown_status() -> LockdownStatus {
    LockdownStatus {
        kiosk_active: is_active(),
        hook_installed: crate::lockdown::hook_installed(),
        keys_swallowed: crate::lockdown::swallowed_count(),
        registry_enforced: registry_enforced(),
        explorer_running: explorer_running(),
    }
}

/// SEB Layer 2+4 state reporting — false on non-Windows platforms.
#[cfg(target_os = "windows")]
fn registry_enforced() -> bool {
    crate::registry_lockdown::is_enforced()
}

#[cfg(not(target_os = "windows"))]
fn registry_enforced() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn explorer_running() -> bool {
    crate::shell_lockdown::explorer_running()
}

#[cfg(not(target_os = "windows"))]
fn explorer_running() -> bool {
    false
}

/// SEB Layers 2 (shell) + 4 (registry policy) engagement — Windows only,
/// empty elsewhere (matches lockdown.rs's per-platform pattern).
#[cfg(target_os = "windows")]
fn layers_enter() {
    // SEB Layer 4: empty the Ctrl+Alt+Del security screen (user-hive
    // policies — Task Manager / Lock / Switch user / Shut down).
    crate::registry_lockdown::enter();
    // SEB Layer 2: kill the shell — Start menu, taskbar, Task View and the
    // touchpad gesture handlers live in explorer.exe; without it those
    // escapes have nothing left to open.
    crate::shell_lockdown::enter();
}

#[cfg(not(target_os = "windows"))]
fn layers_enter() {}

#[cfg(target_os = "windows")]
fn layers_exit() {
    // Undo the shell + registry layers — the candidate gets their taskbar
    // and policies back only once the window lock is already off.
    crate::shell_lockdown::exit();
    crate::registry_lockdown::exit();
}

#[cfg(not(target_os = "windows"))]
fn layers_exit() {}

/// Shared throttle for every focus-loss path (window event + watchdog).
/// Returns true when throttled — the caller must skip emit + refocus.
fn claim_violation_slot() -> bool {
    match LAST_VIOLATION.lock() {
        Ok(mut last) => {
            let now = Instant::now();
            match *last {
                Some(t) if now.duration_since(t) < VIOLATION_COOLDOWN => true,
                _ => {
                    *last = Some(now);
                    false
                }
            }
        }
        Err(_) => false,
    }
}

/// Release every lockdown layer in one place (used by the authorized
/// emergency exit). Idempotent — the normal ResultPage exit runs the same
/// releases, so a race between the two is harmless.
fn release_all_layers(window: &WebviewWindow) {
    ACTIVE.store(false, Ordering::SeqCst);
    crate::lockdown::release();
    #[cfg(target_os = "windows")]
    {
        crate::shell_lockdown::exit();
        crate::registry_lockdown::exit();
    }
    // Let the frontend flip its own kiosk state (exits HTML fullscreen too).
    let _ = window.emit("kiosk-emergency-exit", ());
    let _ = window.set_fullscreen(false);
    let _ = window.set_always_on_top(false);
    let _ = window.set_decorations(true);
}

/// Proctor emergency-exit password. The hold-Ctrl+Alt+Shift-for-5s chord only
/// REQUESTS the exit; nothing is released until this matches. Kept as a build
/// constant for now (per proctor request); the real deployment should move it
/// to server-provided exam config or the security agent so it isn't baked
/// into the binary.
const EMERGENCY_EXIT_PASSWORD: &str = "digiexam1";

/// Authorized emergency exit. Validates the proctor password in Rust (the
/// combo alone must not release a live exam) and, on success, tears down the
/// window + hook + shell + registry layers. Wrong password = no-op + error.
#[tauri::command]
pub fn kiosk_emergency_exit(window: WebviewWindow, password: String) -> Result<(), String> {
    if password != EMERGENCY_EXIT_PASSWORD {
        eprintln!("[kiosk] emergency exit REJECTED — incorrect password");
        return Err("Incorrect password".into());
    }
    eprintln!("[kiosk] emergency exit AUTHORIZED — releasing all lockdown layers");
    release_all_layers(&window);
    Ok(())
}

/// Frontend breadcrumb for the emergency-exit audit trail. The webview console
/// is not visible while the kiosk is locked down, so the password dialog calls
/// this to write its milestones (request shown / cancelled) into the same
/// terminal log as the native combo + auth events.
#[tauri::command]
pub fn kiosk_trace(stage: String) {
    eprintln!("[kiosk] proctor emergency dialog: {stage}");
}

/// Windows watchdog: virtual-desktop gestures (touchpad swipe), Task View
/// and Start-menu focus theft don't always deliver `Focused(false)` — poll
/// the foreground window and treat ~1.5s of foreign foreground as a
/// focus-loss violation (emit + best-effort refocus, same cooldown).
///
/// Containment: keyboard hooks cannot intercept touchpad gestures (no
/// keystrokes exist to swallow), so the watchdog additionally drags OUR
/// window onto the virtual desktop the candidate is viewing (see `vdm`).
/// The escape then gains nothing — the exam follows them — while the
/// emitted violation still punishes per exam settings.
#[cfg(target_os = "windows")]
fn ensure_watchdog(window: WebviewWindow) {
    if WATCHDOG_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
        // COM apartment for this thread (needed by the VDM client below).
        let vdm = vdm::Vdm::create();
        let mut misses: u32 = 0;
        let mut ticks: u32 = 0;
        loop {
            std::thread::sleep(Duration::from_millis(750));
            // Proctor chord completed (Ctrl+Alt+Shift held 5s, lockdown.rs):
            // forward a password prompt request to the frontend. NOTHING is
            // released here — kiosk_emergency_exit does that once the proctor
            // password checks out.
            if crate::lockdown::take_emergency_request() {
                eprintln!(
                    "[kiosk] emitting kiosk-emergency-request (password dialog)"
                );
                let _ = window.emit("kiosk-emergency-request", ());
                misses = 0;
                continue;
            }
            if !is_active() {
                misses = 0;
                continue;
            }
            // SEB-monitor duties while active (~every 2s): policies re-applied
            // if cleared mid-exam, shell kept down if it auto-restarts.
            ticks += 1;
            if ticks % 3 == 0 {
                crate::registry_lockdown::reapply_if_tampered();
                crate::shell_lockdown::kill_explorer_if_running();
            }
            let ours = KIOSK_HWND.load(Ordering::SeqCst);
            // SAFETY: GetForegroundWindow is always callable; null (0) means
            // no foreground window (e.g. secure desktop) — still a violation.
            let fg = unsafe { GetForegroundWindow() } as isize;
            if ours != 0 && fg == ours {
                misses = 0;
                continue;
            }
            misses += 1;
            if misses < 2 {
                continue;
            }
            if claim_violation_slot() {
                continue;
            }
            // Gesture / Task View switch: our window is marooned on another
            // desktop. Pull it onto the desktop in view, then re-assert.
            if let Some(v) = vdm.as_ref() {
                let on_current = v.is_on_current_desktop(ours).unwrap_or(true);
                if !on_current && fg != 0 {
                    if let Some(g) = v.desktop_of(fg) {
                        if v.move_to(ours, &g) {
                            eprintln!(
                                "[kiosk] exam window followed candidate to current virtual desktop"
                            );
                        }
                    }
                }
            }
            let _ = window.set_always_on_top(true);
            let _ = window.set_fullscreen(true);
            let _ = window.set_focus();
            let _ = window.emit(
                "security-violation",
                SecurityViolation { kind: "focus-lost" },
            );
        }
    });
}

/// Windows-only minimal IVirtualDesktopManager client (hand-rolled vtable —
/// windows-sys 0.61 doesn't ship this interface; CLSID/IID are stable OS
/// constants). All calls are best-effort; failures degrade to detect-only.
#[cfg(target_os = "windows")]
mod vdm {
    use windows_sys::core::GUID;
    use windows_sys::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };

    const CLSID_VDM: GUID = GUID::from_u128(0xaa509086_5ca9_4c25_8f95_589d3c07b48a);
    const IID_VDM: GUID = GUID::from_u128(0xa5cd92ff_29be_454c_8d04_d82879fb4f1b);

    type Ctx = *mut std::ffi::c_void;
    type Hwnd = *mut std::ffi::c_void;
    // IUnknown occupies slots 0..2; then IsWindowOnCurrentVirtualDesktop (3),
    // GetWindowDesktopId (4), MoveWindowToDesktop (5).
    type Slot3 = unsafe extern "system" fn(Ctx, Hwnd, *mut i32) -> i32;
    type Slot4 = unsafe extern "system" fn(Ctx, Hwnd, *mut GUID) -> i32;
    type Slot5 = unsafe extern "system" fn(Ctx, Hwnd, *const GUID) -> i32;

    /// COM interface pointer. Owned by the watchdog thread for the process
    /// lifetime (never leaves that STA thread).
    pub struct Vdm(Ctx);

    // Never shared across threads; Send lets the spawning closure own it.
    unsafe impl Send for Vdm {}

    unsafe fn vslot(this: Ctx, index: usize) -> Ctx {
        let vtbl = *(this as *mut *mut Ctx);
        *vtbl.add(index)
    }

    impl Vdm {
        pub fn create() -> Option<Self> {
            unsafe {
                // Per-thread apartment; S_FALSE (already initialised) is fine.
                CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
                let mut raw: Ctx = std::ptr::null_mut();
                let hr = CoCreateInstance(
                    &CLSID_VDM,
                    std::ptr::null_mut(),
                    CLSCTX_ALL,
                    &IID_VDM,
                    &mut raw as *mut Ctx as *mut *mut std::ffi::c_void,
                );
                if hr < 0 || raw.is_null() {
                    eprintln!("[kiosk] virtual-desktop containment unavailable (COM {hr}) — desktop switches are detected + punished only");
                    return None;
                }
                Some(Vdm(raw))
            }
        }

        fn ok(hr: i32) -> bool {
            hr >= 0
        }

        pub fn is_on_current_desktop(&self, hwnd: isize) -> Option<bool> {
            unsafe {
                let f: Slot3 = std::mem::transmute(vslot(self.0, 3));
                let mut out: i32 = 0;
                let hr = f(self.0, hwnd as Hwnd, &mut out);
                if Self::ok(hr) {
                    Some(out != 0)
                } else {
                    None
                }
            }
        }

        pub fn desktop_of(&self, hwnd: isize) -> Option<GUID> {
            unsafe {
                let f: Slot4 = std::mem::transmute(vslot(self.0, 4));
                let mut guid = GUID::from_u128(0);
                let hr = f(self.0, hwnd as Hwnd, &mut guid);
                if Self::ok(hr) {
                    Some(guid)
                } else {
                    None
                }
            }
        }

        pub fn move_to(&self, hwnd: isize, desktop: &GUID) -> bool {
            unsafe {
                let f: Slot5 = std::mem::transmute(vslot(self.0, 5));
                Self::ok(f(self.0, hwnd as Hwnd, desktop))
            }
        }
    }
}

/// Wired into the Tauri Builder via `on_window_event` (lib.rs).
pub fn on_window_event<R: tauri::Runtime>(window: &tauri::Window<R>, event: &WindowEvent) {
    match event {
        // Alt+F4 / close button / taskbar-close: ignored while the exam holds
        // the window. This is the second layer — the LL hook (lockdown.rs)
        // already swallows the Alt+F4 keystroke while active.
        WindowEvent::CloseRequested { api, .. } if is_active() => {
            api.prevent_close();
        }
        // Focus lost while active (e.g. Ctrl+Alt+Del overlay, taskbar click
        // on a second monitor — the paths a user-mode hook cannot close):
        // record it AND yank the exam window back to the front best-effort.
        // Windows may deny the steal (foreground lock) — the emitted event
        // lets the frontend toast + the server pause/flag regardless.
        WindowEvent::Focused(false) if is_active() => {
            // Cooldown: ignore repeats (DevTools focus fight, overlay jitter).
            if claim_violation_slot() {
                return;
            }
            let _ = window.set_always_on_top(true);
            let _ = window.set_fullscreen(true);
            let _ = window.set_focus();
            let _ = window.emit(
                "security-violation",
                SecurityViolation { kind: "focus-lost" },
            );
        }
        _ => {}
    }
}

#[tauri::command]
pub fn kiosk_enter(window: WebviewWindow) -> Result<(), String> {
    ACTIVE.store(true, Ordering::SeqCst);
    eprintln!("[kiosk] enter — window lockdown active");
    let _ = window.set_decorations(false);
    let _ = window.set_always_on_top(true);
    // Window-level fullscreen: Esc has nothing to exit — the compositor
    // owns the state, not the webview's HTML fullscreen API.
    let _ = window.set_fullscreen(true);
    let _ = window.set_focus();
    #[cfg(target_os = "windows")]
    if let Ok(hwnd) = window.hwnd() {
        KIOSK_HWND.store(hwnd.0 as isize, Ordering::SeqCst);
    }
    // OS key lockdown: Alt+Tab / Win key / GNOME keybindings (lockdown.rs),
    // then the shell + registry layers (SEB Layers 2 and 4).
    crate::lockdown::engage(&window);
    layers_enter();
    #[cfg(target_os = "windows")]
    ensure_watchdog(window);
    Ok(())
}

#[tauri::command]
pub fn kiosk_exit(window: WebviewWindow) -> Result<(), String> {
    ACTIVE.store(false, Ordering::SeqCst);
    eprintln!("[kiosk] exit — window lockdown released");
    crate::lockdown::release();
    layers_exit();
    let _ = window.set_fullscreen(false);
    let _ = window.set_always_on_top(false);
    let _ = window.set_decorations(true);
    Ok(())
}

/// Called once from lib.rs setup: repair whatever a previous crash left
/// behind (dead Explorer shell, applied registry policy) BEFORE the UI is
/// usable. This is the crash-safety SEB gets from its Windows Service.
pub fn selfheal_after_launch() {
    #[cfg(target_os = "windows")]
    {
        crate::shell_lockdown::selfheal();
        crate::registry_lockdown::auto_restore_if_pending();
    }
}
