import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getIdentifier } from "@tauri-apps/api/app";
import { join } from "@tauri-apps/api/path";
import { toast } from "@/components/ui/toast";
import {
	applyReportFile,
	createReportInfo,
	dataDirsStore,
	historyStore,
	pageStore,
	reportStore,
	saveStateStore,
	toReportFile,
	type ReportFile,
} from "@/store";
import { isSamePath } from "./utils";
import { ensurePreferencesLoaded, savePreferencesNow } from "./ui-preferences";
import { getReportFolderName, type ReportArea } from "./report-path";
import { claimReport, releaseHeldReport } from "./report-session";
import { summarizeIssues, validateReportJson } from "./report-validate";
import {
	copyMediaDir,
	ensureArea,
	ensureReportFolder,
	getAbsolutePath,
	getAppDataRoot,
	getFolderJsonPath,
	getReportUpdatedAt,
	hasReportFile,
	listReportFolders,
	moveReportDir,
	readReportJson,
	removeReportDir,
	removeUnreferencedMedia,
	renamePath,
	renameReportDir,
	writeJsonAtomically,
} from "./report-storage";

/** 报告列表项 */
export interface ReportSummary {
	reportId: string;
	reportName: string;
	folder: string;
	/** 这份报告所在的数据目录（绝对路径） */
	root: string;
	updatedAt: number | null;
}

/** 已保存报告统一放 data，未保存的草稿放 cache */
const SAVED_AREA: ReportArea = "data";
const DRAFT_AREA: ReportArea = "cache";

/**
 * 当前报告所在的存储根（绝对路径）。
 *
 * 优先用报告自己记录的位置；新报告用"默认数据目录"。
 * 会先等偏好文件加载完 —— 数据目录列表存在那里。
 */
async function getStorageRoot(): Promise<string> {
	await ensurePreferencesLoaded();
	return dataDirsStore.getDefaultPath() || (await getAppDataRoot());
}

