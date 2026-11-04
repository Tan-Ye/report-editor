import { invoke } from "@tauri-apps/api/core";
import { agentStore, supportsTools, type AgentSettings } from "@/store";

/**
 * 大模型调用封装。
 *
 * 只做三件事：拼请求、调 Rust 命令、把响应里的 message / usage 摘出来。
 * 工具调用怎么执行、要不要再问一轮，属于 agent 循环（`lib/agent/runner.ts`）的事。
 *
 * 协议固定 OpenAI 兼容格式；换服务商只是换地址和模型名。
 */

export interface AgentToolCall {
	id: string;
	type?: string;
	function: {
		name: string;
		/** 模型返回的是 JSON 字符串，不是对象 */
		arguments: string;
	};
}

export interface AgentMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	/** assistant 消息里模型请求调用的工具 */
	tool_calls?: AgentToolCall[];
	/** role = tool 时要回填是哪次调用的结果 */
	tool_call_id?: string;
}

export interface AgentUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
}

export interface AgentReply {
	message: AgentMessage;
	usage: AgentUsage | null;
	/** 接口返回的 finish_reason，便于判断是正常结束还是被截断 */
	finishReason: string | null;
}

export class AgentError extends Error {}

/** 接口原始响应里我们关心的那部分 */
interface RawCompletion {
	choices?: {
		message?: { role?: string; content?: string | null; tool_calls?: AgentToolCall[] };
		finish_reason?: string | null;
	}[];
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
	error?: { message?: string };
}

function requireSettings(): AgentSettings {
	const settings = agentStore.getState();
	if (!settings.baseUrl.trim()) {
		throw new AgentError("没有填写接口地址，请先在「设置」里配置");
	}
	if (!settings.model.trim()) {
		throw new AgentError("没有选择模型");
	}
	// 本地模型（Ollama 之类）不需要 Key，那就别拦
	if (agentStore.needsApiKey()) {
		throw new AgentError("请先设置 API Key：点右上角齿轮，填当前服务商的 Key");
	}
	return settings;
}

export interface ChatOptions {
	/** OpenAI 格式的 tools；模型不支持工具调用时会被忽略 */
	tools?: unknown[];
	temperature?: number;
}

/**
 * 发一轮对话。返回模型这条 assistant 消息（可能带 tool_calls）。
 * 失败抛 `AgentError`，语义化的消息可以直接显示给用户。
 */
export async function chat(messages: AgentMessage[], options: ChatOptions = {}): Promise<AgentReply> {
	const settings = requireSettings();
	const useTools = options.tools && options.tools.length > 0 && supportsTools(settings);

	let raw: RawCompletion;
	try {
		raw = await invoke<RawCompletion>("llm_chat", {
			request: {
				baseUrl: settings.baseUrl,
				apiKey: agentStore.getApiKey(),
				model: settings.model,
				messages,
				tools: useTools ? options.tools : undefined,
				temperature: options.temperature,
			},
		});
	} catch (error) {
		throw new AgentError(error instanceof Error ? error.message : String(error));
	}

	if (raw.error?.message) {
		throw new AgentError(raw.error.message);
	}
	const choice = raw.choices?.[0];
	if (!choice?.message) {
		throw new AgentError("接口没有返回任何消息");
	}

	const usage = raw.usage
		? {
				promptTokens: raw.usage.prompt_tokens ?? 0,
				completionTokens: raw.usage.completion_tokens ?? 0,
				totalTokens: raw.usage.total_tokens ?? 0,
			}
		: null;

	return {
		message: {
			role: "assistant",
			content: choice.message.content ?? "",
			tool_calls: choice.message.tool_calls,
		},
		usage,
		finishReason: choice.finish_reason ?? null,
	};
}

/**
 * 测试连接：发一句最短的话，验证地址 / Key / 模型是否可用。
 * 这是设置面板里「测试连接」按钮的实现，不产生任何文档改动。
 */
export async function testConnection(): Promise<string> {
	const reply = await chat([{ role: "user", content: "只回复 ok" }], { temperature: 0 });
	return reply.message.content.trim() || "（模型返回了空内容）";
}
