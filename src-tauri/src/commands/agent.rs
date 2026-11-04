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
    /// 接口根地址，例如 `https://api.deepseek.com/v1`；结尾带不带斜杠都行
    pub base_url: String,
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
/// 允许用户填 `https://api.deepseek.com` 或 `https://api.deepseek.com/v1`
/// 两种写法：前者补 `/v1`，后者直接用。
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
    // 没写版本段时补 /v1：OpenAI 兼容端点基本都是这个约定
    let has_version = trimmed
        .rsplit('/')
        .next()
        .map(|segment| segment.starts_with('v') && segment[1..].chars().all(|c| c.is_ascii_digit()))
        .unwrap_or(false);
    if has_version {
        Ok(format!("{trimmed}/chat/completions"))
    } else {
        Ok(format!("{trimmed}/v1/chat/completions"))
    }
}

/// 发一次对话请求，返回接口的原始 JSON。
///
/// 注意：**错误信息里绝不带 Authorization 头**，接口返回体也只截断回显。
#[tauri::command]
pub async fn llm_chat(request: ChatRequest) -> Result<Value, String> {
    let endpoint = chat_endpoint(&request.base_url)?;
    if request.api_key.trim().is_empty() {
        return Err("没有填写 API Key".into());
    }
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

    let response = client
        .post(&endpoint)
        .bearer_auth(request.api_key.trim())
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
        return Err(format!("接口返回 {status}：{brief}"));
    }

    serde_json::from_str::<Value>(&text).map_err(|error| {
        let brief: String = text.chars().take(MAX_ERROR_BODY).collect();
        format!("响应不是合法 JSON（{error}）：{brief}")
    })
}

#[cfg(test)]
mod tests {
    use super::{chat_endpoint, ChatRequest};

    /// 前端传来的是 camelCase（baseUrl / apiKey）：Tauri 的自动改名只作用于
    /// 命令参数名，不会深入嵌套结构体，所以这里必须有 rename_all 兜住。
    /// 少了它，请求会在反序列化阶段就因为「missing field base_url」失败。
    #[test]
    fn accepts_camel_case_payload() {
        let payload = serde_json::json!({
            "baseUrl": "https://api.deepseek.com/v1",
            "apiKey": "sk-test",
            "model": "deepseek-chat",
            "messages": [{ "role": "user", "content": "hi" }],
        });
        let parsed: ChatRequest =
            serde_json::from_value(payload).expect("camelCase 参数应该能解析");
        assert_eq!(parsed.base_url, "https://api.deepseek.com/v1");
        assert_eq!(parsed.api_key, "sk-test");
    }

    /// 只填域名时补 /v1，写了 /v1 就不重复补
    #[test]
    fn appends_version_and_endpoint() {
        assert_eq!(
            chat_endpoint("https://api.deepseek.com").unwrap(),
            "https://api.deepseek.com/v1/chat/completions"
        );
        assert_eq!(
            chat_endpoint("https://api.deepseek.com/v1/").unwrap(),
            "https://api.deepseek.com/v1/chat/completions"
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
}
