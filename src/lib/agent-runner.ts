import { chat, type AgentMessage, type AgentUsage } from "./agent";
import { AGENT_TOOLS, describeToolCall, executeToolCall } from "./agent-tools";
import { withAgentCanvasLock } from "./agent-session";
import { agentStore } from "@/store";

/**
 * Agent 主循环：一句话 → 模型调工具 → 本地执行 → 结果回填 → 再来一轮。
 *
 * 几个刻意的设计：
 *
 * 1. **工具结果回填成文本**（JSON 字符串），不是图片。DeepSeek chat 不支持看图，
 *    把图塞进消息会直接报错。渲染出来的图交给界面显示，模型靠 `get_page_detail`
 *    的结构化信息判断排版。
 * 2. **每轮执行包在画布锁里**：命令层会触发整页重载，锁住画布避免打断用户操作。
 * 3. **有轮次上限**：模型偶尔会来回"改一下再看一眼"，没有上限会一直烧 token。
 * 4. **失败不抛出**，作为 tool 消息回填 —— 模型看到错误才能自己纠正。
 */

/** 系统提示：告诉模型坐标系、可用工具、以及几条硬约束 */
const SYSTEM_PROMPT = `你是报表编辑器里的设计助手，通过工具直接操作画布。用户用中文提需求，你负责把页面摆好。

【画布】
- 每页固定 1920×1080，坐标原点在左上角，x 向右、y 向下。
- 常用排版：页边距 96；标题顶部 80 左右；正文 24–32 号字；卡片间距 24–32。

【元素类型】
rect（矩形）、text（文本）、image（图片）、ellipse/triangle/diamond/star…（形状）、line-solid 等线条。

【规则】
1. text 元素必须给 attrs.text，字号一般 20–56。标题可以用 fontSize:56、fontWeight:700。
2. 一次要加多个元素时**必须**用 add_elements 传数组，不要连续调多次。
3. 需要放图片的位置用 rect 占位（深色底 + 一句说明文字），不要创建 image 元素。
4. fill 可以是 "#ffffff" 或 {kind:"solid",color:"#ffffff"}；渐变用 {kind:"gradient",type:"linear",angle:90,stops:[...]}。
5. 深色背景配浅色文字，浅色背景配深色文字，注意对比度。
6. 元素别超出页面边界（0 ≤ left，left+width ≤ 1920，同理 y）。
7. 动手前先 get_document 看现状；改完调用一次 render_page，让用户看到结果。
8. 完成时用一句话总结你做了什么，不要罗列工具细节。`;

/** 打开「生成图片」时追加的说明：允许创建 image 元素，但只能用文档里已有的图 */
const IMAGE_RULE_ON = `

【图片】
用户允许创建 image 元素，但 source 必须是文档里已经存在的媒体（形如 media/xxx.png）。
你不知道有哪些，所以只有在用户明确给出文件名时才用；否则仍然用 rect 占位。`;

/**
 * 按当前设置拼系统提示。
 * 「生成图片」关着的时候不让模型碰 image —— 它不知道有哪些媒体，猜路径只会失败并白烧 token。
 */
function buildSystemPrompt(): string {
	return agentStore.getState().generateImages ? `${SYSTEM_PROMPT}${IMAGE_RULE_ON}` : SYSTEM_PROMPT;
}

/** 一次循环里给界面看的事件 */
export type AgentStep =
	| { kind: "assistant"; text: string }
	| { kind: "tool"; text: string }
	| { kind: "render"; imageUrl: string; text: string }
	| { kind: "usage"; usage: AgentUsage }
	| { kind: "round"; round: number };

export interface RunAgentOptions {
	/** 最多几轮「模型思考 + 执行工具」，默认 6 */
	maxRounds?: number;
	onStep?: (step: AgentStep) => void;
}

/** 工具结果回填前截断：页面明细能把上下文瞬间撑爆 */
const MAX_TOOL_RESULT_CHARS = 4000;

function trimResult(result: Record<string, unknown>): string {
	const text = JSON.stringify(result);
	return text.length <= MAX_TOOL_RESULT_CHARS
		? text
		: `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…（结果过长已截断）`;
}

/**
 * 跑一轮 agent 任务。
 *
 * `history` 是之前的对话（不含 system），返回值是**追加了新消息之后的完整对话**，
 * 调用方直接存下来给下一句用。
 */
export async function runAgent(
	instruction: string,
	history: AgentMessage[],
	options: RunAgentOptions = {},
): Promise<{ messages: AgentMessage[]; rounds: number }> {
	const maxRounds = options.maxRounds ?? 6;
	const emit = options.onStep ?? (() => {});

	const conversation: AgentMessage[] = [
		{ role: "system", content: buildSystemPrompt() },
		...history,
		{ role: "user", content: instruction },
	];

	let rounds = 0;
	while (rounds < maxRounds) {
		rounds += 1;
		emit({ kind: "round", round: rounds });

		const reply = await chat(conversation, { tools: AGENT_TOOLS as unknown as unknown[] });
		conversation.push(reply.message);
		if (reply.usage) {
			emit({ kind: "usage", usage: reply.usage });
		}
		if (reply.message.content.trim()) {
			emit({ kind: "assistant", text: reply.message.content });
		}

		const calls = reply.message.tool_calls ?? [];
		if (calls.length === 0) {
			break;
		}

		for (const call of calls) {
			emit({ kind: "tool", text: describeToolCall(call) });
			// 画布锁：命令层会整页重载，别打断用户当前操作
			const result = await withAgentCanvasLock(() => executeToolCall(call));
			if (typeof result.imageUrl === "string") {
				emit({ kind: "render", imageUrl: result.imageUrl, text: "页面效果" });
			}
			conversation.push({
				role: "tool",
				tool_call_id: call.id,
				content: trimResult(result),
			});
		}
	}

	// 返回给调用方时去掉 system：它每轮都会重新拼
	return { messages: conversation.filter((message) => message.role !== "system"), rounds };
}
