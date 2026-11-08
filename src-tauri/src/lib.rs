// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
//!
//! 这里只放三件事：模块声明、示例命令 `greet`、以及 Tauri 应用装配。
//! 具体命令都在 `commands/` 下按职责分模块实现。

mod base64;
mod commands;
mod path;

use commands::{agent, export, media, session, storage, update};

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
        // 上次下载但没装成功的安装包，启动时清掉
        .setup(|_app| {
            update::cleanup_installers();
            Ok(())
        })
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
            storage::storage_report_summaries,
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
            // 大模型（agent）
            agent::llm_chat,
            // 报告占用：一份报告同时只能在一个窗口打开
            session::claim_report,
            session::release_report,
            session::release_reports_for_window,
            session::list_claims,
            // 版本检查 / 下载安装
            update::check_latest_release,
            update::download_update,
            update::run_installer,
            update::open_release_page,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
