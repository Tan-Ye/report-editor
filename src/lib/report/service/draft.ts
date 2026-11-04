/**
 * 草稿：自动保存到 cache、打开、丢弃。
 */
import { toast } from "@/components/ui/toast";
import { applyReportFile, historyStore, reportStore, saveStateStore } from "@/store";
import { getReportFolderName } from "../path";
import { discardDraft } from "./library";
import { openNewReportWindow } from "./window";
import { claimReport, releaseHeldReport } from "./session";
import { summarizeIssues, validateReportJson } from "../validate";
import { ensureArea, ensureReportFolder, getFolderJsonPath, readReportJson, writeJsonAtomically } from "./storage";
import { SAVED_AREA, DRAFT_AREA, getStorageRoot, getCurrentReportRoot, captureDocumentJson, findReportFolder, toErrorMessage } from "./context";

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
		// 和保存一样跟着报告走：草稿必须和它的正式文件在同一个数据目录里，
		// 否则保存时搬媒体会在错的目录里找，草稿箱也会列成两份
		const root = await getCurrentReportRoot();
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
 * 打开一份草稿（`cache/` 里的内容）。
 *
 * 和 openReport 的区别：草稿还没进正式文件，所以打开后**一定是脏的** ——
 * 用户按 Ctrl+S 才会写进 `data/`，在那之前自动保存继续写回同一份草稿目录。
 *
 * 打开时不删草稿：删了就没有后悔药了（用户可能只是想看一眼）。
 * 真正的删除只发生在「保存成功」（saveReport）和「关窗口选不保存」（discardCurrentDraft）。
 */
export async function openDraft(
	root: string,
	folder: string,
	options: { silent?: boolean } = {},
): Promise<boolean> {
	try {
		const actualRoot = root || (await getStorageRoot());
		const raw = await readReportJson(actualRoot, DRAFT_AREA, folder);
		const validation = validateReportJson(raw);
		if (!validation.file) {
			throw new Error(summarizeIssues(validation) || "草稿内容无法解析");
		}
		const file = validation.file;
		// 草稿里的 reportId 和正式报告是同一个：已经在别的窗口打开时照样不能进
		const claim = await claimReport(file.reportId);
		if (!claim.claimed) {
			throw new Error("这份内容已在另一个窗口打开，请先关掉那个窗口");
		}
		await releaseHeldReport(file.reportId);
		// data/ 里有没有同 id 的正式报告，决定"我在哪"：
		// 有正式报告时图片本来就在 data 里，继续从那儿读；
		// 没有（孤儿草稿）时图片在 cache 里，保存时再和 JSON 一起搬过去
		const savedFolder = await findReportFolder(actualRoot, SAVED_AREA, file.reportId);
		// 先定下位置和保存状态，再换内容 —— 换内容会立刻重建画布并按它读图片
		reportStore.setRootPath(actualRoot);
		saveStateStore.reset(Boolean(savedFolder));
		applyReportFile(file);
		historyStore.reset();
		// 内容还没写进正式文件：标脏，关窗口才会问、Ctrl+S 才会写回
		saveStateStore.markDirty();

		if (!options.silent) {
			toast.add({
				title: `已恢复「${file.reportName || "未命名报告"}」`,
				description: "这是还没保存的内容，Ctrl+S 才会写进正式文件",
				type: "info",
			});
		}
		if (validation.issues.length > 0) {
			toast.add({
				title: "草稿有部分内容被修正",
				description: summarizeIssues(validation),
				type: "warning",
			});
		}
		return true;
	} catch (error) {
		toast.add({ title: "打开未保存的内容失败", description: toErrorMessage(error), type: "error" });
		return false;
	}
}

/**
 * 在新窗口打开一份草稿。
 *
 * 窗口之间不共享内存，所以只能把「打开哪份草稿」写进新窗口的 URL，
 * 由新窗口自己在 useRestoreReport 里解析。
 */
export async function openDraftInNewWindow(entry: {
	root: string;
	folder: string;
}): Promise<boolean> {
	try {
		await openNewReportWindow({ area: "draft", folder: entry.folder, root: entry.root });
		return true;
	} catch (error) {
		toast.add({ title: "新窗口打开失败", description: toErrorMessage(error), type: "error" });
		return false;
	}
}

/**
 * 丢弃当前报告的草稿（关窗口选「不保存」时调用）。
 *
 * 不删的话，下次打开同一份报告会把它当成"崩溃残留"恢复回来 ——
 * 用户明明选了不保存，改动却自己回来了。所以两种报告都删：
 * 已保存过的报告只是丢掉未保存的改动，正式文件还在原处。
 */
export async function discardCurrentDraft(): Promise<void> {
	const { reportId } = reportStore.state;
	if (!reportId) {
		return;
	}
	try {
		const root = await getCurrentReportRoot();
		const folder = await findReportFolder(root, DRAFT_AREA, reportId);
		if (folder) {
			await discardDraft(root, folder);
		}
	} catch {
		// 清理是尽力而为：删不掉也不能拦住关窗口
	}
}
