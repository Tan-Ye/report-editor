import {
	getReportUpdatedAt,
	listReportFolders,
	readReportJson,
	removeReportDir,
} from "./report-storage";

/**
 * 草稿箱。
 *
 * 草稿存在 `cache/<报告名>-<id>/report.json`，用 `reportId` 和正式报告配对。
 * 当 `data/` 里找不到同 id 的报告时，它就成了"孤儿草稿"——比如新建窗口里
 * 没保存就崩溃了。这些内容本身是好的，只是没有任何入口能找回它们，
 * 所以启动时扫一遍、列出来让用户决定恢复还是丢弃。
 *
 * 一个例外：用户主动选择"不保存"关闭窗口时，直接删掉草稿，不产生孤儿。
 */

const DRAFT_AREA = "cache" as const;
const SAVED_AREA = "data" as const;

export interface DraftEntry {
	/** cache 下的目录名 */
	folder: string;
	reportId: string;
	reportName: string;
	/** 最后写入时间（毫秒），拿不到就用 0 */
	updatedAt: number;
	/** data/ 里有没有同 id 的正式报告 */
	hasSavedCopy: boolean;
}

/** 收集 data/ 下所有正式报告的 id：草稿配对用 */
async function collectSavedIds(root: string): Promise<Set<string>> {
	const ids = new Set<string>();
	const folders = await listReportFolders(root, SAVED_AREA).catch(() => [] as string[]);
	for (const folder of folders) {
		try {
			const raw = await readReportJson(root, SAVED_AREA, folder);
			const parsed = JSON.parse(raw) as { reportId?: unknown };
			if (typeof parsed.reportId === "string" && parsed.reportId) {
				ids.add(parsed.reportId);
			}
		} catch {
			continue;
		}
	}
	return ids;
}

/** 列出一个数据目录下的所有草稿 */
export async function listDrafts(root: string): Promise<DraftEntry[]> {
	const folders = await listReportFolders(root, DRAFT_AREA).catch(() => [] as string[]);
	const savedIds = await collectSavedIds(root);
	const entries: DraftEntry[] = [];

	for (const folder of folders) {
		try {
			const raw = await readReportJson(root, DRAFT_AREA, folder);
			const parsed = JSON.parse(raw) as { reportId?: unknown; reportName?: unknown };
			const reportId = typeof parsed.reportId === "string" ? parsed.reportId : "";
			if (!reportId) {
				// 没有 id 的草稿无法配对，也无法被占用检查保护，直接跳过
				continue;
			}
			const updatedAt = (await getReportUpdatedAt(root, DRAFT_AREA, folder)) ?? 0;
			entries.push({
				folder,
				reportId,
				reportName: typeof parsed.reportName === "string" ? parsed.reportName : "未命名报告",
				updatedAt,
				hasSavedCopy: savedIds.has(reportId),
			});
		} catch {
			// 单份草稿坏了不该影响整份列表
			continue;
		}
	}

	return entries.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 孤儿草稿：没有对应正式报告的那些（崩溃残留、未保存就关掉的窗口） */
export function orphanDrafts(entries: DraftEntry[]): DraftEntry[] {
	return entries.filter((entry) => !entry.hasSavedCopy);
}

/** 丢弃一份草稿（用户明确不要了） */
export async function discardDraft(root: string, folder: string): Promise<void> {
	await removeReportDir(root, DRAFT_AREA, folder).catch(() => {});
}

/** 把毫秒时间戳变成"刚刚 / 5 分钟前 / 昨天"这种给人看的说法 */
export function formatDraftTime(timestamp: number): string {
	if (!timestamp) {
		return "时间未知";
	}
	const diff = Date.now() - timestamp;
	if (diff < 60_000) {
		return "刚刚";
	}
	if (diff < 3_600_000) {
		return `${Math.floor(diff / 60_000)} 分钟前`;
	}
	if (diff < 86_400_000) {
		return `${Math.floor(diff / 3_600_000)} 小时前`;
	}
	return `${Math.floor(diff / 86_400_000)} 天前`;
}
