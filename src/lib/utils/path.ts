/**
 * 路径工具。
 *
 * 纯字符串处理，不涉及任何状态 —— 所以放在最底层的 utils：
 * lib、store、组件都可以引它，它不引任何上层模块。
 */

/** Windows 下路径大小写不敏感，比较统一按小写 + 正斜杠 */
export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** 两个目录路径是不是同一个（忽略大小写和分隔符差异） */
export function isSamePath(a: string, b: string): boolean {
	return normalizePath(a) === normalizePath(b);
}
