import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { MAX_RECENT_COLORS } from "@/base/colors";
import { dataDirsStore, preferenceStore } from "@/store";
import { getAppDataRoot } from "./report-storage";

/**
 * UI 偏好的落盘位置：和报告草稿目录（cache/<报告目录>/）同级的单个文件。
 * 它不是文档内容，换台机器/换个人就该有不同的一套。
 *
 * 现在存两样东西：最近使用色、数据目录列表。
 */
const PREFERENCES_PATH = "cache/ui-preferences.json";
const PREFERENCES_DIR = "cache";
const BASE_DIR = BaseDirectory.AppData;

/** 写盘防抖：连续取色只落一次盘 */
const PERSIST_DELAY = 400;
let persistTimer: number | null = null;

/** 只加载一次：保存/恢复报告前都要等它，所以做成可重入的 Promise */
let loading: Promise<void> | null = null;

interface PreferenceFile {
	recentColors?: unknown;
	dataDirs?: { dirs?: unknown; defaultPath?: unknown };
}

async function readPreferencesFile(): Promise<PreferenceFile> {
	if (!(await exists(PREFERENCES_PATH, { baseDir: BASE_DIR }))) {
		return {};
	}
	return JSON.parse(await readTextFile(PREFERENCES_PATH, { baseDir: BASE_DIR })) as PreferenceFile;
}

async function load(): Promise<void> {
	try {
		const raw = await readPreferencesFile();
		const colors = Array.isArray(raw.recentColors)
			? raw.recentColors.filter((color): color is string => typeof color === "string")
			: [];
		preferenceStore.replaceRecentColors(colors.slice(0, MAX_RECENT_COLORS));

		const savedDirs = Array.isArray(raw.dataDirs?.dirs)
			? raw.dataDirs.dirs.filter((path): path is string => typeof path === "string")
			: [];
		const defaultPath =
			typeof raw.dataDirs?.defaultPath === "string" ? raw.dataDirs.defaultPath : "";
		// 内置目录的路径是环境决定的，不落盘
		dataDirsStore.init(await getAppDataRoot(), { dirs: savedDirs, defaultPath });
	} catch (error) {
		// 偏好读不出来不该影响使用，按空处理即可
		console.error("读取 UI 偏好失败", error);
		const builtin = await getAppDataRoot().catch(() => "");
		dataDirsStore.init(builtin, {});
	}
}

/** 保证偏好（特别是数据目录列表）已经读进来；报告 IO 之前应当 await 它 */
export function ensurePreferencesLoaded(): Promise<void> {
	loading ??= load();
	return loading;
}

/** 立即可见的落盘：数据目录变更这类低频操作不需要防抖 */
export async function savePreferencesNow(): Promise<void> {
	try {
		await mkdir(PREFERENCES_DIR, { baseDir: BASE_DIR, recursive: true });
		const payload = {
			recentColors: preferenceStore.getState().recentColors,
			dataDirs: dataDirsStore.toJSON(),
		};
		await writeTextFile(PREFERENCES_PATH, JSON.stringify(payload, null, 2), {
			baseDir: BASE_DIR,
		});
	} catch (error) {
		console.error("写入 UI 偏好失败", error);
	}
}

/** 记录一次用过的颜色，并择机落盘 */
export function rememberColor(color: string): void {
	preferenceStore.addRecentColor(color);
	if (persistTimer !== null) {
		window.clearTimeout(persistTimer);
	}
	persistTimer = window.setTimeout(() => {
		persistTimer = null;
		void savePreferencesNow();
	}, PERSIST_DELAY);
}
