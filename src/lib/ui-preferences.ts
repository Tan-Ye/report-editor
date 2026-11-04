import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { MAX_RECENT_COLORS } from "@/base/colors";
import { agentStore, dataDirsStore, preferenceStore, type AgentProvider } from "@/store";
import { getAppDataRoot } from "./report-storage";

/**
 * UI 偏好的落盘位置：和报告草稿目录（cache/<报告目录>/）同级的单个文件。
 * 它不是文档内容，换台机器/换个人就该有不同的一套。
 *
 * 现在存三样东西：最近使用色、数据目录列表、agent 设置（含 API Key）。
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
	agent?: {
		provider?: unknown;
		baseUrl?: unknown;
		model?: unknown;
		/** 旧格式：单个 Key，读的时候归到当时的服务商 */
		apiKey?: unknown;
		/** 新格式：每个服务商各自的 Key */
		apiKeys?: Record<string, unknown>;
		generateImages?: unknown;
	};
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

		// agent 设置：模型 / 地址 / Key 都算本地偏好，不进报告
		const agent = raw.agent;
		if (agent && typeof agent === "object") {
			const provider: AgentProvider =
				agent.provider === "openai" || agent.provider === "custom" ? agent.provider : "deepseek";
			const apiKeys: Record<string, string> = {};
			if (agent.apiKeys && typeof agent.apiKeys === "object") {
				for (const key of ["deepseek", "openai", "custom"] as const) {
					const value = agent.apiKeys[key];
					if (typeof value === "string") {
						apiKeys[key] = value;
					}
				}
			}
			agentStore.replace({
				provider,
				baseUrl: typeof agent.baseUrl === "string" ? agent.baseUrl : undefined,
				model: typeof agent.model === "string" ? agent.model : undefined,
				apiKeys: apiKeys as never,
				// 旧版本存的是单个 apiKey，replace() 里会把它归到当时的服务商
				apiKey: typeof agent.apiKey === "string" ? agent.apiKey : undefined,
				generateImages:
					typeof agent.generateImages === "boolean" ? agent.generateImages : undefined,
			} as never);
		}
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
			// agent 设置也存这里：模型、地址、API Key（明文，个人使用场景）
			agent: agentStore.getState(),
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
