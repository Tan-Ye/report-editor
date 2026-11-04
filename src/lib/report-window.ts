import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * 新建报告 = **开一个新窗口**。
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

export async function openNewReportWindow(): Promise<NewReportWindowResult> {
	counter += 1;
	// 时间戳 + 计数：同一秒连点两次也不会撞标签
	const label = `report-${Date.now()}-${counter}`;

	const window = new WebviewWindow(label, {
		// `?new=1` 让新窗口跳过"恢复上次报告"，从空白文档开始
		url: "/?new=1",
		title: "报表编辑器 — 新报告",
		width: 1440,
		height: 900,
		minWidth: 1024,
		minHeight: 640,
		center: true,
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
