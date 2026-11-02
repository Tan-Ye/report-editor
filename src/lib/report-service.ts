import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "@/components/ui/toast";
import {
	applyReportFile,
	createReportInfo,
	historyStore,
	pageStore,
	parseReportFile,
	reportStore,
	saveStateStore,
	toReportFile,
	type ReportFile,
} from "@/store";
import { getReportFolderName, type ReportArea } from "./report-path";
import {
	copyMediaDir,
	ensureArea,
	ensureReportFolder,
	getAbsolutePath,
	getFolderJsonPath,
	getReportUpdatedAt,
	listReportFolders,
	readReportJson,
	removeReportDir,
	removeUnreferencedMedia,
	renameReportDir,
	writeJsonAtomically,
} from "./report-storage";

/** 报告列表项 */
export interface ReportSummary {
	reportId: string;
	reportName: string;
	folder: string;
	updatedAt: number | null;
}

/** 已保存报告统一放 data，未保存的草稿放 cache */
const SAVED_AREA: ReportArea = "data";
const DRAFT_AREA: ReportArea = "cache";

/**
 * 当前报告在应用数据目录下的相对路径（`data/xxx` 或 `cache/xxx`）。
 * 导入媒体文件时要用它决定放到哪个报告目录里。
 */
export async function getCurrentReportDir(): Promise<string> {
	const { reportName, reportId } = reportStore.state;
	const area: ReportArea = saveStateStore.getState().persisted ? SAVED_AREA : DRAFT_AREA;
	const folder =
		(await findReportFolder(area, reportId)) ?? getReportFolderName(reportName, reportId);
	return `${area}/${folder}`;
}

/**
 * 从文件内容里收集引用到的媒体文件名（`media/<name>` → `<name>`）。
 * 保存后按这个集合清理 media 目录，换图留下的旧文件就不会越攒越多。
 */
function collectMediaReferences(file: ReportFile): Set<string> {
	const names = new Set<string>();
	const addFill = (fill: unknown) => {
		if (typeof fill !== "object" || fill === null) {
			return;
		}
		const spec = fill as { kind?: unknown; source?: unknown };
		if (spec.kind !== "image" || typeof spec.source !== "string") {
			return;
		}
		const name = spec.source.split("/").pop();
		if (name) {
			names.add(name);
		}
	};
	for (const page of file.pages) {
		addFill(page.style?.fill);
		for (const element of page.elements) {
			addFill(element.attrs.fill);
		}
	}
	return names;
}

/**
 * 同步定格当前文档为 JSON。
 * 必须在任何 await 之前调用：点了保存之后用户还会继续编辑，
 * 等到 IO 的时候再序列化就会存出"混合状态"。
 */
function captureDocumentJson(): string {
	return JSON.stringify(toReportFile(), null, 2);
}

/**
 * 保存报告。
 * - 草稿只存在于 cache；第一次成功保存后落到 data 并清掉草稿
 * - 保存中再次触发不会并发写，只会保证这一轮结束后再存一次
 */
export async function saveReport(): Promise<void> {
	const state = saveStateStore.getState();
	if (state.saving) {
		// 正在写盘：置脏即可，本轮结束会自动再存一次
		saveStateStore.markDirty();
		return;
	}

	const { reportName, reportId } = reportStore.state;
	// 同步定格：文件对象和 JSON 用同一份，清理孤儿媒体时也以它为准
	const file = toReportFile();
	const json = JSON.stringify(file, null, 2);
	const revision = saveStateStore.beginSave();

	try {
		await ensureArea(SAVED_AREA);
		// 已经有目录就写在原目录里：改名后统一在写完之后 relocate，
		// 否则会先建出一个新名字的目录、再把旧目录改名失败，最后留下两份
		const folder =
			(await findReportFolder(SAVED_AREA, reportId)) ??
			getReportFolderName(reportName, reportId);
		await ensureReportFolder(SAVED_AREA, folder);
		// 草稿阶段的图片存在 cache，保存后 cache 目录会被清掉，先把媒体文件搬过来
		const draftFolder = await findReportFolder(DRAFT_AREA, reportId);
		if (draftFolder) {
			await copyMediaDir(
				`${DRAFT_AREA}/${draftFolder}/media`,
				`${SAVED_AREA}/${folder}/media`,
			);
		}
		await writeJsonAtomically(getFolderJsonPath(SAVED_AREA, folder), json);
		await relocateFolderToMatchName(folder, reportName, reportId);
		// 清理不再被引用的媒体文件（目录可能刚被改名，重新定位一次）
		const finalFolder = (await findReportFolder(SAVED_AREA, reportId)) ?? folder;
		await removeUnreferencedMedia(SAVED_AREA, finalFolder, collectMediaReferences(file));
		await removeDraftFolder(reportId);
		saveStateStore.endSave(revision);
		toast.add({ title: "保存成功", type: "success" });
	} catch (error) {
		const message = toErrorMessage(error);
		saveStateStore.failSave(message);
		toast.add({ title: "保存失败", description: message, type: "error" });
		return;
	}

	// 保存期间文档又变了：再存一次
	if (saveStateStore.isDirty()) {
		void saveReport();
	}
}

/**
 * 草稿自动保存。
 * 已保存过的报告不做草稿（按需求只保护"从未保存过"的内容）。
 */
