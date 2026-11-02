// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
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
/// 1. 用户选的图片在数据目录之外，fs 插件没有那个 scope，前端读不了；
/// 2. 大文件不必经过 IPC 传字节，慢；
/// 3. 顺手就能算 hash（前端要用 crypto.subtle，还得先把整个文件读进内存）。
///
/// `dir` 是报告目录的**绝对路径**（自定义数据目录接进来之后不能再假设它相对 APPDATA）。
#[tauri::command]
fn import_media(dir: String, source: String) -> Result<String, String> {
    if dir.trim().is_empty() {
        return Err("报告目录为空".into());
    }
    let media_dir = Path::new(&dir).join("media");
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

// ---------------------------------------------------------------------------
// 报告存储
//
// 为什么不走 fs 插件：它的 scope 是编译期写死的（现在只放了 `$APPDATA/**`），
// 用户「自定义数据目录」选到 D 盘就读不了了，而 Tauri 不支持运行时扩 scope。
// 全部放到 Rust 里用 std::fs 直接操作，路径限制一次性消失，顺带少一层序列化。
//
// 约定：`root` 是绝对路径（数据目录），`relative` 是相对 root 的路径、
// 一律用 `/` 分隔（Rust 的 Path::join 在 Windows 上也能正确处理）。
// ---------------------------------------------------------------------------

/// 把 root + relative 拼成绝对路径，并挡掉路径穿越/绝对路径
fn resolve_path(root: &str, relative: &str) -> Result<PathBuf, String> {
    if root.trim().is_empty() {
        return Err("数据目录为空".into());
    }
    if relative.starts_with('/') || relative.starts_with('\\') || relative.contains(':') {
        return Err(format!("需要相对路径：{relative}"));
    }
    if relative.split(['/', '\\']).any(|segment| segment == "..") {
        return Err(format!("非法路径：{relative}"));
    }
    Ok(Path::new(root).join(relative))
}

/// 应用数据目录（内置数据目录的根）
#[tauri::command]
fn app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn storage_exists(root: String, relative: String) -> bool {
    resolve_path(&root, &relative)
        .map(|path| path.exists())
        .unwrap_or(false)
}

#[tauri::command]
fn storage_mkdirs(root: String, relative: String) -> Result<(), String> {
    let path = resolve_path(&root, &relative)?;
    std::fs::create_dir_all(&path).map_err(|e| format!("创建目录失败：{e}"))
}

#[tauri::command]
fn storage_read_text(root: String, relative: String) -> Result<String, String> {
    let path = resolve_path(&root, &relative)?;
    std::fs::read_to_string(&path).map_err(|e| format!("读取 {relative} 失败：{e}"))
}

/// 原子写：先写 `.tmp` 再 rename，写一半崩掉不会毁掉原文件
#[tauri::command]
fn storage_write_text(root: String, relative: String, content: String) -> Result<(), String> {
    let path = resolve_path(&root, &relative)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    // 注意不要用 with_extension：那会把 report.json 变成 report.tmp，
    // 不同文件会共用临时名，并发写时互相覆盖
    let temp = resolve_path(&root, &format!("{relative}.tmp"))?;
    std::fs::write(&temp, content).map_err(|e| format!("写入失败：{e}"))?;
    std::fs::rename(&temp, &path).map_err(|e| format!("重命名失败：{e}"))
}

/// 列出子目录名（只返回目录，不递归）
#[tauri::command]
fn storage_list_dirs(root: String, relative: String) -> Result<Vec<String>, String> {
    let path = resolve_path(&root, &relative)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let mut names = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| format!("列目录失败：{e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            names.push(entry.file_name().to_string_lossy().to_string());
        }
    }
    Ok(names)
}

/// 列出文件名（只返回文件，不递归）
#[tauri::command]
fn storage_list_files(root: String, relative: String) -> Result<Vec<String>, String> {
    let path = resolve_path(&root, &relative)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let mut names = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| format!("列目录失败：{e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            names.push(entry.file_name().to_string_lossy().to_string());
        }
    }
    Ok(names)
}

/// 目录改名（报告改名时同步目录名）
#[tauri::command]
fn storage_rename(root: String, from: String, to: String) -> Result<(), String> {
    let source = resolve_path(&root, &from)?;
    let target = resolve_path(&root, &to)?;
    std::fs::rename(&source, &target).map_err(|e| format!("改名失败：{e}"))
}

#[tauri::command]
fn storage_remove_dir(root: String, relative: String) -> Result<(), String> {
    let path = resolve_path(&root, &relative)?;
    if !path.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(&path).map_err(|e| format!("删除目录失败：{e}"))
}

#[tauri::command]
fn storage_remove_file(root: String, relative: String) -> Result<(), String> {
    let path = resolve_path(&root, &relative)?;
    if !path.exists() {
        return Ok(());
    }
    std::fs::remove_file(&path).map_err(|e| format!("删除文件失败：{e}"))
}

/// 文件最后修改时间（毫秒时间戳）
#[tauri::command]
fn storage_mtime(root: String, relative: String) -> Result<Option<u64>, String> {
    let path = resolve_path(&root, &relative)?;
    let metadata = match std::fs::metadata(&path) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    let modified = match metadata.modified() {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    let millis = modified
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    Ok(Some(millis))
}

/// 把 from 目录下的文件全部复制到 to 目录（保存草稿时搬 media 用）
#[tauri::command]
fn storage_copy_files(root: String, from: String, to: String) -> Result<(), String> {
    let source = resolve_path(&root, &from)?;
    if !source.exists() {
        return Ok(());
    }
    let target = resolve_path(&root, &to)?;
    std::fs::create_dir_all(&target).map_err(|e| format!("创建目录失败：{e}"))?;
    for entry in std::fs::read_dir(&source).map_err(|e| format!("列目录失败：{e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name();
        std::fs::copy(entry.path(), target.join(&name))
            .map_err(|e| format!("复制 {} 失败：{e}", name.to_string_lossy()))?;
    }
    Ok(())
}

/// 标准 base64 编码（自带，省一个依赖）
fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[(triple >> 18) as usize & 63] as char);
        out.push(TABLE[(triple >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(triple >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[triple as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// 读媒体文件并转成 data URL。
///
/// 画布上显示图片要在 webview 里拿到位图，而自定义数据目录里的文件
/// webview 是访问不到的（没有 asset 协议、也不在 fs scope 里），
/// 所以统一由 Rust 读出来编码成 data URL 交给前端。
#[tauri::command]
fn read_media_data_url(root: String, relative: String) -> Result<String, String> {
    let path = resolve_path(&root, &relative)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("读取图片失败：{e}"))?;
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
        _ => "image/png",
    };
    Ok(format!("data:{};base64,{}", mime, base64_encode(&bytes)))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            import_media,
            app_data_dir,
            storage_exists,
            storage_mkdirs,
            storage_read_text,
            storage_write_text,
            storage_list_dirs,
            storage_list_files,
            storage_rename,
            storage_remove_dir,
            storage_remove_file,
            storage_mtime,
            storage_copy_files,
            read_media_data_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
