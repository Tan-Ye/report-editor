import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 报告占用：一份报告同时只能在一个窗口打开。
 *
 * 两个窗口同时编辑同一份报告会互相覆盖（文档本身和 `agent/conversation.json` 都是），
 * 所以打开前先在 Rust 侧的登记表里抢位，抢不到就不打开。
 *
 * 登记表在 Rust 内存里，进程退出自动清空 —— 崩溃不会留下"永远被占用"的锁。
 */

export interface ClaimResult {
	claimed: boolean;
	owner?: string | null;
}

/** 当前窗口标签（`main` / `report-…`） */
export function currentWindowLabel(): string {
	try {
		return getCurrentWindow().label;
	} catch {
		return "main";
	}
}

export async function claimReport(reportId: string): Promise<ClaimResult> {
	try {
		const result = await invoke<ClaimResult>("claim_report", {
			reportId,
			windowLabel: currentWindowLabel(),
		});
		return result;
	} catch {
		// 拿不到登记表（老版本/非 Tauri 环境）时按"抢到了"处理，不能因此打不开报告
		return { claimed: true };
	}
}

export async function releaseReport(reportId: string): Promise<void> {
	if (!reportId) {
		return;
	}
	await invoke("release_report", { reportId }).catch(() => {});
}

export async function releaseReportsForWindow(): Promise<void> {
	await invoke("release_reports_for_window", { windowLabel: currentWindowLabel() }).catch(() => {});
}

/** reportId → 占用它的窗口标签。界面用它把"已被打开"的条目标灰。 */
export async function listClaims(): Promise<Record<string, string>> {
	try {
		return await invoke<Record<string, string>>("list_claims");
	} catch {
		return {};
	}
}

/**
 * 这个窗口当前占着哪份报告。
 *
 * 打开新报告前要先释放旧的，否则用户切来切去会把自己的报告占满 ——
 * 表现成"明明是我自己开的窗口，却说被占用"。
 */
let heldReportId: string | null = null;

/** 换报告时释放上一份（新报告的 id 相同就跳过） */
export async function releaseHeldReport(nextReportId: string): Promise<void> {
	if (heldReportId && heldReportId !== nextReportId) {
		await releaseReport(heldReportId);
	}
	heldReportId = nextReportId;
}

/** 窗口关掉时释放所有占用 */
export async function releaseAllOnUnload(): Promise<void> {
	heldReportId = null;
	await releaseReportsForWindow();
}
