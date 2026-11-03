import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import {
	REPORT_FILE_NAME,
	REPORT_MEDIA_DIR,
	getReportMediaDir,
	getReportMediaPath,
	type ReportArea,
} from "./report-path";

/**
 * 报告存储的 IO 全部走 Rust 命令。
 *
 * 为什么不直接用 `@tauri-apps/plugin-fs`：它的 scope 是编译期写死的（现在只有 `$APPDATA/**`），
 * 用户「自定义数据目录」选到 D 盘就读不了了，而 Tauri 不支持运行时扩 scope。
 * 放到 Rust 里用 std::fs 直接操作，路径限制一次性消失。
 *
 * 约定：`root` 是数据目录的绝对路径，其余参数都是相对它的路径。
 */

let appDataRoot: string | null = null;

/** 内置数据目录（应用数据目录）的绝对路径 */
export async function getAppDataRoot(): Promise<string> {
	if (!appDataRoot) {
		appDataRoot = await invoke<string>("app_data_dir");
	}
	return appDataRoot;
}

/** 相对路径 → 绝对路径：给界面展示、给"在文件夹中显示"用 */
export async function getAbsolutePath(root: string, relativePath: string): Promise<string> {
	return join(root, relativePath);
}

const call = <T>(command: string, args: Record<string, unknown>) => invoke<T>(command, args);

/** 确保某个存储区（data / cache）存在 */
export async function ensureArea(root: string, area: ReportArea): Promise<void> {
	await call("storage_mkdirs", { root, relative: area });
}

/** 确保某个报告目录（以及 media 子目录）存在 */
export async function ensureReportFolder(
	root: string,
	area: ReportArea,
	folder: string,
): Promise<void> {
	await call("storage_mkdirs", { root, relative: `${area}/${folder}/${REPORT_MEDIA_DIR}` });
}

/** 指定报告目录里 report.json 的相对路径 */
export function getFolderJsonPath(area: ReportArea, folder: string): string {
	return `${area}/${folder}/${REPORT_FILE_NAME}`;
}

/**
 * 原子写 JSON：Rust 侧先写 `.tmp` 再 rename。
 * 直接写目标文件的话，写到一半崩掉会把原报告写坏。
 */
export async function writeJsonAtomically(
	root: string,
	relativePath: string,
	content: string,
): Promise<void> {
	await call("storage_write_text", { root, relative: relativePath, content });
}

/**
 * 把一份报告目录从一个数据目录搬到另一个数据目录。
 * 跨盘时 rename 会失败，Rust 侧会自动退化成「递归复制 + 删除原目录」。
 */
export async function moveReportDir(
	fromRoot: string,
	fromRelative: string,
	toRoot: string,
	toRelative: string,
): Promise<void> {
	await invoke("storage_move_dir", {
		fromRoot,
		from: fromRelative,
		toRoot,
		to: toRelative,
	});
}

/** 按相对路径读文本 */
export async function readText(root: string, relativePath: string): Promise<string> {
	return call<string>("storage_read_text", { root, relative: relativePath });
}

/** 报告目录里是否已经有 report.json */
export async function hasReportFile(
	root: string,
	area: ReportArea,
	folder: string,
): Promise<boolean> {
	return call<boolean>("storage_exists", {
		root,
		relative: `${area}/${folder}/${REPORT_FILE_NAME}`,
	});
}

/** 列出某个存储区下的报告目录名 */
export async function listReportFolders(root: string, area: ReportArea): Promise<string[]> {
	return call<string[]>("storage_list_dirs", { root, relative: area });
}

/** 读某个报告目录里的 report.json */
export async function readReportJson(
	root: string,
	area: ReportArea,
	folder: string,
): Promise<string> {
	return call<string>("storage_read_text", { root, relative: `${area}/${folder}/${REPORT_FILE_NAME}` });
}

/** report.json 的最后修改时间（毫秒），拿不到就返回 null */
export async function getReportUpdatedAt(
	root: string,
	area: ReportArea,
	folder: string,
): Promise<number | null> {
	const value = await call<number | null>("storage_mtime", {
		root,
		relative: `${area}/${folder}/${REPORT_FILE_NAME}`,
	});
	return value ?? null;
}

/** 目录改名（报告改名后同步目录名） */
export async function renameReportDir(
	root: string,
	fromFolder: string,
	toFolder: string,
): Promise<void> {
	await call("storage_rename", {
		root,
		from: `data/${fromFolder}`,
		to: `data/${toFolder}`,
	});
}

/** 按相对路径改名（备份单个文件用） */
export async function renamePath(root: string, from: string, to: string): Promise<void> {
	await call("storage_rename", { root, from, to });
}

/** 删除整个报告目录（清理草稿时用），失败不抛错 */
export async function removeReportDir(
	root: string,
	area: ReportArea,
	folder: string,
): Promise<void> {
	try {
		await call("storage_remove_dir", { root, relative: `${area}/${folder}` });
	} catch {
		// 清理是尽力而为：删不掉不该影响保存结果
	}
}

/** media 目录的相对路径，媒体文件导入时会用到 */
export function mediaDirOf(area: ReportArea, reportName: string, reportId: string): string {
	return getReportMediaDir(area, reportName, reportId);
}

/** media 下某个文件的相对路径 */
export function mediaPathOf(
	area: ReportArea,
	reportName: string,
	reportId: string,
	fileName: string,
): string {
	return getReportMediaPath(area, reportName, reportId, fileName);
}

/**
 * 删除 media 里没有被引用的文件。
 *
 * 保存后调用：导入的图片按内容 hash 命名，用户换图之后旧文件就没人引用了，
 * 不清理的话报告目录会一直变胖。尽力而为 —— 删不掉不该让保存失败。
 */
export async function removeUnreferencedMedia(
	root: string,
	area: ReportArea,
	folder: string,
	referenced: Set<string>,
): Promise<void> {
	const dir = `${area}/${folder}/${REPORT_MEDIA_DIR}`;
	let files: string[] = [];
	try {
		files = await call<string[]>("storage_list_files", { root, relative: dir });
	} catch {
		return;
	}
	for (const name of files) {
		if (referenced.has(name)) {
			continue;
		}
		try {
			await call("storage_remove_file", { root, relative: `${dir}/${name}` });
		} catch {
			// 占用/权限问题跳过即可
		}
	}
}

/**
 * 把一组媒体文件从草稿目录复制到已保存目录。
 *
 * 草稿阶段的图片存在 cache，保存后 cache 目录会被清掉；
 * 不搬的话 JSON 里写的 `media/xxx.png` 就指向了不存在的位置。
 * JSON 里的路径是相对报告目录的，所以目标文件名原样保留、一个字节都不用改。
 */
export async function copyMediaDir(
	root: string,
	sourceDir: string,
	targetDir: string,
): Promise<void> {
	try {
		await call("storage_copy_files", { root, from: sourceDir, to: targetDir });
	} catch {
		// 复制失败不影响保存本身，下次保存会再试
	}
}