export async function saveDraft(): Promise<void> {
	if (saveStateStore.getState().persisted || saveStateStore.getState().saving) {
		return;
	}

	const { reportName, reportId } = reportStore.state;
	const json = captureDocumentJson();
	try {
		await ensureArea(DRAFT_AREA);
		// 同样按 id 复用已有草稿目录，改名不会攒出多个
		const folder =
			(await findReportFolder(DRAFT_AREA, reportId)) ??
			getReportFolderName(reportName, reportId);
		await ensureReportFolder(DRAFT_AREA, folder);
		await writeJsonAtomically(getFolderJsonPath(DRAFT_AREA, folder), json);
	} catch {
		// 草稿写失败不打扰用户，下次改动会再试
	}
}

/**
 * 报告改名后把目录名同步过来。
 * 目录名只是给人看的标签，真正的身份是 report.json 里的 reportId，
 * 所以改名失败也不影响打开，下次保存会再试。
 */
async function relocateFolderToMatchName(
	folder: string,
	reportName: string,
	reportId: string,
): Promise<void> {
	const desired = getReportFolderName(reportName, reportId);
	if (folder === desired) {
		return;
	}
	try {
		await renameReportDir(folder, desired);
	} catch {
		// 目标已存在或被占用：保留旧目录名
	}
}

/** 按 reportId 找出报告实际所在的目录 */
async function findReportFolder(area: ReportArea, reportId: string): Promise<string | null> {
	const folders = await listReportFolders(area);
	for (const folder of folders) {
		try {
			const parsed = JSON.parse(await readReportJson(area, folder)) as { reportId?: unknown };
			if (parsed.reportId === reportId) {
				return folder;
			}
		} catch {
			// 坏文件跳过，不影响其它目录
		}
	}
	return null;
}

/** 保存成功后清掉这份报告遗留的草稿目录 */
async function removeDraftFolder(reportId: string): Promise<void> {
	const folder = await findReportFolder(DRAFT_AREA, reportId);
	if (folder) {
		await removeReportDir(DRAFT_AREA, folder);
	}
}

/** 列出已保存的报告，按最后修改时间倒序 */
export async function listSavedReports(): Promise<ReportSummary[]> {
	await ensureArea(SAVED_AREA);
	const folders = await listReportFolders(SAVED_AREA);
	const reports: ReportSummary[] = [];

	for (const folder of folders) {
		try {
			const raw = await readReportJson(SAVED_AREA, folder);
			const parsed = JSON.parse(raw) as { reportId?: unknown; reportName?: unknown };
			if (typeof parsed.reportId !== "string" || !parsed.reportId) {
				continue;
			}
			reports.push({
				reportId: parsed.reportId,
				reportName: typeof parsed.reportName === "string" ? parsed.reportName : "",
				folder,
				updatedAt: await getReportUpdatedAt(SAVED_AREA, folder),
			});
		} catch {
			// 单个目录坏了就跳过，不让整个列表打不开
		}
	}

	return reports.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/** 打开一份已保存的报告 */
export async function openReport(folder: string, options: { silent?: boolean } = {}): Promise<void> {
	try {
		const raw = await readReportJson(SAVED_AREA, folder);
		const result = parseReportFile(JSON.parse(raw));
		applyReportFile(result.file);
		// 换了文档：历史清空，保存状态重置为"已保存且干净"
		historyStore.reset();
		saveStateStore.reset(true);
		// 打开别的报告时，之前的草稿没有意义了
		await clearDrafts();
		if (!options.silent) {
			toast.add({ title: `已打开「${result.file.reportName || "未命名报告"}」`, type: "success" });
		}
		if (result.warnings.length > 0) {
			toast.add({
				title: "文件有部分内容被修正",
				description: result.warnings.slice(0, 3).join("；"),
				type: "warning",
			});
		}
	} catch (error) {
		toast.add({ title: "打开失败", description: toErrorMessage(error), type: "error" });
	}
}

/** 清空全部草稿（打开报告后调用） */
async function clearDrafts(): Promise<void> {
	const folders = await listReportFolders(DRAFT_AREA);
	for (const folder of folders) {
		await removeReportDir(DRAFT_AREA, folder);
	}
}

/** 新建一份空报告：清空页面、重置历史与保存状态 */
export function createNewReport(options: { silent?: boolean } = {}): void {
	reportStore.reset(createReportInfo("未命名报告"));
	pageStore.replacePages([], 0);
	historyStore.reset();
	saveStateStore.reset(false);
	if (!options.silent) {
		toast.add({ title: "已新建报告", type: "info" });
	}
}

/**
 * 启动时恢复：打开数据目录里最近修改的一份报告。
 * 只有一份都没有的时候才新建 —— 也就是"数据目录里没有报告文件"这一种情况。
 */
export async function restoreLastReport(): Promise<void> {
	try {
		const reports = await listSavedReports();
		const latest = reports[0];
		if (latest) {
			await openReport(latest.folder, { silent: true });
			return;
		}
	} catch (error) {
		toast.add({ title: "读取历史报告失败", description: toErrorMessage(error), type: "error" });
	}
	// 首次启动或目录为空
	createNewReport({ silent: true });
}

/** 数据目录的绝对路径（抽屉里展示） */
export async function getDataDirPath(): Promise<string> {
	return getAbsolutePath(SAVED_AREA);
}

/** 在文件管理器里定位数据目录 */
export async function revealDataDir(): Promise<void> {
	try {
		// 目录还不存在时先建出来，否则系统会拒绝定位一个不存在的路径
		await ensureArea(SAVED_AREA);
		await revealItemInDir(await getDataDirPath());
	} catch (error) {
		toast.add({ title: "无法打开目录", description: toErrorMessage(error), type: "error" });
	}
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
