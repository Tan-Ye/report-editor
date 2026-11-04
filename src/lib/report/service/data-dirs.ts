/**
 * 数据目录（一套报告库）：选择、增删、设默认、迁移当前报告。
 */
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getIdentifier } from "@tauri-apps/api/app";
import { join } from "@tauri-apps/api/path";
import { toast } from "@/components/ui/toast";
import { dataDirsStore, reportStore } from "@/store";
import { isSamePath } from "../../utils";
import { ensurePreferencesLoaded, savePreferencesNow } from "../../ui-preferences";
import { moveReportDir } from "./storage";
import { getCurrentReportRoot, getCurrentReportRelativeDir, toErrorMessage } from "./context";

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
