/**
 * 生成唯一 id。优先用 crypto.randomUUID，环境不支持时退回「前缀-时间戳-随机串」。
 * 页面、报告、元素都要用它，保证写进文件的 id 不重复。
 */
export function createUniqueId(prefix: string): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
