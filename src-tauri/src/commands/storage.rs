//! 报告存储相关的命令。
//!
//! 为什么不走 fs 插件：它的 scope 是编译期写死的（只有 `$APPDATA/**`），
//! 用户「自定义数据目录」选到 D 盘就读不了了，而 Tauri 不支持运行时扩 scope。
//! 全部放到 Rust 里用 `std::fs` 直接操作，路径限制一次性消失。

use std::time::UNIX_EPOCH;

use tauri::Manager;

use crate::path::{ensure_parent, resolve};

/// 应用数据目录（内置数据目录的根）
#[tauri::command]
pub fn app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn storage_exists(root: String, relative: String) -> bool {
    resolve(&root, &relative)
        .map(|path| path.exists())
        .unwrap_or(false)
}

#[tauri::command]
pub fn storage_mkdirs(root: String, relative: String) -> Result<(), String> {
    let path = resolve(&root, &relative)?;
    std::fs::create_dir_all(&path).map_err(|e| format!("创建目录失败：{e}"))
}

#[tauri::command]
pub fn storage_read_text(root: String, relative: String) -> Result<String, String> {
    let path = resolve(&root, &relative)?;
    std::fs::read_to_string(&path).map_err(|e| format!("读取 {relative} 失败：{e}"))
}

/// 原子写：先写 `.tmp` 再 rename，写一半崩掉不会毁掉原文件
#[tauri::command]
pub fn storage_write_text(root: String, relative: String, content: String) -> Result<(), String> {
    let path = resolve(&root, &relative)?;
    ensure_parent(&path)?;
    // 注意不要用 with_extension：那会把 report.json 变成 report.tmp，
    // 不同文件会共用临时名，并发写时互相覆盖
    let temp = resolve(&root, &format!("{relative}.tmp"))?;
    std::fs::write(&temp, content).map_err(|e| format!("写入失败：{e}"))?;
    std::fs::rename(&temp, &path).map_err(|e| format!("重命名失败：{e}"))
}

/// 列出子目录名（只返回目录，不递归）
#[tauri::command]
pub fn storage_list_dirs(root: String, relative: String) -> Result<Vec<String>, String> {
    let path = resolve(&root, &relative)?;
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
pub fn storage_list_files(root: String, relative: String) -> Result<Vec<String>, String> {
    let path = resolve(&root, &relative)?;
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
pub fn storage_rename(root: String, from: String, to: String) -> Result<(), String> {
    let source = resolve(&root, &from)?;
    let target = resolve(&root, &to)?;
    std::fs::rename(&source, &target).map_err(|e| format!("改名失败：{e}"))
}

#[tauri::command]
pub fn storage_remove_dir(root: String, relative: String) -> Result<(), String> {
    let path = resolve(&root, &relative)?;
    if !path.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(&path).map_err(|e| format!("删除目录失败：{e}"))
}

#[tauri::command]
pub fn storage_remove_file(root: String, relative: String) -> Result<(), String> {
    let path = resolve(&root, &relative)?;
    if !path.exists() {
        return Ok(());
    }
    std::fs::remove_file(&path).map_err(|e| format!("删除文件失败：{e}"))
}

/// 文件最后修改时间（毫秒时间戳）
#[tauri::command]
pub fn storage_mtime(root: String, relative: String) -> Result<Option<u64>, String> {
    let path = resolve(&root, &relative)?;
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
pub fn storage_copy_files(root: String, from: String, to: String) -> Result<(), String> {
    let source = resolve(&root, &from)?;
    if !source.exists() {
        return Ok(());
    }
    let target = resolve(&root, &to)?;
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

/// 递归复制目录（跨盘迁移时 rename 会失败，用它兜底）
fn copy_dir_all(from: &std::path::Path, to: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| format!("创建目录失败：{e}"))?;
    for entry in std::fs::read_dir(from).map_err(|e| format!("列目录失败：{e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let target = to.join(entry.file_name());
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target).map_err(|e| format!("复制文件失败：{e}"))?;
        }
    }
    Ok(())
}

/// 把一份报告目录从一个数据目录搬到另一个数据目录（跨盘自动退化成复制+删除）
#[tauri::command]
pub fn storage_move_dir(
    from_root: String,
    from: String,
    to_root: String,
    to: String,
) -> Result<(), String> {
    let source = resolve(&from_root, &from)?;
    let target = resolve(&to_root, &to)?;
    if !source.exists() {
        return Err("要迁移的报告目录不存在".into());
    }
    if target.exists() {
        return Err("目标目录里已经有同名报告".into());
    }
    ensure_parent(&target)?;
    if std::fs::rename(&source, &target).is_ok() {
        return Ok(());
    }
    copy_dir_all(&source, &target)?;
    std::fs::remove_dir_all(&source).map_err(|e| format!("删除原目录失败：{e}"))?;
    Ok(())
}
