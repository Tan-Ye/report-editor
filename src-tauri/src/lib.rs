// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use sha2::{Digest, Sha256};
use std::path::Path;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 允许导入的图片扩展名；不认识的按 png 处理（浏览器能嗅探出真实类型）
const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

/// 把外部图片复制进报告目录的 `media/`，文件名是内容 hash，天然去重。
///
/// 为什么放在 Rust 而不是前端：
/// 1. 用户选的图片在 APPDATA 之外，fs 插件没有那个 scope，前端读不了；
/// 2. 大文件不必经过 IPC 传字节，慢；
/// 3. 顺手就能算 hash（前端要用 crypto.subtle，还得先把整个文件读进内存）。
///
/// `dir` 是相对应用数据目录的报告目录，例如 `data/未命名报告-8f3a…`。
#[tauri::command]
fn import_media(app: tauri::AppHandle, dir: String, source: String) -> Result<String, String> {
    let root = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let media_dir = root.join(&dir).join("media");
    std::fs::create_dir_all(&media_dir).map_err(|error| error.to_string())?;

    let bytes = std::fs::read(&source).map_err(|error| error.to_string())?;
    if bytes.is_empty() {
        return Err("图片是空文件".into());
    }

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    // 取前 8 字节（16 个十六进制字符）够用：同一个报告里撞车的概率可以忽略
    let hash: String = hasher
        .finalize()
        .iter()
        .take(8)
        .map(|byte| format!("{:02x}", byte))
        .collect();

    let extension = Path::new(&source)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_lowercase())
        .filter(|value| IMAGE_EXTENSIONS.contains(&value.as_str()))
        .unwrap_or_else(|| "png".to_string());

    let file_name = format!("{hash}.{extension}");
    let target = media_dir.join(&file_name);

    // 已有同名文件说明内容重复，直接复用，不再写一遍
    if !target.exists() {
        // 先写临时文件再改名：写一半崩掉不会留下半个图片文件
        let temp = media_dir.join(format!("{file_name}.tmp"));
        std::fs::write(&temp, &bytes).map_err(|error| error.to_string())?;
        std::fs::rename(&temp, &target).map_err(|error| error.to_string())?;
    }

    Ok(file_name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![greet, import_media])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
