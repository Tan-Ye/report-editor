//! Tauri 命令集合。
//!
//! 按职责分模块：`storage` 管数据目录，`media` 管媒体文件，`export` 管导出。
//! 新增命令时先想清楚属于哪一类，不要再往 `lib.rs` 里堆。

pub mod export;
pub mod media;
pub mod storage;
