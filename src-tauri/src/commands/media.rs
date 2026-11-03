//! 媒体文件相关命令。
//!
//! 为什么放在 Rust 而不是前端：
//! 1. 用户选的文件在数据目录之外，fs 插件没有那个 scope，前端读不了；
//! 2. 大文件不必经过 IPC 传字节，慢；
//! 3. 顺手就能算 hash（前端要用 crypto.subtle，还得先把整个文件读进内存）。

use std::path::Path;

use sha2::{Digest, Sha256};

use crate::base64;
use crate::path::resolve;

/// 允许导入的媒体扩展名；不认识的按 png 处理（浏览器能嗅探出真实类型）
const MEDIA_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

/// 把外部文件复制进报告目录的 `media/`，文件名是内容 hash，天然去重。
///
/// `dir` 是报告目录的**绝对路径**（自定义数据目录接进来之后不能再假设它相对 APPDATA）。
#[tauri::command]
pub fn import_media(dir: String, source: String) -> Result<String, String> {
    if dir.trim().is_empty() {
        return Err("报告目录为空".into());
    }
    let media_dir = Path::new(&dir).join("media");
    std::fs::create_dir_all(&media_dir).map_err(|error| error.to_string())?;

    let bytes = std::fs::read(&source).map_err(|error| error.to_string())?;
    if bytes.is_empty() {
        return Err("文件是空的".into());
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
        .filter(|value| MEDIA_EXTENSIONS.contains(&value.as_str()))
        .unwrap_or_else(|| "png".to_string());

    let file_name = format!("{hash}.{extension}");
    let target = media_dir.join(&file_name);

    // 已有同名文件说明内容重复，直接复用，不再写一遍
    if !target.exists() {
        // 先写临时文件再改名：写一半崩掉不会留下半个文件
        let temp = media_dir.join(format!("{file_name}.tmp"));
        std::fs::write(&temp, &bytes).map_err(|error| error.to_string())?;
        std::fs::rename(&temp, &target).map_err(|error| error.to_string())?;
    }

    Ok(file_name)
}

/// 读媒体文件并转成 data URL。
///
/// 画布上显示图片要在 webview 里拿到位图，而自定义数据目录里的文件
/// webview 是访问不到的（没有 asset 协议、也不在 fs scope 里），
/// 所以统一由 Rust 读出来编码成 data URL 交给前端。
#[tauri::command]
pub fn read_media_data_url(root: String, relative: String) -> Result<String, String> {
    let path = resolve(&root, &relative)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("读取文件失败：{e}"))?;
    let mime = match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        _ => "image/png",
    };
    Ok(format!("data:{};base64,{}", mime, base64::encode(&bytes)))
}
