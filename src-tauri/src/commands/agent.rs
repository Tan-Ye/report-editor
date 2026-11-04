//! 大模型调用。
//!
//! 为什么网络请求放在 Rust：webview 里直接 `fetch` 会被 CORS 拦，
//! 而用户会自己填自定义 baseURL（DeepSeek / 通义 / 本地 Ollama 都可能），
//! `tauri-plugin-http` 那种编译期 scope 又写不死，所以自己写一个命令转发。
//!
//! 协议只认 **OpenAI 兼容格式**（`POST {base_url}/chat/completions`）：
//! 这是目前的事实标准，DeepSeek、通义、Kimi、Ollama 都支持。
//!
//! 这里只做"把请求发出去、把 JSON 拿回来"，不解读工具调用、不拼消息 ——
//! 那些是前端 agent 循环的事。

use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

/// 单次请求超时。推理型模型响应慢，比一般接口给得宽一些
const REQUEST_TIMEOUT_SECS: u64 = 120;

/// 错误里最多回显多少字符的响应体（避免把整页 HTML 错误页塞进 toast）
const MAX_ERROR_BODY: usize = 300;

/// agent 面板填的调用参数
///
/// ⚠️ `rename_all = "camelCase"` 不能省：前端按 JS 习惯传 `baseUrl` / `apiKey`，
/// 而 Tauri 的自动改名只作用于**命令参数名**，不会深入结构体字段。
/// 少了它，请求会在反序列化阶段就因为「missing field `base_url`」失败。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    /// 接口根地址，例如 `https://api.deepseek.com`；结尾带不带斜杠都行
    pub base_url: String,
    /// API Key。本地模型（Ollama / vLLM）通常不校验，留空就不发 Authorization
    #[serde(default)]
    pub api_key: String,
    /// 模型名，例如 `deepseek-chat`
    pub model: String,
    /// 完整的 OpenAI 格式 messages 数组，原样透传
    pub messages: Value,
    /// OpenAI 格式的 tools 数组；不传就是普通对话
    #[serde(default)]
    pub tools: Option<Value>,
    #[serde(default)]
    pub temperature: Option<f64>,
}

/// 把用户填的根地址拼成 chat/completions 端点。
///
/// **不自作主张补 `/v1`**：带不带版本段由地址自己决定 —— DeepSeek 用
/// `https://api.deepseek.com`，OpenAI / Ollama 用 `https://…/v1`，
/// 这里只负责在末尾接上 `/chat/completions`。
fn chat_endpoint(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("接口地址为空".into());
    }
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err(format!("接口地址必须带 http(s):// 前缀：{trimmed}"));
    }
    if trimmed.ends_with("/chat/completions") {
        return Ok(trimmed.to_string());
    }
    Ok(format!("{trimmed}/chat/completions"))
}

/// 用户可以按不同习惯粘贴 Key：带引号、整段 "Bearer xxx"、前后空格。
/// 这里统一清洗 —— 少一类"看起来填了但就是 401"的问题。
fn normalize_api_key(raw: &str) -> String {
    let mut key = raw.trim().trim_matches('"').trim_matches('\'').trim().to_string();
    if key.len() > 7 && key[..7].eq_ignore_ascii_case("bearer ") {
        key = key[7..].trim().to_string();
    }
    key
}

/// 把 Key 打码后再回显：能看出"发的是哪个 key"，但不泄露完整内容。
fn mask_api_key(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.is_empty() {
        return "（空）".into();
    }
    if chars.len() <= 8 {
        return format!("（长度 {}）", chars.len());
    }
    let head: String = chars[..3].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}…{tail}（长度 {}）", chars.len())
}

