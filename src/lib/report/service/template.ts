/**
 * 模板：把当前文档存成模板、用模板新建报告。
 */
import { toast } from "@/components/ui/toast";
import { applyReportFile, createReportInfo, historyStore, reportStore, saveStateStore, toReportFile, type ReportFile } from "@/store";
import { createUniqueId } from "../../utils";
import { REPORT_MEDIA_DIR, getReportFolderName } from "../path";
import { openNewReportWindow } from "./window";
import { claimReport, releaseHeldReport } from "./session";
import { summarizeIssues, validateReportJson } from "../validate";
import { copyMediaDir, getFolderJsonPath, readReportJson, removeUnreferencedMedia, writeJsonAtomically } from "./storage";
import { DRAFT_AREA, TEMPLATE_AREA, getStorageRoot, getCurrentReportRoot, getCurrentReportRelativeDir, collectMediaReferences, toErrorMessage } from "./context";
import { saveDraft } from "./draft";

/**
 * 把当前文档另存为模板。
 *
 * 模板有自己的 id，不是报告的副本：`reportId` 换成 `template-*`，
 * 这样目录名、列表都能独立管理，也不会和任何正式报告"配对"。
 *
 * 媒体文件一起复制进模板目录 —— 模板要能脱离原报告独立打开
 * （原报告删了、图片还在别处，模板里的图就丢了）。
 */
export async function saveAsTemplate(name: string): Promise<boolean> {
	const trimmed = name.trim() || "未命名模板";
	const templateId = createUniqueId("template");
	const folder = getReportFolderName(trimmed, templateId);
	// 同步定格：JSON 和媒体引用都按这一刻的文档算
	const file: ReportFile = { ...toReportFile(), reportId: templateId, reportName: trimmed };
	const json = JSON.stringify(file, null, 2);

	try {
		const root = await getCurrentReportRoot();
		// 当前文档的图可能在 data（保存过）也可能在 cache（还是草稿）
		const sourceMedia = `${await getCurrentReportRelativeDir()}/${REPORT_MEDIA_DIR}`;
		await copyMediaDir(root, sourceMedia, `${TEMPLATE_AREA}/${folder}/${REPORT_MEDIA_DIR}`);
		await writeJsonAtomically(root, getFolderJsonPath(TEMPLATE_AREA, folder), json);
		// 只留被引用到的图：复制是整个目录搬的，可能带上这张报告里已经换掉的旧图
		await removeUnreferencedMedia(root, TEMPLATE_AREA, folder, collectMediaReferences(file));
		toast.add({ title: `已保存模板「${trimmed}」`, type: "success" });
		return true;
	} catch (error) {
		toast.add({ title: "保存模板失败", description: toErrorMessage(error), type: "error" });
		return false;
	}
}

/**
 * 用模板新建一份报告。
 *
 * 关键点：**换一个新的 reportId**。模板只是"内容"，实例和模板共用 id 会让
 * 保存时互相覆盖（还可能在草稿箱里和模板自己配对）。
 *
 * 模板的媒体先复制进新报告的草稿目录：JSON 里的图片路径是相对报告目录的，
 * 不搬过来图片就会指向模板目录（甚至模板删了就全丢）。
 */
export async function openTemplate(
	root: string,
	folder: string,
	options: { silent?: boolean } = {},
): Promise<boolean> {
	try {
		const actualRoot = root || (await getStorageRoot());
		const raw = await readReportJson(actualRoot, TEMPLATE_AREA, folder);
		const validation = validateReportJson(raw);
		if (!validation.file) {
			throw new Error(summarizeIssues(validation) || "模板内容无法解析");
		}
		const template = validation.file;
		const info = createReportInfo(template.reportName || "未命名报告");
		const file: ReportFile = {
			...template,
			reportId: info.reportId,
			reportName: info.reportName,
		};

		const claim = await claimReport(info.reportId);
		if (!claim.claimed) {
			// 全新 id 正常不会撞，撞了说明登记表被占死，别硬来
			throw new Error("新建报告的占用登记失败，请重试");
		}
		await releaseHeldReport(info.reportId);

		// 新报告还没落盘，媒体先放进它的草稿目录（保存时再和 JSON 一起搬去 data）
		const draftFolder = getReportFolderName(info.reportName, info.reportId);
		await copyMediaDir(
			actualRoot,
			`${TEMPLATE_AREA}/${folder}/${REPORT_MEDIA_DIR}`,
			`${DRAFT_AREA}/${draftFolder}/${REPORT_MEDIA_DIR}`,
		);

		reportStore.setRootPath(actualRoot);
		saveStateStore.reset(false);
		applyReportFile(file);
		historyStore.reset();
		// 内容还没保存过：标脏，关窗口会问、Ctrl+S 才会落进 data
		saveStateStore.markDirty();
		// 立刻落一份草稿：媒体已经在草稿目录里了，草稿 JSON 得能用 reportId 找回来
		await saveDraft();

		if (!options.silent) {
			toast.add({
				title: `已套用模板「${info.reportName}」`,
				description: "当前窗口换成了一份还没保存的新报告，Ctrl+S 才会存进数据目录",
				type: "info",
			});
		}
		if (validation.issues.length > 0) {
			toast.add({
				title: "模板有部分内容被修正",
				description: summarizeIssues(validation),
				type: "warning",
			});
		}
		return true;
	} catch (error) {
		toast.add({ title: "打开模板失败", description: toErrorMessage(error), type: "error" });
		return false;
	}
}

/** 在新窗口用模板新建报告（目标写进 URL，由新窗口自己解析） */

export async function openTemplateInNewWindow(entry: {
	root: string;
	folder: string;
}): Promise<boolean> {
	try {
		await openNewReportWindow({ area: "template", folder: entry.folder, root: entry.root });
		return true;
	} catch (error) {
		toast.add({ title: "新窗口打开失败", description: toErrorMessage(error), type: "error" });
		return false;
	}
}
