//! HKCU policy lockdown — SEB's "Layer 4" (their FeatureConfigurations).
//!
//! Ctrl+Alt+Del is a Secure Attention Sequence that no user-mode code can
//! swallow — Safe Exam Browser doesn't block it either: it *empties* the
//! security screen by writing user-hive policy values (no admin needed),
//! backing up the originals first, re-applying anything cleared mid-exam,
//! and restoring on exit. We mirror that design exactly:
//!
//!   DisableTaskMgr         → "Task Manager" on the security screen dies
//!   DisableLockWorkstation → "Lock" dies
//!   DisableChangePassword  → "Change a password" dies
//!   HideFastUserSwitching  → "Switch user" dies
//!   NoClose                → "Shut down" leaves Start / power menus
//!
//! The backup lives in HKCU under our own key (`Software\SbyteIbt\...`), not
//! in process memory — so if the app crashes mid-exam, the next launch finds
//! the backup and repairs the machine (`auto_restore_if_pending`, called
//! from lib.rs setup). This is the crash-safety SEB gets from its Windows
//! Service, approximated without elevation.
#![cfg(target_os = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};

use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteKeyW, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW,
    RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_BINARY, REG_DWORD,
};

/// True between a successful `enter()` and `exit()` — status reporting only.
static ENFORCING: AtomicBool = AtomicBool::new(false);

/// Where pre-exam values are stashed (HKCU). Presence of this key after a
/// launch means the previous session ended uncleanly and a restore is due.
const BACKUP_SUBKEY: &str = "Software\\SbyteIbt\\KioskPolicyBackup";

const POLICY_SYSTEM: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System";
const POLICY_EXPLORER: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer";

struct PolicyItem {
    subkey: &'static str,
    name: &'static str,
}

/// The user-hive set from SEB's registry configurations (TaskManager,
/// LockWorkstation, ChangePassword — all under `Policies\System` in their
/// source; HideFastUserSwitching/NoClose under `Policies\Explorer`).
/// All are REG_DWORD policy values.
const ITEMS: &[PolicyItem] = &[
    PolicyItem {
        subkey: POLICY_SYSTEM,
        name: "DisableTaskMgr",
    },
    PolicyItem {
        subkey: POLICY_SYSTEM,
        name: "DisableLockWorkstation",
    },
    PolicyItem {
        subkey: POLICY_SYSTEM,
        name: "DisableChangePassword",
    },
    PolicyItem {
        subkey: POLICY_EXPLORER,
        name: "HideFastUserSwitching",
    },
    PolicyItem {
        subkey: POLICY_EXPLORER,
        name: "NoClose",
    },
];

const ERROR_SUCCESS: u32 = 0;

pub fn is_enforced() -> bool {
    ENFORCING.load(Ordering::SeqCst)
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Open a key under HKCU; None when absent (or unreadable).
fn open(subkey: &str, sam: u32) -> Option<HKEY> {
    let w = wide(subkey);
    let mut h: HKEY = std::ptr::null_mut();
    // SAFETY: all pointers valid for the call; HKEY out-param is ours.
    let rc = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            w.as_ptr(),
            0,
            sam,
            &mut h as *mut HKEY as *mut *mut std::ffi::c_void,
        )
    };
    if rc == ERROR_SUCCESS {
        Some(h)
    } else {
        None
    }
}

/// Create (or open) a key under HKCU for writing.
fn create(subkey: &str, sam: u32) -> Option<HKEY> {
    let w = wide(subkey);
    let mut h: HKEY = std::ptr::null_mut();
    // SAFETY: as above; security attributes null → inherit defaults.
    let rc = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            w.as_ptr(),
            0,
            std::ptr::null(),
            0,
            sam,
            std::ptr::null(),
            &mut h as *mut HKEY as *mut *mut std::ffi::c_void,
            std::ptr::null_mut(),
        )
    };
    if rc == ERROR_SUCCESS {
        Some(h)
    } else {
        None
    }
}

fn close(h: HKEY) {
    // SAFETY: h came from a successful open/create.
    unsafe { RegCloseKey(h) };
}

/// Read a REG_DWORD value; None if missing or a different type.
fn query_dword(h: HKEY, name: &str) -> Option<u32> {
    let w = wide(name);
    let mut ty: u32 = 0;
    let mut data: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    // SAFETY: name is a valid wide string; data buffer is 4 bytes and size
    // tells the OS exactly that.
    let rc = unsafe {
        RegQueryValueExW(
            h,
            w.as_ptr(),
            std::ptr::null(),
            &mut ty,
            &mut data as *mut u32 as *mut u8,
            &mut size,
        )
    };
    if rc == ERROR_SUCCESS && ty == REG_DWORD {
        Some(data)
    } else {
        None
    }
}

/// Read a value of any type (for the backup): (type, raw bytes).
fn query_raw(h: HKEY, name: &str) -> Option<(u32, Vec<u8>)> {
    let w = wide(name);
    let mut ty: u32 = 0;
    let mut size: u32 = 0;
    // SAFETY: null data → the call reports the required size.
    let rc = unsafe {
        RegQueryValueExW(
            h,
            w.as_ptr(),
            std::ptr::null(),
            &mut ty,
            std::ptr::null_mut(),
            &mut size,
        )
    };
    if rc != ERROR_SUCCESS || size == 0 || size > 4096 {
        return None;
    }
    let mut buf = vec![0u8; size as usize];
    let mut size2 = size;
    // SAFETY: buf has `size` bytes; size2 starts as its capacity.
    let rc = unsafe {
        RegQueryValueExW(
            h,
            w.as_ptr(),
            std::ptr::null(),
            &mut ty,
            buf.as_mut_ptr(),
            &mut size2,
        )
    };
    if rc == ERROR_SUCCESS {
        buf.truncate(size2 as usize);
        Some((ty, buf))
    } else {
        None
    }
}

