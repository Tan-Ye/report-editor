/**
 * 报告本身：列表、打开、保存、新建、启动恢复。
 */
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "@/components/ui/toast";
import { applyReportFile, createReportInfo, dataDirsStore, historyStore, pageStore, reportStore, saveStateStore, toReportFile } from "@/store";
import { ensurePreferencesLoaded, getLastReport, rememberLastReport } from "../../ui-preferences";
import { startSpan } from "../../startup-timing";
import { getReportFolderName, type ReportArea } from "../path";
import { claimReport, releaseHeldReport } from "./session";
import { openDraft } from "./draft";
import { summarizeIssues, validateReportJson } from "../validate";
import { copyMediaDir, ensureArea, ensureReportFolder, getAbsolutePath, getFolderJsonPath, getReportUpdatedAt, hasReportFile, listReportMeta, readReportJson, removeReportDir, removeUnreferencedMedia, renamePath, renameReportDir, writeJsonAtomically } from "./storage";
import { SAVED_AREA, DRAFT_AREA, getStorageRoot, getCurrentReportRoot, collectMediaReferences, findReportFolder, toErrorMessage } from "./context";

export interface ReportSummary {
	reportId: string;
	reportName: string;
	folder: string;
	/** 这份报告所在的数据目录（绝对路径） */
	root: string;
	updatedAt: number | null;
}

/** 已保存报告放 data，未保存的草稿放 cache，模板放 templates */

export async function listReportsInAllDirs(): Promise<ReportSummary[]> {
	const span = startSpan("list-saved-all");
	await ensurePreferencesLoaded();
	const dirs = dataDirsStore.getState().dirs;
	const lists = await Promise.all(
		dirs.map((dir) => listSavedReports(dir.path).catch(() => [] as ReportSummary[])),
	);
	span.end(`${dirs.length} 个数据目录`);
	return lists.flat().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
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
		// 写回报告**自己所在的**目录：它可能是从自定义数据目录打开的，
		// 用默认目录会在那边多出一份副本，草稿/媒体也找不到
		const root = await getCurrentReportRoot();
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
		rememberLastReport({ root, area: "data", folder: finalFolder, reportId });
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
		await renameReportDir(root, SAVED_AREA, folder, desired);
	} catch {
		// 目标已存在或被占用：保留旧目录名
	}
}

/** 按 reportId 找出报告实际所在的目录 */

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
	// 一次 Rust 调用拿回所有摘要，不再逐个目录读 JSON + mtime
	const metas = await listReportMeta(actualRoot, SAVED_AREA);
	return metas
		.map((meta) => ({
			reportId: meta.reportId,
			reportName: meta.reportName,
			folder: meta.folder,
			root: actualRoot,
			updatedAt: meta.updatedAt || null,
		}))
		.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/** 打开一份已保存的报告 */

export async function openReport(
	folder: string,
	options: { silent?: boolean; root?: string } = {},
): Promise<void> {
	const root = options.root ?? (await getStorageRoot());
	const openSpan = startSpan("open-report");
	try {
		const readSpan = startSpan("read-report-json");
		const raw = await readReportJson(root, SAVED_AREA, folder);
		readSpan.end(`${Math.round(raw.length / 1024)}KB`);
		// 用校验入口而不是直接 parse：这样"未注册类型""版本过新"这类问题也能提示出来
		const validation = validateReportJson(raw);
		if (!validation.file) {
			throw new Error(summarizeIssues(validation) || "报告内容无法解析");
		}
		const file = validation.file;
		// 抢占用：同一份报告不能同时开在两个窗口里（否则保存和会话会互相覆盖）
		const claimSpan = startSpan("claim-report");
		const claim = await claimReport(file.reportId);
		claimSpan.end(claim.claimed ? "ok" : "被占用");
		if (!claim.claimed) {
			// 窗口标签是 report-1730… 这种内部名字，给用户看没有意义
			throw new Error("这份报告已在另一个窗口打开，请先关掉那个窗口");
		}
		await releaseHeldReport(file.reportId);
		// 先定下"我在哪、算不算已保存"，再换内容：
		// 换内容会立刻重建画布，而画布会按这两个信息去读图片（见 media.loadMediaImage），
		// 顺序反了第一遍会去默认目录 / cache 里找图，图就白了
		reportStore.setRootPath(root);
		saveStateStore.reset(true);
		const applySpan = startSpan("apply-report-file");
		applyReportFile(file);
		applySpan.end(`${file.pages.length} 页`);
		// 记住"上次打开的是这份"：启动恢复直接按它开，不用扫目录
		rememberLastReport({ root, area: "data", folder, reportId: file.reportId });

		// 有比正式文件更新的草稿 = 上次是异常退出（或崩溃），把改动接回来
		const draftSpan = startSpan("read-newer-draft");
		const draft = await readNewerDraft(root, file.reportId);
		draftSpan.end(draft ? "有更新的草稿" : "无");
		const restored = draft ? validateReportJson(draft) : null;
		if (restored?.file) {
			applyReportFile(restored.file);
		}

		// 换了文档：历史清空
		historyStore.reset();
		if (restored?.file) {
			// 草稿内容还没进正式文件：标脏，这样关窗口会提示、Ctrl+S 会覆盖写回。
			// 不能靠 historyStore.commit() —— 它刚在 reset() 里把当前状态记成基准，
			// 内容没变时是个空操作，脏标记根本标不上。
			saveStateStore.markDirty();
		}

		// 只清这份报告自己的草稿：别人的草稿还要留着下次恢复。
		// 刚恢复出来的那份先留着 —— 在自动保存接手之前它是内存里唯一的一份，
		// 留着才有后悔药（保存成功时 saveReport 会一起清掉）
		if (file.reportId && !restored?.file) {
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
		openSpan.end(`${folder} · 成功`);
	} catch (error) {
		openSpan.end(`${folder} · 失败`);
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
	// 新报告还没落盘：指针先清掉，等自动存草稿时再指向 cache
	rememberLastReport(null);
	if (!options.silent) {
		toast.add({ title: "已新建报告", type: "info" });
	}
}

/**
 * 启动恢复：优先按「上次打开的报告」指针直接开。
 *
 * 只有指针不存在（首次启动/老版本升级）才回退去扫所有数据目录 ——
 * 正常启动就一次偏好读取 + 一次读文件，不再为每份报告各读一遍 JSON。
 */
export async function restoreLastReport(): Promise<void> {
	const span = startSpan("restore-last-report");
	try {
		await ensurePreferencesLoaded();
		const last = getLastReport();
		if (last) {
			const area = last.area === "cache" ? DRAFT_AREA : SAVED_AREA;
			const exists = await hasReportFile(last.root, area, last.folder).catch(() => false);
			if (exists) {
				if (last.area === "cache") {
					if (await openDraft(last.root, last.folder, { silent: true })) {
						span.end("指针 · 草稿");
						return;
					}
				} else {
					await openReport(last.folder, { silent: true, root: last.root });
					if (reportStore.state.reportId === last.reportId) {
						span.end("指针 · 正式报告");
						return;
					}
				}
			}
			// 文件被删/挪走：指针作废，下面回退扫描
			rememberLastReport(null);
		}

		// 没有指针才扫（首次启动、升级后的第一次）
		const reports = await listReportsInAllDirs();
		const latest = reports[0];
		if (latest) {
			await openReport(latest.folder, { silent: true, root: latest.root });
			span.end(`回退扫描 · ${reports.length} 份`);
			return;
		}
		span.end("无报告 · 新建");
	} catch (error) {
		span.end("失败");
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
