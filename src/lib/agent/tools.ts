import {
	addElement,
	addPage,
	batchCommands,
	deleteElement,
	getDocumentSummary,
	getPageDetail,
	renderPageForAgent,
	setPageFill,
	updateElement,
} from "../report/commands";
import type { AgentToolCall } from "./llm";
import { agentStore, getProviderPreset } from "@/store";
import { IMAGE_ELEMENT_TYPE } from "@/base/elements";

/**
 * Agent 能调用的工具：OpenAI `tools` 规范 + 本地执行器。
 *
 * 设计原则：
 * - **少而稳**：8 个工具足够搭一页报表，工具越多模型越容易乱选
 * - **一次调用能做一件事**：加元素走 `add_elements`（数组），而不是让模型连续调 10 次
 * - **返回值是给模型看的说明**，中文、说清"做了什么/为什么失败"，它下一轮才能自己纠错
 *
 * 注意：`replace_document`（整份文档替换）暂时不开放 —— 测试成本高，界面里也只放了禁用按钮。
 */

type ToolResult = Record<string, unknown>;

/** 工具定义（喂给模型的 JSON Schema） */
export const AGENT_TOOLS = [
	{
		type: "function",
		function: {
			name: "get_document",
			description: "查看当前报告结构：页数、当前页、每页元素数量。开始前先调它了解现状。",
			parameters: { type: "object", properties: {}, required: [] },
		},
	},
	{
		type: "function",
		function: {
			name: "get_page_detail",
			description: "查看某一页的元素明细（id、类型、位置、尺寸、文本内容），用于判断排版是否合理。",
			parameters: {
				type: "object",
				properties: {
					pageId: { type: "string", description: "页面 id；不传就是当前页" },
				},
				required: [],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "add_page",
			description: "新增一页并切换到它。",
			parameters: {
				type: "object",
				properties: { name: { type: "string", description: "页面名字，例如「封面」" } },
				required: [],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "set_page_fill",
			description: "设置页面背景。fill 传 null 表示恢复白底。",
			parameters: {
				type: "object",
				properties: {
					pageId: { type: "string" },
					fill: {
						description:
							'纯色写 "#ffffff" 或 {kind:"solid",color}；渐变写 {kind:"gradient",type:"linear"|"radial",angle,stops:[{offset,color,alpha}]}',
					},
				},
				required: ["fill"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "add_elements",
			description:
				"批量添加元素。一次传数组，比逐个添加快得多。坐标原点在页面左上角，页面 1920×1080。",
			parameters: {
				type: "object",
				properties: {
					pageId: { type: "string", description: "页面 id；不传就是当前页" },
					elements: {
						type: "array",
						items: {
							type: "object",
							properties: {
								elementType: {
									type: "string",
									description: "rect / text / image / ellipse 等，见 describe 说明",
								},
								attrs: {
									type: "object",
									description:
										"元素属性：left/top/width/height/angle/opacity/fill/stroke/fontSize/text 等",
								},
							},
							required: ["elementType"],
						},
					},
				},
				required: ["elements"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "update_element",
			description: "修改已有元素的属性（只覆盖传进来的字段）。",
			parameters: {
				type: "object",
				properties: {
					elementId: { type: "string" },
					attrs: { type: "object", description: "要改的字段，例如 {left:120,fill:'#2563eb'}" },
				},
				required: ["elementId", "attrs"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "delete_element",
			description: "删除一个元素。",
			parameters: {
				type: "object",
				properties: { elementId: { type: "string" } },
				required: ["elementId"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "render_page",
			description: "把某一页渲染成图片，用户会在界面上看到效果。用于确认自己的改动。",
			parameters: {
				type: "object",
				properties: {
					pageId: { type: "string" },
					maxWidth: { type: "number", description: "渲染宽度，默认 768" },
				},
				required: [],
			},
		},
	},
] as const;

/** 参数里取字符串的便捷函数（模型偶尔会把数字写成字符串） */
function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function asObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/**
 * 执行一次工具调用。
 *
 * 不抛异常：工具失败也返回 `{ ok:false, message }`，由调用方包成 `tool` 消息回填给模型 ——
 * 模型看到失败原因才能自己纠正，抛异常它会直接"卡住"。
 */
export async function executeToolCall(call: AgentToolCall): Promise<ToolResult> {
	const name = call.function?.name ?? "";
	const args = (() => {
		try {
			return asObject(JSON.parse(call.function?.arguments || "{}"));
		} catch {
			return {};
		}
	})();

	try {
		switch (name) {
			case "get_document":
				return { ok: true, document: getDocumentSummary() };

			case "get_page_detail": {
				const result = getPageDetail(asString(args.pageId));
				return result.ok ? { ok: true, page: result.data } : { ok: false, error: result.message };
			}

			case "add_page": {
				const result = addPage({ name: asString(args.name) });
				return result.ok
					? { ok: true, pageId: result.data?.pageId, message: result.message }
					: { ok: false, error: result.message };
			}

			case "set_page_fill": {
				const result = setPageFill({
					pageId: asString(args.pageId),
					fill: args.fill,
				});
				return result.ok
					? { ok: true, message: result.message }
					: { ok: false, error: result.message };
			}

			case "add_elements": {
				const pageId = asString(args.pageId);
				const items = asArray(args.elements);
				if (items.length === 0) {
					return { ok: false, error: "elements 不能为空" };
				}
				// 一次工具调用 = 一步撤销：内部批量，只重载一次画布
				return batchCommands(() => {
					const created: { elementId?: string; elementType: string }[] = [];
					const errors: string[] = [];
					const allowImages = agentStore.getState().generateImages;
					for (const item of items) {
						const element = asObject(item);
						const elementType = asString(element.elementType) ?? "";
						// 关了「生成图片」就一律拒绝：模型不知道有哪些媒体，猜路径基本会失败
						if (elementType === IMAGE_ELEMENT_TYPE && !allowImages) {
							errors.push(
								"用户关闭了「生成图片」：不要创建 image 元素，改用 rect 占位（图片由用户自己填）",
							);
							continue;
						}
						const result = addElement({
							pageId,
							elementType,
							attrs: asObject(element.attrs),
						});
						if (result.ok) {
							created.push({
								elementId: asString(result.data?.elementId),
								elementType,
							});
						} else {
							errors.push(result.message);
						}
					}
					if (created.length === 0) {
						return { ok: false, error: errors.join("；") || "一个元素都没添加成功" };
					}
					return {
						ok: errors.length === 0,
						added: created,
						...(errors.length > 0 ? { partialErrors: errors } : {}),
						message: `已添加 ${created.length} 个元素${errors.length ? `，${errors.length} 个失败` : ""}`,
					};
				});
			}

			case "update_element": {
				const result = updateElement({
					elementId: asString(args.elementId) ?? "",
					attrs: asObject(args.attrs),
				});
				return result.ok ? { ok: true, message: result.message } : { ok: false, error: result.message };
			}

			case "delete_element": {
				const result = deleteElement({ elementId: asString(args.elementId) ?? "" });
				return result.ok ? { ok: true, message: result.message } : { ok: false, error: result.message };
			}

			case "render_page": {
				const result = await renderPageForAgent({
					pageId: asString(args.pageId),
					maxWidth: typeof args.maxWidth === "number" ? args.maxWidth : undefined,
				});
				if (!result.ok) {
					return { ok: false, error: result.message };
				}
				// 图片给用户看；模型能不能看图取决于是否支持视觉，文本侧只回结构信息
				const detail = getPageDetail(asString(args.pageId));
				return {
					ok: true,
					message: `${result.message}（图片已显示在界面上）`,
					imageUrl: result.data?.imageUrl,
					page: detail.ok ? detail.data : undefined,
				};
			}

			default:
				return { ok: false, error: `未知工具：${name}` };
		}
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

/** 当前模型能不能看图（DeepSeek chat 是纯文本，OpenAI 的 gpt-4o 系列可以） */
export function modelSupportsVision(): boolean {
	const settings = agentStore.getState();
	const preset = getProviderPreset(settings.provider);
	if (settings.provider === "custom") {
		return false;
	}
	return preset.value === "openai" && settings.model.startsWith("gpt-4o");
}

/** 工具调用的参数摘要，给界面显示"正在做什么" */
export function describeToolCall(call: AgentToolCall): string {
	const name = call.function?.name ?? "";
	const args = (() => {
		try {
			return asObject(JSON.parse(call.function?.arguments || "{}"));
		} catch {
			return {};
		}
	})();

	if (name === "add_elements") {
		const count = asArray(args.elements).length;
		return `添加 ${count} 个元素`;
	}
	if (name === "add_page") {
		return `新增页面${args.name ? `「${String(args.name)}」` : ""}`;
	}
	if (name === "set_page_fill") {
		return "设置页面背景";
	}
	if (name === "update_element") {
		return "修改元素";
	}
	if (name === "delete_element") {
		return "删除元素";
	}
	if (name === "render_page") {
		return "渲染页面";
	}
	if (name === "get_document" || name === "get_page_detail") {
		return "查看文档";
	}
	return name;
}
