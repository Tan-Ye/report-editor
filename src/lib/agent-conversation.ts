import { readText, writeJsonAtomically } from "./report-storage";

/**
 * agent 会话持久化：一个报告 = 一个会话文件。
 *
 * 位置：报告目录下的 `agent/conversation.json`，和 report.json、media/ 并列。
 * 为什么不放进 report.json：它不是文档内容，进文档会污染格式、进校验、进导出；
 * 放在报告目录里则是为了"报告被复制/迁移时会话跟着走"。
 *
 * 只存**自然语言消息 + 动作摘要**，不存原始工具结果：
 * 一个 get_page_detail 的结果可能上万字符，存下来文件几 MB，下次还得重新灌上下文。
 */

export interface AgentChatMessage {
	role: "user" | "assistant";
	content: string;
}

export interface AgentActionRecord {
	/** 毫秒时间戳 */
	at: number;
	/** 给人和交接摘要看的动作描述，例如「添加 6 个元素」 */
	text: string;
}

export interface AgentUsageRecord {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
}

export interface AgentConversation {
	reportId: string;
	/** 第几段会话（每次交接 +1） */
	sessionIndex: number;
	updatedAt: number;
	usage: AgentUsageRecord;
	/** 当前会话的消息（只含 user / assistant） */
	messages: AgentChatMessage[];
	/** 工具动作摘要，用于生成交接和界面回顾 */
	actions: AgentActionRecord[];
	/** 历次交接摘要在切换时归档，便于回溯 */
	archives: { at: number; handover: string }[];
}

const CONVERSATION_DIR = "agent";
const CONVERSATION_FILE = "agent/conversation.json";

/** 会话预算：超过它就先裁剪，裁剪后还超就交接重开 */
export const DEFAULT_TOKEN_BUDGET = 24000;

export function createConversation(reportId: string): AgentConversation {
	return {
		reportId,
		sessionIndex: 1,
		updatedAt: Date.now(),
		usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
		messages: [],
		actions: [],
		archives: [],
	};
}

/** 粗略估算 token：中文大约 2.2 字符/token，英文更多，这里取保守值 */
export function estimateTokens(messages: AgentChatMessage[]): number {
	const chars = messages.reduce((total, message) => total + message.content.length, 0);
	return Math.ceil(chars / 2.2);
}

/**
 * 裁剪：保留最近的消息，直到低于预算。
 *
 * 先裁剪、再交接 —— 很多情况砍掉最早的几十轮就够了，不用真的换会话。
 * 至少保留 keepRecent 条，避免把上下文砍到模型什么都不知道。
 */
export function trimMessages(
	messages: AgentChatMessage[],
	budget = DEFAULT_TOKEN_BUDGET,
	keepRecent = 6,
): AgentChatMessage[] {
	if (estimateTokens(messages) <= budget) {
		return messages;
	}
	const kept: AgentChatMessage[] = [];
	let tokens = 0;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		const cost = Math.ceil(message.content.length / 2.2);
		if (kept.length >= keepRecent && tokens + cost > budget) {
			break;
		}
		kept.unshift(message);
		tokens += cost;
	}
	return kept;
}

/**
 * 交接摘要：**由程序拼**，不让模型写。
 *
 * 理由：模型写要额外跑一轮（费钱），而且容易漏掉/记错实际做了什么；
 * 而每个工具调用都经过命令层，我们手里就有事实。
 */
export function buildHandover(conversation: AgentConversation, documentSummary?: {
	reportName?: string;
	pages?: { name: string; elementCount: number }[];
	currentPageIndex?: number;
}): string {
	const lines: string[] = ["【上一段会话的交接摘要】"];

	if (documentSummary?.pages?.length) {
		const pages = documentSummary.pages
			.map((page, index) => `${index + 1}. ${page.name}（${page.elementCount} 个元素）`)
			.join("；");
		lines.push(`报告「${documentSummary.reportName || "未命名"}」共 ${documentSummary.pages.length} 页：${pages}。`);
		if (typeof documentSummary.currentPageIndex === "number") {
			lines.push(`当前停在第 ${documentSummary.currentPageIndex + 1} 页。`);
		}
	}

	const requests = conversation.messages
		.filter((message) => message.role === "user")
		.slice(-3)
		.map((message) => message.content.trim().slice(0, 60));
	if (requests.length > 0) {
		lines.push(`用户之前的请求：${requests.map((text, index) => `${index + 1}) ${text}`).join("；")}`);
	}

	const actions = conversation.actions.slice(-8).map((action) => action.text);
	if (actions.length > 0) {
		lines.push(`已执行的关键操作：${actions.join("、")}。`);
	}

	lines.push("请在此基础上继续，不要重复已完成的工作。");
	return lines.join("\n");
}

/** 在指定报告目录里读写会话文件 */
export async function loadConversation(root: string, folder: string): Promise<AgentConversation | null> {
	try {
		const raw = await readText(root, `${folder}/${CONVERSATION_FILE}`);
		const parsed = JSON.parse(raw) as Partial<AgentConversation>;
		if (!parsed || typeof parsed !== "object") {
			return null;
		}
		return {
			reportId: typeof parsed.reportId === "string" ? parsed.reportId : "",
			sessionIndex: typeof parsed.sessionIndex === "number" ? parsed.sessionIndex : 1,
			updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
			usage: {
				promptTokens: parsed.usage?.promptTokens ?? 0,
				completionTokens: parsed.usage?.completionTokens ?? 0,
				totalTokens: parsed.usage?.totalTokens ?? 0,
			},
			messages: Array.isArray(parsed.messages)
				? parsed.messages.filter(
						(message): message is AgentChatMessage =>
							(message?.role === "user" || message?.role === "assistant") &&
							typeof message?.content === "string",
					)
				: [],
			actions: Array.isArray(parsed.actions)
				? parsed.actions.filter(
						(action): action is AgentActionRecord =>
							typeof action?.at === "number" && typeof action?.text === "string",
					)
				: [],
			archives: Array.isArray(parsed.archives) ? parsed.archives : [],
		};
	} catch {
		// 文件不存在 / 内容坏了都按"没有会话"处理，不能影响报告打开
		return null;
	}
}

export async function saveConversation(root: string, folder: string, data: AgentConversation): Promise<void> {
	const payload: AgentConversation = { ...data, updatedAt: Date.now() };
	await writeJsonAtomically(root, `${folder}/${CONVERSATION_FILE}`, JSON.stringify(payload, null, 2));
}

/** 会话目录在复制/迁移报告时会跟着走，这里只用来确保目录存在 */
export const CONVERSATION_DIRNAME = CONVERSATION_DIR;
