import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";

/**
 * 更新检查：和 GitHub 上最新的 release 比版本号。
 *
 * 查询走 Rust 命令（`check_latest_release`）：webview 里直接 fetch GitHub API
 * 会被 CORS 拦，而且 GitHub 要求带 User-Agent。
 *
 * 故意不引 tauri-plugin-updater：那套要签名密钥和 latest.json 托管，
 * 现在只解决"用户怎么知道有新版本"，下载交给发布页。
 *
 * 返回的 `url` 是发布页地址，界面上让用户点过去手动装 —— 不做静默升级。
 */

export interface UpdateInfo {
	current: string;
	latest: string;
	notes?: string;
	url?: string;
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
			},
		};
	} catch (error) {
		return {
			status: "unavailable",
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}
