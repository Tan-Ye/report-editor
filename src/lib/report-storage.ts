import { appDataDir, join } from "@tauri-apps/api/path";
import {
	BaseDirectory,
	exists,
	mkdir,
	readDir,
	readFile,
	readTextFile,
	remove,
	rename,
	stat,
	writeFile,
	writeTextFile,
} from "@tauri-apps/plugin-fs";
import {
	REPORT_FILE_NAME,
	REPORT_MEDIA_DIR,
	REPORT_TEMP_SUFFIX,
	getReportJsonPath,
	getReportMediaDir,
	type ReportArea,
} from "./report-path";

/**
 * 所有报告文件都在应用数据目录（%APPDATA%/<identifier>）下。
 * 绝不写安装目录 —— Program Files 没有写权限，升级卸载还会清空。
 */
const BASE_DIR = BaseDirectory.AppData;

/** 确保某个存储区（data / cache）存在 */
export async function ensureArea(area: ReportArea): Promise<void> {
	await mkdir(area, { baseDir: BASE_DIR, recursive: true });
}

/** 转成绝对路径：给界面展示、给"打开文件夹"用 */
export async function getAbsolutePath(relativePath: string): Promise<string> {
	const root = await appDataDir();
	return join(root, relativePath);
}

/** 确保某个报告目录（以及 media 子目录）存在 */
export async function ensureReportFolder(area: ReportArea, folder: string): Promise<void> {
	await mkdir(`${area}/${folder}`, { baseDir: BASE_DIR, recursive: true });
	await mkdir(`${area}/${folder}/${REPORT_MEDIA_DIR}`, { baseDir: BASE_DIR, recursive: true });
}

/** 指定报告目录里 report.json 的相对路径 */
export function getFolderJsonPath(area: ReportArea, folder: string): string {
	return `${area}/${folder}/${REPORT_FILE_NAME}`;
}

/**
 * 原子写 JSON：先写 `.tmp`，再 rename 覆盖。
 * 直接写目标文件的话，写到一半崩掉会把原报告写坏。
 */
export async function writeJsonAtomically(relativePath: string, content: string): Promise<void> {
	const tempPath = `${relativePath}${REPORT_TEMP_SUFFIX}`;
	await writeTextFile(tempPath, content, { baseDir: BASE_DIR });
	await rename(tempPath, relativePath, {
		oldPathBaseDir: BASE_DIR,
		newPathBaseDir: BASE_DIR,
	});
}

/** 按相对路径读文本 */
export async function readText(relativePath: string): Promise<string> {
	return readTextFile(relativePath, { baseDir: BASE_DIR });
}

/** 报告目录里是否已经有 report.json */
export async function hasReportFile(
	area: ReportArea,
	reportName: string,
	reportId: string,
): Promise<boolean> {
	return exists(getReportJsonPath(area, reportName, reportId), { baseDir: BASE_DIR });
}

/** 列出某个存储区下的报告目录名 */
export async function listReportFolders(area: ReportArea): Promise<string[]> {
	if (!(await exists(area, { baseDir: BASE_DIR }))) {
		return [];
	}
	const entries = await readDir(area, { baseDir: BASE_DIR });
	return entries.filter((entry) => entry.isDirectory).map((entry) => entry.name);
}

/** 读某个报告目录里的 report.json */
export async function readReportJson(area: ReportArea, folder: string): Promise<string> {
	return readTextFile(`${area}/${folder}/${REPORT_FILE_NAME}`, { baseDir: BASE_DIR });
}

/** report.json 的最后修改时间（毫秒），拿不到就返回 null */
export async function getReportUpdatedAt(
	area: ReportArea,
	folder: string,
): Promise<number | null> {
	try {
		const info = await stat(`${area}/${folder}/${REPORT_FILE_NAME}`, { baseDir: BASE_DIR });
		return info.mtime ? new Date(info.mtime).getTime() : null;
	} catch {
		return null;
	}
}

/** 目录改名（报告改名后同步目录名） */
export async function renameReportDir(
	fromFolder: string,
	toFolder: string,
): Promise<void> {
	await rename(`data/${fromFolder}`, `data/${toFolder}`, {
		oldPathBaseDir: BASE_DIR,
		newPathBaseDir: BASE_DIR,
	});
}

/** 删除整个报告目录（清理草稿时用），失败不抛错 */
export async function removeReportDir(area: ReportArea, folder: string): Promise<void> {
	try {
		await remove(`${area}/${folder}`, { baseDir: BASE_DIR, recursive: true });
	} catch {
		// 清理是尽力而为：删不掉不该影响保存结果
	}
}

/** media 目录的相对路径，媒体文件导入时会用到 */
export function mediaDirOf(area: ReportArea, reportName: string, reportId: string): string {
	return getReportMediaDir(area, reportName, reportId);
}

/**
 * 把一组媒体文件从草稿目录复制到已保存目录。
 *
 * 草稿阶段的图片存在 cache，保存后 cache 目录会被清掉；
 * 不搬的话 JSON 里写的 `media/xxx.png` 就指向了不存在的位置。
 * JSON 里的路径是相对报告目录的，所以目标文件名原样保留、一个字节都不用改。
 */
export async function copyMediaDir(sourceDir: string, targetDir: string): Promise<void> {
	if (!(await exists(sourceDir, { baseDir: BASE_DIR }))) {
		return;
	}
	const entries = await readDir(sourceDir, { baseDir: BASE_DIR });
	if (entries.length === 0) {
		return;
	}
	await mkdir(targetDir, { baseDir: BASE_DIR, recursive: true });
	for (const entry of entries) {
		if (!entry.isFile) {
			continue;
		}
		const bytes = await readFile(`${sourceDir}/${entry.name}`, { baseDir: BASE_DIR });
		await writeFile(`${targetDir}/${entry.name}`, bytes, { baseDir: BASE_DIR });
	}
}