/** 所有数据目录下的报告，按最后修改时间倒序 */
export async function listReportsInAllDirs(): Promise<ReportSummary[]> {
	await ensurePreferencesLoaded();
	const dirs = dataDirsStore.getState().dirs;
	const lists = await Promise.all(
		dirs.map((dir) => listSavedReports(dir.path).catch(() => [] as ReportSummary[])),
	);
	return lists.flat().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/**
 * 选择数据目录（系统文件夹对话框）。
 *
 * 用户选的是"外层文件夹"，真正的数据根是它下面的**应用标识目录**
 * （`report-editor`）：这样同一个文件夹可以放多个应用的数据，
 * 也避免把 data/、cache/ 直接摊在用户选中的目录里。
 */
export async function pickDataDirectory(): Promise<string | null> {
	const selected = await openDialog({ directory: true, multiple: false });
	if (typeof selected !== "string") {
		return null;
	}
	const trimmed = selected.replace(/[\\/]+$/, "");
	const identifier = await getIdentifier();
	// 用户已经选到标识目录里了，就不再套一层
	const last = trimmed.split(/[\\/]/).pop() ?? "";
	if (last.toLowerCase() === identifier.toLowerCase()) {
		return trimmed;
	}
	return join(trimmed, identifier);
}

/** 添加数据目录并落盘 */
export async function addDataDir(path: string): Promise<boolean> {
	await ensurePreferencesLoaded();
	const added = dataDirsStore.addDir(path);
	if (added) {
		await savePreferencesNow();
	}
	return added;
}

/** 移除数据目录（只从列表移除，磁盘文件不动） */
export async function removeDataDir(path: string): Promise<boolean> {
	await ensurePreferencesLoaded();
	const removed = dataDirsStore.removeDir(path);
	if (removed) {
		await savePreferencesNow();
	}
	return removed;
}

/** 设置默认数据目录（新建报告落这里） */
export async function setDefaultDataDir(path: string): Promise<boolean> {
	await ensurePreferencesLoaded();
	const changed = dataDirsStore.setDefaultDir(path);
	if (changed) {
		await savePreferencesNow();
	}
	return changed;
}

/**
 * 把当前报告迁移到另一个数据目录（切换默认目录后用户选择「迁移」时调用）。
 * 迁移的是已保存的报告：草稿没有迁移的意义，它保存时自然会落到新目录。
 */
export async function moveCurrentReportTo(root: string): Promise<boolean> {
	const currentRoot = await getCurrentReportRoot();
	if (isSamePath(currentRoot, root)) {
		return false;
	}
	try {
		const relative = await getCurrentReportRelativeDir();
		await moveReportDir(currentRoot, relative, root, relative);
		reportStore.setRootPath(root);
		toast.add({ title: "报告已迁移", type: "success" });
		return true;
	} catch (error) {
		toast.add({ title: "迁移失败", description: toErrorMessage(error), type: "error" });
		return false;
	}
}

/**
 * 当前报告所在存储根的绝对路径。
 * 已落盘的报告用它的目录；还没保存过的新报告用默认目录。
 */
export async function getCurrentReportRoot(): Promise<string> {
	return reportStore.rootPath ?? (await getStorageRoot());
}

/** 当前报告相对存储根的目录（`data/xxx` 或 `cache/xxx`） */
export async function getCurrentReportRelativeDir(): Promise<string> {
	const { reportName, reportId } = reportStore.state;
	const root = await getCurrentReportRoot();
	const area: ReportArea = saveStateStore.getState().persisted ? SAVED_AREA : DRAFT_AREA;
	const folder =
		(await findReportFolder(root, area, reportId)) ?? getReportFolderName(reportName, reportId);
	return `${area}/${folder}`;
}

/**
 * 当前报告在磁盘上的**绝对目录**。
 * 导入媒体文件、读图片都基于它。
 */
export async function getCurrentReportDir(): Promise<string> {
	return getAbsolutePath(await getCurrentReportRoot(), await getCurrentReportRelativeDir());
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
		const root = await getStorageRoot();
		await ensureArea(root, SAVED_AREA);
		// 已经有目录就写在原目录里：改名后统一在写完之后 relocate，
		// 否则会先建出一个新名字的目录、再把旧目录改名失败，最后留下两份
		const folder =
			(await findReportFolder(root, SAVED_AREA, reportId)) ??
			getReportFolderName(reportName, reportId);
		await ensureReportFolder(root, SAVED_AREA, folder);
		// 覆盖前留一份上一版：原子写能防"写一半崩掉"，但防不了"存进了一份坏内容"
		await backupReportFile(root, SAVED_AREA, folder);
		// 草稿阶段的图片存在 cache，保存后 cache 目录会被清掉，先把媒体文件搬过来
		const draftFolder = await findReportFolder(root, DRAFT_AREA, reportId);
		if (draftFolder) {
			await copyMediaDir(
				root,
				`${DRAFT_AREA}/${draftFolder}/media`,
				`${SAVED_AREA}/${folder}/media`,
			);
		}
		await writeJsonAtomically(root, getFolderJsonPath(SAVED_AREA, folder), json);
		await relocateFolderToMatchName(root, folder, reportName, reportId);
		// 清理不再被引用的媒体文件（目录可能刚被改名，重新定位一次）
		const finalFolder = (await findReportFolder(root, SAVED_AREA, reportId)) ?? folder;
		await removeUnreferencedMedia(
			root,
			SAVED_AREA,
			finalFolder,
			collectMediaReferences(file),
		);
		await removeDraftFolder(root, reportId);
		// 记下这份报告落在哪个目录：新建的报告第一次保存后才算有了归属
		reportStore.setRootPath(root);
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
 *
 * **已保存的报告也写草稿**：以前只保护"从未保存过"的内容，结果改了一小时没按 Ctrl+S、
 * 程序崩了就全丢。现在草稿对两种报告一视同仁 —— 保存成功后草稿会被清掉，
 * 下次改动再重新攒。
 *
 * 写的是 `cache/<报告目录>/report.json`，和正式文件同一个相对路径，
 * 所以恢复时不用做任何结构转换。
 */
export async function saveDraft(): Promise<void> {
	if (saveStateStore.getState().saving) {
		return;
	}

	const { reportName, reportId } = reportStore.state;
	const json = captureDocumentJson();
	try {
		const root = await getStorageRoot();
		await ensureArea(root, DRAFT_AREA);
		// 同样按 id 复用已有草稿目录，改名不会攒出多个
		const folder =
			(await findReportFolder(root, DRAFT_AREA, reportId)) ??
			getReportFolderName(reportName, reportId);
		await ensureReportFolder(root, DRAFT_AREA, folder);
		await writeJsonAtomically(root, getFolderJsonPath(DRAFT_AREA, folder), json);
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
	root: string,
	folder: string,
	reportName: string,
	reportId: string,
): Promise<void> {
	const desired = getReportFolderName(reportName, reportId);
	if (folder === desired) {
		return;
	}
	try {
		await renameReportDir(root, folder, desired);
	} catch {
		// 目标已存在或被占用：保留旧目录名
	}
}

/** 按 reportId 找出报告实际所在的目录 */
async function findReportFolder(
	root: string,
	area: ReportArea,
	reportId: string,
): Promise<string | null> {
	const folders = await listReportFolders(root, area);
	for (const folder of folders) {
		try {
			const parsed = JSON.parse(await readReportJson(root, area, folder)) as {
				reportId?: unknown;
			};
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
async function removeDraftFolder(root: string, reportId: string): Promise<void> {
	const folder = await findReportFolder(root, DRAFT_AREA, reportId);
	if (folder) {
		await removeReportDir(root, DRAFT_AREA, folder);
	}
}

/** 列出已保存的报告，按最后修改时间倒序 */
export async function listSavedReports(root?: string): Promise<ReportSummary[]> {
	const actualRoot = root ?? (await getStorageRoot());
	await ensureArea(actualRoot, SAVED_AREA);
	const folders = await listReportFolders(actualRoot, SAVED_AREA);
	const reports: ReportSummary[] = [];

	for (const folder of folders) {
		try {
			const raw = await readReportJson(actualRoot, SAVED_AREA, folder);
			const parsed = JSON.parse(raw) as { reportId?: unknown; reportName?: unknown };
			if (typeof parsed.reportId !== "string" || !parsed.reportId) {
				continue;
			}
			reports.push({
				reportId: parsed.reportId,
				reportName: typeof parsed.reportName === "string" ? parsed.reportName : "",
				folder,
				root: actualRoot,
				updatedAt: await getReportUpdatedAt(actualRoot, SAVED_AREA, folder),
			});
		} catch {
			// 单个目录坏了就跳过，不让整个列表打不开
		}
	}

	return reports.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/** 打开一份已保存的报告 */
export async function openReport(
	folder: string,
	options: { silent?: boolean; root?: string } = {},
): Promise<void> {
	const root = options.root ?? (await getStorageRoot());
	try {
		const raw = await readReportJson(root, SAVED_AREA, folder);
		// 用校验入口而不是直接 parse：这样"未注册类型""版本过新"这类问题也能提示出来
		const validation = validateReportJson(raw);
		if (!validation.file) {
			throw new Error(summarizeIssues(validation) || "报告内容无法解析");
		}
		const file = validation.file;
		// 抢占用：同一份报告不能同时开在两个窗口里（否则保存和会话会互相覆盖）
		const claim = await claimReport(file.reportId);
		if (!claim.claimed) {
			throw new Error(
				`这份报告已在另一个窗口打开${claim.owner ? `（${claim.owner}）` : ""}，请先关掉那个窗口`,
			);
		}
		await releaseHeldReport(file.reportId);
		applyReportFile(file);
		reportStore.setRootPath(root);

		// 有比正式文件更新的草稿 = 上次是异常退出（或崩溃），把改动接回来
		const draft = await readNewerDraft(root, file.reportId);
		const restored = draft ? validateReportJson(draft) : null;
		if (restored?.file) {
			applyReportFile(restored.file);
			reportStore.setRootPath(root);
		}

		// 换了文档：历史清空，保存状态重置为"已保存且干净"
		historyStore.reset();
		saveStateStore.reset(true);
		if (restored?.file) {
			// 草稿内容还没进正式文件：标脏，这样关窗口会提示、Ctrl+S 会覆盖写回
			historyStore.commit();
		}

		// 只清这份报告自己的草稿：别人的草稿还要留着下次恢复
		if (file.reportId) {
			await removeDraftFolder(root, file.reportId);
		}

		if (!options.silent) {
			toast.add({ title: `已打开「${file.reportName || "未命名报告"}」`, type: "success" });
		}
		if (restored?.file) {
			toast.add({
				title: "已恢复未保存的修改",
				description: "上次退出时还有改动没保存，已从草稿恢复；Ctrl+S 写回正式文件",
				type: "info",
			});
		}
		if (validation.issues.length > 0) {
			toast.add({
				title: "文件有部分内容被修正",
				description: summarizeIssues(validation),
				type: "warning",
			});
		}
	} catch (error) {
		toast.add({ title: "打开失败", description: toErrorMessage(error), type: "error" });
	}
}

/**
 * 保存前把上一版留成 `report.json.bak`。
 *
 * 原子写只能防"写到一半崩掉"，防不了"存进去的内容本身是坏的"（比如某个 bug
 * 把元素清空了又按了保存）。留一份上一版，至少还能手工捡回来。
 */
async function backupReportFile(
	root: string,
	area: ReportArea,
	folder: string,
): Promise<void> {
	try {
		if (!(await hasReportFile(root, area, folder))) {
			return;
		}
		const json = `${area}/${folder}/report.json`;
		await renamePath(root, json, `${json}.bak`);
	} catch {
		// 备份失败不该拦住保存
	}
}

/**
 * 找这份报告的草稿，且必须**比正式文件新**。
 * 草稿每次自动保存都会刷新，所以「更新」基本等价于「上次没保存成功就退出了」。
 */
async function readNewerDraft(root: string, reportId: string): Promise<string | null> {
	const folder = await findReportFolder(root, DRAFT_AREA, reportId);
	if (!folder) {
		return null;
	}
	const draftTime = await getReportUpdatedAt(root, DRAFT_AREA, folder);
	if (!draftTime) {
		return null;
	}
	const savedFolder = await findReportFolder(root, SAVED_AREA, reportId);
	const savedTime = savedFolder ? await getReportUpdatedAt(root, SAVED_AREA, savedFolder) : 0;
	if (savedTime && draftTime <= savedTime) {
		// 草稿比正式文件旧：说明已经保存过了，这份草稿是残留
		await removeReportDir(root, DRAFT_AREA, folder);
		return null;
	}
	try {
		return await readReportJson(root, DRAFT_AREA, folder);
	} catch {
		return null;
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
 * 启动时恢复：打开所有数据目录里最近修改的一份报告。
 * 只有一份都没有的时候才新建 —— 也就是"数据目录里没有报告文件"这一种情况。
 */
export async function restoreLastReport(): Promise<void> {
	try {
		// 扫所有数据目录，不只是默认目录
		const reports = await listReportsInAllDirs();
		const latest = reports[0];
		if (latest) {
			await openReport(latest.folder, { silent: true, root: latest.root });
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
	const root = await getCurrentReportRoot();
	return getAbsolutePath(root, SAVED_AREA);
}

/** 在文件管理器里定位数据目录 */
export async function revealDataDir(): Promise<void> {
	try {
		const root = await getCurrentReportRoot();
		// 目录还不存在时先建出来，否则系统会拒绝定位一个不存在的路径
		await ensureArea(root, SAVED_AREA);
		await revealItemInDir(await getDataDirPath());
	} catch (error) {
		toast.add({ title: "无法打开目录", description: toErrorMessage(error), type: "error" });
	}
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