fn set_dword(h: HKEY, name: &str, value: u32) {
    let w = wide(name);
    // SAFETY: value lives for the whole call.
    unsafe {
        RegSetValueExW(
            h,
            w.as_ptr(),
            0,
            REG_DWORD,
            &value as *const u32 as *const u8,
            std::mem::size_of::<u32>() as u32,
        );
    };
}

fn set_raw(h: HKEY, name: &str, ty: u32, data: &[u8]) {
    let w = wide(name);
    // SAFETY: data slice is valid for its length.
    unsafe {
        RegSetValueExW(h, w.as_ptr(), 0, ty, data.as_ptr(), data.len() as u32);
    };
}

fn delete_value(h: HKEY, name: &str) {
    let w = wide(name);
    // SAFETY: valid wide name; failure (already absent) is fine.
    unsafe { RegDeleteValueW(h, w.as_ptr()) };
}

/// Back up every policy value, then write the kiosk values.
pub fn enter() {
    // Idempotence guard: a second enter while already enforcing must NOT
    // re-read the current values — they are our own policy values by then,
    // and backing those up as "originals" would restore them permanently.
    if is_enforced() {
        return;
    }
    let Some(backup) = create(BACKUP_SUBKEY, KEY_READ | KEY_WRITE) else {
        eprintln!("[kiosk] registry policy NOT engaged — cannot create backup key");
        return;
    };
    for (i, item) in ITEMS.iter().enumerate() {
        // Policies\Explorer / Policies\System exist on every Windows box;
        // if one doesn't, skip that item rather than fail the whole set.
        let Some(target) = open(item.subkey, KEY_READ | KEY_WRITE) else {
            eprintln!("[kiosk] registry: policy key missing, skipping {}", item.name);
            continue;
        };
        match query_raw(target, item.name) {
            Some((ty, data)) => {
                set_dword(backup, &format!("{i}_existed"), 1);
                set_dword(backup, &format!("{i}_type"), ty);
                set_raw(backup, &format!("{i}_data"), REG_BINARY, &data);
            }
            None => set_dword(backup, &format!("{i}_existed"), 0),
        }
        set_dword(target, item.name, 1);
        close(target);
    }
    close(backup);
    ENFORCING.store(true, Ordering::SeqCst);
    eprintln!("[kiosk] registry policy engaged — Task Manager / Lock / Change password / Switch user / Shut down disabled (HKCU, no admin)");
}

/// Re-apply any policy value cleared mid-exam (SEB's monitor thread idea).
/// Called by the kiosk watchdog every ~2s while active.
pub fn reapply_if_tampered() {
    if !is_enforced() {
        return;
    }
    let mut fixed: Vec<&str> = Vec::new();
    for item in ITEMS {
        if let Some(h) = open(item.subkey, KEY_READ | KEY_WRITE) {
            if query_dword(h, item.name) != Some(1) {
                set_dword(h, item.name, 1);
                fixed.push(item.name);
            }
            close(h);
        }
    }
    if !fixed.is_empty() {
        eprintln!(
            "[kiosk] registry policy re-applied (cleared mid-exam): {}",
            fixed.join(", ")
        );
    }
}

/// Restore the backed-up originals (or delete values that didn't exist),
/// then drop the backup key so a later crash can't trigger a stale restore.
fn restore() {
    let Some(backup) = open(BACKUP_SUBKEY, KEY_READ | KEY_WRITE) else {
        ENFORCING.store(false, Ordering::SeqCst);
        return;
    };
    let mut restored: Vec<&str> = Vec::new();
    for (i, item) in ITEMS.iter().enumerate() {
        let existed = query_dword(backup, &format!("{i}_existed")).unwrap_or(0);
        let Some(target) = open(item.subkey, KEY_READ | KEY_WRITE) else {
            continue;
        };
        if existed == 1 {
            let ty = query_dword(backup, &format!("{i}_type")).unwrap_or(REG_DWORD);
            match query_raw(backup, &format!("{i}_data")) {
                Some((_, data)) => set_raw(target, item.name, ty, &data),
                None => delete_value(target, item.name),
            }
            restored.push(item.name);
        } else {
            delete_value(target, item.name);
        }
        close(target);
    }
    close(backup);
    let bw = wide(BACKUP_SUBKEY);
    // SAFETY: valid subkey path; deleting our own backup key.
    unsafe { RegDeleteKeyW(HKEY_CURRENT_USER, bw.as_ptr()) };
    ENFORCING.store(false, Ordering::SeqCst);
    eprintln!(
        "[kiosk] registry policy restored to pre-exam state ({})",
        if restored.is_empty() {
            "no values had been set".to_string()
        } else {
            restored.join(", ")
        }
    );
}

/// Called on kiosk exit (ResultPage) and on emergency exit.
pub fn exit() {
    restore();
}

/// Called once at app launch (lib.rs setup). If the backup key survived,
/// the previous session crashed mid-exam — put the machine back right now,
/// before anything else runs. Without this, a crash would leave Task
/// Manager disabled and Shutdown hidden until someone edits the registry.
pub fn auto_restore_if_pending() {
    if open(BACKUP_SUBKEY, KEY_READ).is_none() {
        return;
    }
    // Only treat it as a pending restore once at least one marker exists
    // (guards the microsecond window between key creation and first write).
    if let Some(backup) = open(BACKUP_SUBKEY, KEY_READ) {
        let pending = (0..ITEMS.len()).any(|i| query_dword(backup, &format!("{i}_existed")).is_some());
        close(backup);
        if pending {
            eprintln!("[kiosk] previous session ended uncleanly — restoring registry policy from backup");
            restore();
        }
    }
}
