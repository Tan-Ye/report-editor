//! 版本更新检查。
//!
//! 只做"问一下 GitHub 最新 release 是哪个版本"，不做下载安装 ——
//! 自动更新要签名密钥和 latest.json，那是另一套基础设施；这里先解决
//! "用户怎么知道有新版本"。

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

/// 仓库地址：写在代码里而不是配置里，免得用户填错
const RELEASE_API: &str = "https://api.github.com/repos/Tan-Ye/report-editor/releases/latest";
const REQUEST_TIMEOUT_SECS: u64 = 15;

#[derive(Serialize)]
pub struct LatestRelease {
    /// 版本号，去掉前导 v：`v0.2.0` → `0.2.0`
    pub version: String,
    /// 发布页地址，用户点"去下载"就用它
    pub url: String,
    /// 更新说明（Markdown 原文，界面上原样展示）
    pub notes: String,
    pub published_at: String,
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
    })
}
