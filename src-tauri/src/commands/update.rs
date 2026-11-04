//! 版本更新检查、安装包下载与安装。
//!
//! 只和本仓库的 GitHub Release 打交道：检查 → 下载 NSIS 安装包到临时目录 →
//! 关掉应用并启动安装程序。不引 tauri-plugin-updater：那套要签名密钥和
//! `latest.json` 托管，这里是"手动更新"，用户点了才装。
//!
//! 安全约束（都能在单测里看到）：
//! - 下载地址必须是 `https://github.com/Tan-Ye/report-editor/releases/download/...`
//! - 文件名只允许 `[A-Za-z0-9._-]` 且以 `-setup.exe` 结尾，防止路径穿越
//! - 只从临时目录里运行安装包

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// 仓库地址：写在代码里而不是配置里，免得用户填错
const RELEASE_API: &str = "https://api.github.com/repos/Tan-Ye/report-editor/releases/latest";
const REPO_RELEASES_URL: &str = "https://github.com/Tan-Ye/report-editor/releases/";
const DOWNLOAD_PREFIX: &str = "https://github.com/Tan-Ye/report-editor/releases/download/";
const REQUEST_TIMEOUT_SECS: u64 = 15;
const DOWNLOAD_TIMEOUT_SECS: u64 = 120;
/// 安装包不可能这么大；超过就当下载地址有问题
const MAX_DOWNLOAD_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestRelease {
    /// 版本号，去掉前导 v：`v0.2.0` → `0.2.0`
    pub version: String,
    /// 发布页地址，用户点"打开发布页"就用它
    pub url: String,
    /// 更新说明（Markdown 原文，界面上原样展示）
    pub notes: String,
    pub published_at: String,
    /// 本次发布里附带的 Windows 安装包（没有就退化成打开发布页）
    pub download_url: Option<String>,
    pub download_name: Option<String>,
    pub download_size: Option<u64>,
}

/// 只认本仓库的 release 下载地址
fn is_trusted_download_url(url: &str) -> bool {
    url.starts_with(DOWNLOAD_PREFIX) && !url.contains(char::is_whitespace) && !url.contains("..")
}

/// 只认本仓库的发布页地址
fn is_trusted_page_url(url: &str) -> bool {
    url.starts_with(REPO_RELEASES_URL) && !url.contains(char::is_whitespace) && !url.contains("..")
}

/// 安装包文件名：不允许路径分隔符，只允许字母数字和 `._-`，必须以 `-setup.exe` 结尾
fn is_installer_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name.ends_with("-setup.exe")
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
}

/// 从 release 的 assets 里挑 Windows 安装包
fn pick_installer(assets: &[Value]) -> Option<(String, String, u64)> {
    assets.iter().find_map(|asset| {
        let name = asset.get("name")?.as_str()?;
        let url = asset.get("browser_download_url")?.as_str()?;
        if !is_installer_name(name) || !is_trusted_download_url(url) {
            return None;
        }
        let size = asset.get("size").and_then(Value::as_u64).unwrap_or(0);
        Some((name.to_string(), url.to_string(), size))
    })
}

/// 查询最新版本。网络失败/没发过 release 都会返回 Err，由界面提示。
#[tauri::command]
pub async fn check_latest_release() -> Result<LatestRelease, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败：{error}"))?;

    let response = client
        .get(RELEASE_API)
        // GitHub API 要求带 User-Agent，否则直接 403
        .header("User-Agent", "report-editor")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "检查更新超时，网络可能不通".to_string()
            } else {
                format!("检查更新失败：{error}")
            }
        })?;

    let status = response.status();
    if status.as_u16() == 404 {
        return Err("仓库还没有发布过版本".into());
    }
    if !status.is_success() {
        return Err(format!("GitHub 返回 {status}"));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("响应不是合法 JSON：{error}"))?;

    let tag = body
        .get("tag_name")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let url = body
        .get("html_url")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    if tag.is_empty() {
        return Err("响应里没有 tag_name".into());
    }

    let installer = body
        .get("assets")
        .and_then(|value| value.as_array())
        .and_then(|assets| pick_installer(assets));

    Ok(LatestRelease {
        version: tag.trim_start_matches('v').to_string(),
        url: url.to_string(),
        notes: body
            .get("body")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        published_at: body
            .get("published_at")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        download_url: installer.as_ref().map(|item| item.1.clone()),
        download_name: installer.as_ref().map(|item| item.0.clone()),
        download_size: installer.as_ref().map(|item| item.2),
    })
}

