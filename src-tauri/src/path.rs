//! 数据目录里的相对路径解析。
//!
//! 约定：`root` 是绝对路径（数据目录），`relative` 是相对它的路径、
//! 一律用 `/` 分隔（`Path::join` 在 Windows 上也能正确处理 `/`）。

use std::path::{Path, PathBuf};

/// 把 root + relative 拼成绝对路径，并挡掉路径穿越与绝对路径片段。
///
/// `Path::join` 遇到绝对路径会**替换**掉 root，所以必须先把这种输入挡掉。
pub fn resolve(root: &str, relative: &str) -> Result<PathBuf, String> {
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

/// 确保目标文件的父目录存在
pub fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    Ok(())
}
