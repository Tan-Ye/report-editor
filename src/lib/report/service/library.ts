import { dataDirsStore } from "@/store";
import { ensurePreferencesLoaded } from "../../ui-preferences";
import { listReportMeta, removeReportDir } from "./storage";

/**
 * 报告库里的两类"额外内容"：草稿和模板。
 *
 * 它们和正式报告共用一套磁盘结构（`<数据目录>/<区>/<名称>-<id>/report.json` + `media/`），
 * 差别只在生命周期：
 * - 草稿（`cache/`）随保存消失、会被自动清理，用 `reportId` 和正式报告配对；
 * - 模板（`templates/`）由用户主动保存、主动删除，打开时以内容新建一份报告。
 *
 * 两个列表的读取方式一模一样，所以放在同一个模块里 —— 以前拆成 draft-box / template-box
 * 两个文件，各自只有几十行，反而让"报告库有哪些内容区"这件事散在多处。
 */

const DRAFT_AREA = "cache" as const;
const SAVED_AREA = "data" as const;
const TEMPLATE_AREA = "templates" as const;

/** 草稿条目 */
export interface DraftEntry {
	/** 这份草稿所在的数据目录（绝对路径）。多目录时靠它区分同名草稿 */
	root: string;
	/** cache 下的目录名 */
	folder: string;
	reportId: string;
	reportName: string;
	/** 最后写入时间（毫秒），拿不到就用 0 */
	updatedAt: number;
	/** data/ 里有没有同 id 的正式报告 */
	hasSavedCopy: boolean;
}

/** 模板条目 */
export interface TemplateEntry {
	/** 模板所在的数据目录（绝对路径） */
	root: string;
	/** templates 下的目录名 */
	folder: string;
	/** 给人看的模板名（取 JSON 里的 reportName） */
	name: string;
	/** 最后写入时间（毫秒），拿不到就用 0 */
	updatedAt: number;
}

/** 收集 data/ 下所有正式报告的 id：草稿配对用（一次扫描拿回，不再逐个读 JSON） */
async function collectSavedIds(root: string): Promise<Set<string>> {
	const metas = await listReportMeta(root, SAVED_AREA).catch(() => []);
	return new Set(metas.map((meta) => meta.reportId));
}

/** 列出一个数据目录下的所有草稿，按最后修改时间倒序 */
export async function listDrafts(root: string): Promise<DraftEntry[]> {
	const [metas, savedIds] = await Promise.all([
		listReportMeta(root, DRAFT_AREA).catch(() => []),
		collectSavedIds(root),
	]);

	const entries: DraftEntry[] = metas
		.filter((meta) => meta.reportId)
		.map((meta) => ({
			root,
			folder: meta.folder,
			reportId: meta.reportId,
			reportName: meta.reportName || "未命名报告",
			updatedAt: meta.updatedAt,
			hasSavedCopy: savedIds.has(meta.reportId),
		}));

	return entries.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 孤儿草稿：没有对应正式报告的那些（崩溃残留、未保存就关掉的窗口）。
 * 启动时只提示这一类；有正式报告的草稿下次打开报告时会自动接回来。
 */
export function orphanDrafts(entries: DraftEntry[]): DraftEntry[] {
	return entries.filter((entry) => !entry.hasSavedCopy);
}

/** 丢弃一份草稿（用户明确不要了） */
export async function discardDraft(root: string, folder: string): Promise<void> {
	await removeReportDir(root, DRAFT_AREA, folder).catch(() => {});
}

/** 列出一个数据目录下的所有模板，按最后修改时间倒序 */
export async function listTemplates(root: string): Promise<TemplateEntry[]> {
	const metas = await listReportMeta(root, TEMPLATE_AREA).catch(() => []);
	const entries: TemplateEntry[] = metas.map((meta) => ({
		root,
		folder: meta.folder,
		name: meta.reportName || "未命名模板",
		updatedAt: meta.updatedAt,
	}));
	return entries.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 删除一个模板（用户主动删，整个目录连同 media 一起删） */
export async function removeTemplate(root: string, folder: string): Promise<void> {
	await removeReportDir(root, TEMPLATE_AREA, folder).catch(() => {});
}

/** 所有数据目录下的草稿（聚合，供抽屉和启动提示用） */
export async function listDraftsInAllDirs(): Promise<DraftEntry[]> {
	await ensurePreferencesLoaded();
	const lists = await Promise.all(
		dataDirsStore.getState().dirs.map((dir) => listDrafts(dir.path).catch(() => [] as DraftEntry[])),
	);
	return lists.flat().sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 所有数据目录下的模板 */
export async function listTemplatesInAllDirs(): Promise<TemplateEntry[]> {
	await ensurePreferencesLoaded();
	const lists = await Promise.all(
		dataDirsStore
			.getState()
			.dirs.map((dir) => listTemplates(dir.path).catch(() => [] as TemplateEntry[])),
	);
	return lists.flat().sort((a, b) => b.updatedAt - a.updatedAt);
}
