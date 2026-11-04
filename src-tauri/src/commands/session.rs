//! 报告占用登记。
//!
//! 一份报告同时只能在一个窗口打开 —— 否则两个窗口各自持有一份文档副本，
//! 谁后保存谁覆盖，`agent/conversation.json` 也会互相覆盖。
//!
//! 为什么放在 Rust：前端的各个 webview 互相看不见，无法协作；
//! Rust 侧是进程内共享的，且随进程退出自动清空，不会像锁文件那样在崩溃后留死锁。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

/// reportId → window label
fn registry() -> &'static Mutex<HashMap<String, String>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock() -> std::sync::MutexGuard<'static, HashMap<String, String>> {
    // 中毒也继续用：这里面只是（id → 窗口）的映射，没有需要保持一致性的半状态
    registry().lock().unwrap_or_else(|error| error.into_inner())
}

/// 占用结果
#[derive(Serialize)]
pub struct ClaimResult {
    /// 是否成功占上
    pub claimed: bool,
    /// 已被谁占用（被别的窗口占着时有值）
    pub owner: Option<String>,
}

/// 尝试占用一份报告。已被其它窗口占用时返回 `claimed = false` 和占用者。
#[tauri::command]
pub fn claim_report(report_id: String, window_label: String) -> ClaimResult {
    let mut map = lock();
    match map.get(&report_id) {
        Some(owner) if owner != &window_label => ClaimResult {
            claimed: false,
            owner: Some(owner.clone()),
        },
        _ => {
            map.insert(report_id, window_label);
            ClaimResult {
                claimed: true,
                owner: None,
            }
        }
    }
}

/// 释放占用（切到别的报告、关闭报告时调用）
#[tauri::command]
pub fn release_report(report_id: String) {
    lock().remove(&report_id);
}

/// 窗口关闭时清掉它占用的所有报告
#[tauri::command]
pub fn release_reports_for_window(window_label: String) {
    lock().retain(|_, owner| owner != &window_label);
}

/// 当前被占用的报告清单：界面用它把"已被打开"的条目标灰
#[tauri::command]
pub fn list_claims() -> HashMap<String, String> {
    lock().clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 不同窗口抢同一份报告：第二个抢不到，且能拿到占用者
    #[test]
    fn second_window_cannot_claim_same_report() {
        let id = "test-conflict";
        let first = claim_report(id.into(), "main".into());
        assert!(first.claimed);

        let second = claim_report(id.into(), "report-2".into());
        assert!(!second.claimed);
        assert_eq!(second.owner.as_deref(), Some("main"));

        // 同一窗口重复占用是幂等的
        let again = claim_report(id.into(), "main".into());
        assert!(again.claimed);

        release_report(id.into());
        assert!(claim_report(id.into(), "report-2".into()).claimed);
        release_report(id.into());
    }

    /// 关窗口时把它占的都释放掉
    #[test]
    fn closing_window_releases_its_reports() {
        claim_report("test-a".into(), "report-9".into());
        claim_report("test-b".into(), "report-9".into());
        release_reports_for_window("report-9".into());
        assert!(!list_claims().contains_key("test-a"));
        assert!(!list_claims().contains_key("test-b"));
    }
}
