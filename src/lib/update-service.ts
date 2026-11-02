import { getVersion } from "@tauri-apps/api/app";

/**
 * 更新清单地址。约定返回：
 *
 * ```json
 * { "version": "0.2.0", "notes": "更新说明", "url": "下载页地址" }
 * ```
 *
 * 现在是空串 = 没有配置更新源，检查会直接返回「暂不可用」。
 * 以后发布时把地址填进来，下面整套逻辑不用改。
 */
export const UPDATE_MANIFEST_URL = "";

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

/**
 * 检查更新。
 *
 * 故意不引 tauri-plugin-updater：那套要签名密钥和构建产物托管，
 * 现在连发布渠道都还没有。这里先用「拉一个 JSON 清单 + 版本号比较」，
 * 够用来做「有新版本就提示」，也方便以后换成真正的更新器。
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
	const current = await getAppVersion();

	if (!UPDATE_MANIFEST_URL) {
		return { status: "unavailable", reason: "还没有配置更新源地址" };
	}

	try {
		const response = await fetch(UPDATE_MANIFEST_URL, { cache: "no-store" });
		if (!response.ok) {
			return { status: "unavailable", reason: `更新源返回 ${response.status}` };
		}
		const raw = (await response.json()) as {
			version?: unknown;
			notes?: unknown;
			url?: unknown;
		};
		if (typeof raw.version !== "string" || !raw.version.trim()) {
			return { status: "unavailable", reason: "更新清单里没有版本号" };
		}

		const latest = raw.version.trim();
		if (!isNewerVersion(latest, current)) {
			return { status: "up-to-date", current };
		}
		return {
			status: "available",
			info: {
				current,
				latest,
				notes: typeof raw.notes === "string" ? raw.notes : undefined,
				url: typeof raw.url === "string" ? raw.url : undefined,
			},
		};
	} catch (error) {
		return {
			status: "unavailable",
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}
