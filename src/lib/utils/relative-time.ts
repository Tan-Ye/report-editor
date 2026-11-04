/**
 * 相对时间的说法。
 *
 * 草稿箱和模板列表都要显示"多久以前改的"，而这个判断跟项目领域无关，
 * 所以放在 utils（见第 25 节的划分：全局通用工具进 utils）。
 */
export function formatRelativeTime(timestamp: number): string {
	if (!timestamp) {
		return "时间未知";
	}
	const diff = Date.now() - timestamp;
	if (diff < 60_000) {
		// 负数是时钟回拨/文件时间在未来，一并当成「刚刚」，别算出"-3 分钟前"
		return "刚刚";
	}
	if (diff < 3_600_000) {
		return `${Math.floor(diff / 60_000)} 分钟前`;
	}
	if (diff < 86_400_000) {
		return `${Math.floor(diff / 3_600_000)} 小时前`;
	}
	return `${Math.floor(diff / 86_400_000)} 天前`;
}
