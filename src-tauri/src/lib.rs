// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
//!
//! 这里只放三件事：模块声明、示例命令 `greet`、以及 Tauri 应用装配。
//! 具体命令都在 `commands/` 下按职责分模块实现。

mod base64;
mod commands;
mod path;

use commands::{export, media, storage};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            // 存储
            storage::app_data_dir,
            storage::storage_exists,
            storage::storage_mkdirs,
            storage::storage_read_text,
            storage::storage_write_text,
            storage::storage_list_dirs,
            storage::storage_list_files,
            storage::storage_rename,
            storage::storage_remove_dir,
            storage::storage_remove_file,
            storage::storage_mtime,
            storage::storage_copy_files,
            storage::storage_move_dir,
            // 媒体
            media::import_media,
            media::read_media_data_url,
            // 导出
            export::write_file_base64,
            export::write_text_file,
            export::copy_file,
            export::export_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
