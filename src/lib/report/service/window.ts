import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * 新建报告 / 打开内容 = **开一个新窗口**。
 *
 * 为什么不是"在当前窗口里清空重来"：
 * - 每个 webview 有自己的一套 store，新窗口天然就是一份独立文档，不用做"重置全部状态"
 * - 可以同时对照两份报告改
 * - 关掉窗口等于关掉这份草稿，不会影响原来的
 *
 * 窗口标签用 `report-` 前缀：capabilities 里的 `report-*` 通配符靠它授权，
 * 换成别的名字新窗口会因为没权限而调不通任何命令。
 */

let counter = 0;

export interface NewReportWindowResult {
	label: string;
}

/**
 * 新窗口要打开的文档。
 *
 * 只能靠 URL 传递：webview 之间不共享任何内存，新窗口启动时自己去地址栏里读。
 * 加新来源（模板）时，`buildWindowUrl` 和 `parseOpenTarget` 两边一起改。
 */
export interface OpenTarget {
	/** 内容来源：草稿（未保存的编辑）或模板（用它新建一份报告） */
	area: "draft" | "template";
	/** 目录名（存储区下一级） */
	folder: string;
	/** 所在数据目录的绝对路径；空串表示当前默认目录 */
	root: string;
}

/**
 * 拼出窗口地址。参数名只在这里和 parseOpenTarget 里出现，
 * 两边成对修改 —— 单测直接拿它的产物去解析，保证写的和读的一致。
 */
export function buildWindowUrl(target: OpenTarget | null): string {
	if (!target) {
		// `?new=1` 让新窗口跳过"恢复上次报告"，从空白文档开始
		return "/?new=1";
	}
	const params = new URLSearchParams({
		open: target.area,
		folder: target.folder,
		root: target.root,
	});
	return `/?${params.toString()}`;
}

/** 解析窗口地址里的"要打开的文档"；没有就返回 null（走常规的恢复/新建流程） */
export function parseOpenTarget(search: string): OpenTarget | null {
	const params = new URLSearchParams(search);
	const area = params.get("open");
	if (area !== "draft" && area !== "template") {
		return null;
	}
	const folder = params.get("folder") ?? "";
	if (!folder) {
		return null;
	}
	return { area, folder, root: params.get("root") ?? "" };
}

export async function openNewReportWindow(
	target: OpenTarget | null = null,
): Promise<NewReportWindowResult> {
	counter += 1;
	// 时间戳 + 计数：同一秒连点两次也不会撞标签
	const label = `report-${Date.now()}-${counter}`;

	const window = new WebviewWindow(label, {
		url: buildWindowUrl(target),
		title:
			target?.area === "template"
				? "报表编辑器 — 由模板新建"
				: target
					? "报表编辑器 — 未保存的内容"
					: "报表编辑器 — 新报告",
		width: 1920,
		height: 1080,
		minWidth: 1024,
		minHeight: 640,
		center: true,
		// 和主窗口一致：启动就是最大化，工具条/富文本菜单才不会挤在一起
		maximized: true,
	});

	// 创建失败（标签重复、系统拒绝）要能告诉用户，而不是静默什么都不发生
	const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
		void window.once("tauri://created", () => resolve({ ok: true }));
		void window.once("tauri://error", (event) => {
			resolve({ ok: false, error: String((event as { payload?: unknown }).payload ?? "未知错误") });
		});
	});

	if (!result.ok) {
		throw new Error(result.error || "新窗口创建失败");
	}

	return { label };
}
