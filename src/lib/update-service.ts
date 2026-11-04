import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";

/**
 * 更新检查与安装包下载。
 *
 * 查询、下载、打开安装包全部走 Rust 命令（`check_latest_release` /
 * `download_update` / `run_installer` / `open_release_page`）：webview 里直接
 * fetch GitHub API 会被 CORS 拦，而且 GitHub 要求带 User-Agent。
 *
 * 不做 tauri-plugin-updater 那套静默升级：这里用户点"下载并安装"才下载、
 * 才关应用起安装程序，装完的事交给 NSIS。安装包落在系统临时目录，
 * 下次启动时由 Rust 侧清掉。
 */

export interface UpdateInfo {
	current: string;
	latest: string;
	notes?: string;
	/** 发布页地址 */
	url?: string;
	/** 本次发布附带的 Windows 安装包（没有就只能打开发布页） */
	downloadUrl?: string;
	downloadName?: string;
	downloadSize?: number;
}

export type UpdateCheckResult =
	| { status: "up-to-date"; current: string }
	| { status: "available"; info: UpdateInfo }
	| { status: "unavailable"; reason: string };

/** 当前版本号，从 tauri.conf.json 里的 version 读 */
export async function getAppVersion(): Promise<string> {
	try {
		return await getVersion();
	} catch {
		return "0.0.0";
	}
}

/** 按 主.次.补丁 逐段比较；语义化后缀（-beta.1）按数字段近似处理 */
export function isNewerVersion(latest: string, current: string): boolean {
	const parse = (value: string) =>
		value
			.trim()
			.replace(/^v/i, "")
			.split(/[.+-]/)
			.map((part) => Number.parseInt(part, 10))
			.filter((part) => Number.isFinite(part));

	const left = parse(latest);
	const right = parse(current);
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		const a = left[index] ?? 0;
		const b = right[index] ?? 0;
		if (a !== b) {
			return a > b;
		}
	}
	return false;
}

/** 查询并比较版本。任何失败都归到 unavailable，不抛异常。 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
	const current = await getAppVersion();

	try {
		const release = await invoke<{
			version: string;
			url: string;
			notes?: string;
			publishedAt?: string;
			downloadUrl?: string;
			downloadName?: string;
			downloadSize?: number;
		}>("check_latest_release");

		if (!release?.version) {
			return { status: "unavailable", reason: "发布信息里没有版本号" };
		}
		if (!isNewerVersion(release.version, current)) {
			return { status: "up-to-date", current };
		}
		return {
			status: "available",
			info: {
				current,
				latest: release.version,
				notes: release.notes || undefined,
				url: release.url || undefined,
				downloadUrl: release.downloadUrl || undefined,
				downloadName: release.downloadName || undefined,
				downloadSize: release.downloadSize || undefined,
			},
		};
	} catch (error) {
		return {
			status: "unavailable",
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}

/** 下载安装包到临时目录，返回本地路径 */
export async function downloadUpdate(info: UpdateInfo): Promise<string> {
	if (!info.downloadUrl || !info.downloadName) {
		throw new Error("这个版本没有附带安装包");
	}
	return invoke<string>("download_update", {
		url: info.downloadUrl,
		fileName: info.downloadName,
	});
}

/** 启动安装程序（Rust 侧会在启动后退出应用） */
export async function runInstaller(path: string): Promise<void> {
	await invoke("run_installer", { path });
}

/** 打开发布页：没有安装包或下载失败时的兜底 */
export async function openReleasePage(url: string): Promise<void> {
	await invoke("open_release_page", { url });
}
