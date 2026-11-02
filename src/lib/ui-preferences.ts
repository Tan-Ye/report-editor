import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { MAX_RECENT_COLORS } from "@/base/colors";
import { preferenceStore } from "@/store";

/**
 * UI 偏好的落盘位置：和报告草稿目录（cache/<报告目录>/）同级的单个文件。
 * 它不是文档内容，换台机器/换个人就该有不同的一套。
 */
const PREFERENCES_PATH = "cache/ui-preferences.json";
const PREFERENCES_DIR = "cache";
const BASE_DIR = BaseDirectory.AppData;

/** 写盘防抖：连续取色只落一次盘 */
const PERSIST_DELAY = 400;
let persistTimer: number | null = null;

/** 启动时读一次；文件不存在或内容坏了都当作「没有偏好」 */
export async function loadUiPreferences(): Promise<void> {
	try {
		if (!(await exists(PREFERENCES_PATH, { baseDir: BASE_DIR }))) {
			return;
		}
		const raw = JSON.parse(await readTextFile(PREFERENCES_PATH, { baseDir: BASE_DIR })) as {
			recentColors?: unknown;
		};
		const colors = Array.isArray(raw.recentColors)
			? raw.recentColors.filter((color): color is string => typeof color === "string")
			: [];
		preferenceStore.replaceRecentColors(colors.slice(0, MAX_RECENT_COLORS));
	} catch (error) {
		// 偏好读不出来不该影响使用，按空处理即可
		console.error("读取 UI 偏好失败", error);
	}
}

async function persistUiPreferences(): Promise<void> {
	try {
		await mkdir(PREFERENCES_DIR, { baseDir: BASE_DIR, recursive: true });
		await writeTextFile(
			PREFERENCES_PATH,
			JSON.stringify({ recentColors: preferenceStore.getState().recentColors }, null, 2),
			{ baseDir: BASE_DIR },
		);
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
		void persistUiPreferences();
	}, PERSIST_DELAY);
}
