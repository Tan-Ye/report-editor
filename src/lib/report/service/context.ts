/**
 * 报告服务的共享上下文：存储根、当前报告目录、媒体引用、JSON 定格。
 */
import { dataDirsStore, reportStore, saveStateStore, toReportFile, type ReportFile } from "@/store";
import { ensurePreferencesLoaded } from "../../ui-preferences";
import { getReportFolderName, type ReportArea } from "../path";
import { getAbsolutePath, getAppDataRoot, listReportFolders, readReportJson } from "./storage";

export const SAVED_AREA: ReportArea = "data";

export const DRAFT_AREA: ReportArea = "cache";

export const TEMPLATE_AREA: ReportArea = "templates";

/**
 * 当前报告所在的存储根（绝对路径）。
 *
 * 优先用报告自己记录的位置；新报告用"默认数据目录"。
 * 会先等偏好文件加载完 —— 数据目录列表存在那里。
 */
export async function getStorageRoot(): Promise<string> {
	await ensurePreferencesLoaded();
	return dataDirsStore.getDefaultPath() || (await getAppDataRoot());
}

/** 所有数据目录下的报告，按最后修改时间倒序 */

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
export function collectMediaReferences(file: ReportFile): Set<string> {
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
export function captureDocumentJson(): string {
	return JSON.stringify(toReportFile(), null, 2);
}

export async function findReportFolder(
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

export function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