/// 发一次对话请求，返回接口的原始 JSON。
///
/// 注意：**错误信息里绝不带 Authorization 头**，接口返回体也只截断回显。
#[tauri::command]
pub async fn llm_chat(request: ChatRequest) -> Result<Value, String> {
    let endpoint = chat_endpoint(&request.base_url)?;
    if request.model.trim().is_empty() {
        return Err("没有选择模型".into());
    }

    let mut body = json!({
        "model": request.model,
        "messages": request.messages,
        "stream": false,
    });
    if let Some(tools) = request.tools {
        body["tools"] = tools;
    }
    if let Some(temperature) = request.temperature {
        body["temperature"] = json!(temperature);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败：{error}"))?;

    // 有 Key 才发 Authorization：本地模型（Ollama 等）不校验，带了反而可能被拒
    let api_key = normalize_api_key(&request.api_key);
    let mut request_builder = client.post(&endpoint);
    if !api_key.is_empty() {
        request_builder = request_builder.bearer_auth(&api_key);
    }

    let response = request_builder
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                format!("请求超时（{REQUEST_TIMEOUT_SECS} 秒），模型可能过慢或网络不通")
            } else if error.is_connect() {
                format!("连不上 {endpoint}，检查接口地址和网络")
            } else {
                format!("请求失败：{error}")
            }
        })?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取响应失败：{error}"))?;

    if !status.is_success() {
        let brief: String = text.chars().take(MAX_ERROR_BODY).collect();
        // 401/403 十有八九是 Key 的问题，把"实际发出去的 Key"打码回显，
        // 一眼能看出是空、是另一个服务商的、还是粘贴时带了前缀
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err(format!(
                "接口返回 {status}：{brief}\n本次发送的 Key：{}",
                mask_api_key(&api_key)
            ));
        }
        return Err(format!("接口返回 {status}：{brief}"));
    }

    serde_json::from_str::<Value>(&text).map_err(|error| {
        let brief: String = text.chars().take(MAX_ERROR_BODY).collect();
        format!("响应不是合法 JSON（{error}）：{brief}")
    })
}

#[cfg(test)]
mod tests {
    use super::{chat_endpoint, mask_api_key, normalize_api_key, ChatRequest};

    /// 前端传来的是 camelCase（baseUrl / apiKey）：Tauri 的自动改名只作用于
    /// 命令参数名，不会深入嵌套结构体，所以这里必须有 rename_all 兜住。
    /// 少了它，请求会在反序列化阶段就因为「missing field base_url」失败。
    #[test]
    fn accepts_camel_case_payload() {
        let payload = serde_json::json!({
            "baseUrl": "https://api.deepseek.com",
            "apiKey": "sk-test",
            "model": "deepseek-chat",
            "messages": [{ "role": "user", "content": "hi" }],
        });
        let parsed: ChatRequest =
            serde_json::from_value(payload).expect("camelCase 参数应该能解析");
        assert_eq!(parsed.base_url, "https://api.deepseek.com");
        assert_eq!(parsed.api_key, "sk-test");
    }

    /// 根地址后面只接 `/chat/completions`，不补 `/v1`：
    /// 版本段由地址自己带（DeepSeek 不带、OpenAI 带 `/v1`）
    #[test]
    fn appends_chat_endpoint_only() {
        assert_eq!(
            chat_endpoint("https://api.deepseek.com").unwrap(),
            "https://api.deepseek.com/chat/completions"
        );
        // 结尾多余的斜杠要去掉
        assert_eq!(
            chat_endpoint("https://api.deepseek.com/").unwrap(),
            "https://api.deepseek.com/chat/completions"
        );
        // 带版本段的地址原样保留
        assert_eq!(
            chat_endpoint("https://api.openai.com/v1").unwrap(),
            "https://api.openai.com/v1/chat/completions"
        );
    }

    /// 已经是完整端点时原样返回
    #[test]
    fn keeps_complete_endpoint() {
        assert_eq!(
            chat_endpoint("https://x.dev/v1/chat/completions").unwrap(),
            "https://x.dev/v1/chat/completions"
        );
    }

    /// 空白地址、缺协议头的地址都要报错
    #[test]
    fn rejects_invalid_url() {
        assert!(chat_endpoint("  ").is_err());
        assert!(chat_endpoint("api.deepseek.com").is_err());
    }

    /// 粘贴习惯容错：引号、Bearer 前缀、空格都要清掉
    #[test]
    fn normalizes_pasted_key() {
        assert_eq!(normalize_api_key("  sk-abc  "), "sk-abc");
        assert_eq!(normalize_api_key("\"sk-abc\""), "sk-abc");
        assert_eq!(normalize_api_key("Bearer sk-abc"), "sk-abc");
        assert_eq!(normalize_api_key("bearer   sk-abc"), "sk-abc");
    }

    /// 打码只露首三尾四，避免日志/提示里出现完整 Key
    #[test]
    fn masks_key_for_error_message() {
        assert_eq!(mask_api_key(""), "（空）");
        assert_eq!(mask_api_key("short"), "（长度 5）");
        assert_eq!(mask_api_key("sk-1234567890abcd"), "sk-…abcd（长度 17）");
    }
}
