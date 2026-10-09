//! Shell lockdown — SEB's "Layer 2" ("Disable Explorer Shell" kiosk mode)
//! plus their `ExplorerShell.HideAllWindows` behavior.
//!
//! A keyboard hook can only race keystrokes; Start menu, taskbar, Task View,
//! the Alt+Tab switcher UI and the precision-touchpad gesture handlers all
//! *live inside explorer.exe*. Remove the shell and those escapes have
//! nothing left to open — this is what actually closes the Win-key,
//! Alt+Tab and 4-finger-swallow leaks, structurally instead of by racing.
//!
//! Mirrors SafeExamBrowser's ExplorerShell: minimize the candidate's other
//! windows, ask Explorer to close politely, wait, force-kill what remains;
//! on exit bring the windows back and start the shell again. Crash safety
//! (SEB gets this from its Windows Service) is approximated by `selfheal()`,
//! called at every app launch: if Explorer is missing, start it.
#![cfg(target_os = "windows")]

use std::sync::Mutex;
use std::time::Duration;

use windows_sys::core::BOOL;
use windows_sys::Win32::Foundation::{CloseHandle, HWND, INVALID_HANDLE_VALUE, LPARAM};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess};
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, PostMessageW,
    ShowWindow, SW_MINIMIZE, SW_RESTORE, WM_CLOSE,
};

/// Windows we minimized on kiosk enter, restored on exit. (HWNDs stay
/// valid across the exam; dead ones are skipped at restore time.)
static MINIMIZED: Mutex<Vec<isize>> = Mutex::new(Vec::new());

const PROCESS_TERMINATE: u32 = 0x0001;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// PIDs of every running explorer.exe (normally exactly one).
fn explorer_pids() -> Vec<u32> {
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return Vec::new();
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut pids = Vec::new();
        if Process32FirstW(snap, &mut entry) != 0 {
            loop {
                let name = String::from_utf16_lossy(
                    &entry.szExeFile[..entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(260)],
                );
                if name.eq_ignore_ascii_case("explorer.exe") {
                    pids.push(entry.th32ProcessID);
                }
                if Process32NextW(snap, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
        pids
    }
}

pub fn explorer_running() -> bool {
    !explorer_pids().is_empty()
}

/// Top-level visible windows not owned by us or by the shell (which is
/// about to die anyway) — the ones Alt+Tab could otherwise reach.
fn minimize_other_windows() {
    struct Ctx {
        our_pid: u32,
        found: Vec<isize>,
    }
    unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam as *mut Ctx);
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 || pid == ctx.our_pid {
            return 1; // skip ourselves (and the desktop window)
        }
        if IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 {
            return 1; // already hidden or minimized
        }
        ShowWindow(hwnd, SW_MINIMIZE);
        ctx.found.push(hwnd as isize);
        1
    }
    let mut ctx = Ctx {
        our_pid: std::process::id(),
        found: Vec::new(),
    };
    // SAFETY: cb only touches the ctx we pass in; EnumWindows owns no memory.
    unsafe { EnumWindows(Some(cb), &mut ctx as *mut Ctx as LPARAM) };
    let mut saved = MINIMIZED.lock().unwrap_or_else(|p| p.into_inner());
    let n = ctx.found.len();
    saved.extend(ctx.found);
    if n > 0 {
        eprintln!("[kiosk] shell lockdown: minimized {n} other window(s)");
    }
}

/// Ask every Explorer-owned top-level window to close, then force-kill the
/// shell process(es). `graceful` waits for the polite request first (enter
/// path — matches SEB); the monitor path kills outright.
fn kill_explorer(graceful: bool) {
    let pids = explorer_pids();
    if pids.is_empty() {
        return;
    }
    if graceful {
        let set: std::collections::HashSet<u32> = pids.iter().copied().collect();
        struct Ctx {
            pids: std::collections::HashSet<u32>,
        }
        unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let ctx = &*(lparam as *const Ctx);
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if ctx.pids.contains(&pid) && IsWindowVisible(hwnd) != 0 {
                PostMessageW(hwnd, WM_CLOSE, 0, 0);
            }
            1
        }
        let ctx = Ctx { pids: set };
        // SAFETY: cb reads only ctx; no memory owned across the call.
        unsafe { EnumWindows(Some(cb), &ctx as *const Ctx as LPARAM) };
        std::thread::sleep(Duration::from_millis(1000));
    }
    for pid in explorer_pids() {
        // SAFETY: OpenProcess/TerminateProcess are always callable; a null
        // handle (access denied) just means that instance survived — logged.
        unsafe {
            let h = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if !h.is_null() {
                TerminateProcess(h, 1);
                CloseHandle(h);
            } else {
                eprintln!("[kiosk] shell lockdown: cannot terminate explorer (pid {pid}) — access denied?");
            }
        }
    }
    if explorer_pids().is_empty() {
        eprintln!("[kiosk] shell lockdown: explorer.exe terminated — Start menu, taskbar, Task View and touchpad gestures are gone");
    } else {
        eprintln!("[kiosk] shell lockdown: explorer.exe still running after kill attempt");
    }
}

/// The monitor half (called by the kiosk watchdog ~every 2s): some systems
/// auto-restart Explorer or ship a replacement shell — keep it down.
pub fn kill_explorer_if_running() {
    if explorer_running() {
        eprintln!("[kiosk] shell lockdown: explorer came back — killing it again");
        kill_explorer(false);
    }
}

fn restart_explorer() {
    let file = wide("explorer.exe");
    // SAFETY: null params/directory are valid; HINSTANCE return is best-effort.
    let inst = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            wide("open").as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_RESTORE,
        )
    };
    if inst.is_null() {
        eprintln!("[kiosk] shell lockdown: failed to restart explorer.exe — start it manually");
    } else {
        eprintln!("[kiosk] shell lockdown: explorer.exe restarted — taskbar restored");
    }
}

/// Kiosk enter: shrink the room (SEB's HideAllWindows + Kill).
pub fn enter() {
    minimize_other_windows();
    kill_explorer(true);
}

/// Kiosk exit (ResultPage / emergency): put everything back.
pub fn exit() {
    let windows: Vec<isize> = MINIMIZED
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .drain(..)
        .collect();
    for h in windows {
        // SAFETY: stored HWND; IsWindow guards stale handles.
        unsafe {
            if IsWindow(h as HWND) != 0 {
                ShowWindow(h as HWND, SW_RESTORE);
            }
        }
    }
    if !explorer_running() {
        restart_explorer();
    }
}

/// Called once at app launch. If the previous session crashed mid-exam the
/// shell is still dead (no taskbar, no Start) — bring it back before the
/// UI shows. Registry repair is handled by registry_lockdown's own startup
/// hook; see kiosk::selfheal_after_launch().
pub fn selfheal() {
    if !explorer_running() {
        eprintln!("[kiosk] shell lockdown: explorer.exe not running at launch (unclean exit?) — restarting");
        restart_explorer();
    }
}
