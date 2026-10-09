//! Binary entry: delegates to the library so mobile/desktop share init.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    exam_client_lib::run();
}