/// 下载安装包到临时目录，返回本地路径。装完由下次启动时的清理逻辑删掉。
#[tauri::command]
pub async fn download_update(url: String, file_name: String) -> Result<String, String> {
    if !is_trusted_download_url(&url) {
        return Err("下载地址不是本仓库的发布资源".into());
    }
    if !is_installer_name(&file_name) {
        return Err("安装包文件名不合法".into());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(DOWNLOAD_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败：{error}"))?;

    let response = client
        .get(&url)
        .header("User-Agent", "report-editor")
        .send()
        .await
        .map_err(|error| format!("下载失败：{error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("下载失败：GitHub 返回 {status}"));
    }
    let length = response.content_length().unwrap_or(0);
    if length > MAX_DOWNLOAD_BYTES {
        return Err("安装包体积异常，已停止下载".into());
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("读取安装包失败：{error}"))?;
    if bytes.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err("安装包体积异常，已停止下载".into());
    }

    let target = std::env::temp_dir().join(&file_name);
    // 上一次没装成功的残留先删掉；删不掉就让写入覆盖
    let _ = std::fs::remove_file(&target);
    std::fs::write(&target, &bytes).map_err(|error| format!("写入安装包失败：{error}"))?;

    Ok(target.to_string_lossy().to_string())
}

/// 启动安装程序，随后关掉当前应用，NSIS 才不会被"应用正在运行"挡住。
#[tauri::command]
pub async fn run_installer(app: AppHandle, path: String) -> Result<(), String> {
    let file = std::fs::canonicalize(&path).map_err(|_| "安装包不存在，请重新下载".to_string())?;
    let temp = std::fs::canonicalize(std::env::temp_dir())
        .map_err(|error| format!("定位临时目录失败：{error}"))?;
    if !file.starts_with(&temp) {
        return Err("只能运行临时目录里的安装包".into());
    }
    let name = file
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !is_installer_name(name) {
        return Err("安装包文件名不合法".into());
    }

    std::process::Command::new(&file)
        .spawn()
        .map_err(|error| format!("启动安装程序失败：{error}"))?;

    // 留一点时间让安装程序把界面拉起来，再退出应用
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(800));
        handle.exit(0);
    });

    Ok(())
}

/// 打开发布页（没有安装包时的兜底）
#[tauri::command]
pub fn open_release_page(app: AppHandle, url: String) -> Result<(), String> {
    if !is_trusted_page_url(&url) {
        return Err("只能打开发布页".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| format!("打开浏览器失败：{error}"))
}

/// 启动时清理上一次下载、但没装成功的安装包（装完就没用了）
pub fn cleanup_installers() {
    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if name.starts_with("report-editor_") && name.ends_with("-setup.exe") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_only_this_repo_download_urls() {
        assert!(is_trusted_download_url(
            "https://github.com/Tan-Ye/report-editor/releases/download/v0.2.1/report-editor_0.2.1_x64-setup.exe"
        ));
        assert!(!is_trusted_download_url(
            "https://github.com/other/report-editor/releases/download/v0.2.1/a-setup.exe"
        ));
        assert!(!is_trusted_download_url(
            "https://example.com/report-editor/releases/download/v0.2.1/a-setup.exe"
        ));
        assert!(!is_trusted_download_url(
            "https://github.com/Tan-Ye/report-editor/releases/download/../evil.exe"
        ));
    }

    #[test]
    fn validates_installer_names() {
        assert!(is_installer_name("report-editor_0.2.1_x64-setup.exe"));
        assert!(is_installer_name("a-setup.exe"));
        assert!(!is_installer_name("..\\evil-setup.exe"));
        assert!(!is_installer_name("report-editor_0.2.1_x64-setup.exe.bat"));
        assert!(!is_installer_name("setup.exe"));
        assert!(!is_installer_name(""));
    }

    #[test]
    fn picks_the_windows_installer_from_assets() {
        let assets = vec![
            json!({
                "name": "report-editor_0.2.1_x64-setup.exe.sig",
                "browser_download_url": "https://github.com/Tan-Ye/report-editor/releases/download/v0.2.1/report-editor_0.2.1_x64-setup.exe.sig",
                "size": 10
            }),
            json!({
                "name": "report-editor_0.2.1_x64-setup.exe",
                "browser_download_url": "https://github.com/Tan-Ye/report-editor/releases/download/v0.2.1/report-editor_0.2.1_x64-setup.exe",
                "size": 3456789
            }),
        ];
        let picked = pick_installer(&assets).expect("应该挑到 exe");
        assert_eq!(picked.0, "report-editor_0.2.1_x64-setup.exe");
        assert_eq!(picked.2, 3456789);
    }

    #[test]
    fn no_installer_means_fallback_to_page() {
        let assets = vec![json!({
            "name": "notes.txt",
            "browser_download_url": "https://example.com/a.txt"
        })];
        assert!(pick_installer(&assets).is_none());
    }
}
