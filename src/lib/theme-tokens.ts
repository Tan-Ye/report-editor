/**
 * 文档颜色令牌。
 *
 * 报告页面和元素的默认颜色属于「文档内容」，不属于 UI 主题，所以只在 global.css 的
 * :root 里定义、不随深色模式变化。fabric 只认字面量颜色，读不到 CSS 变量，
 * 所以运行时从这里把值取出来，再交给 fabric。
 */

export interface ReportPalette {
	/** 页面底色 */
	pageFill: string;
	/** 页面投影 */
	pageShadow: string;
	/** 形状默认填充 */
	shapeFill: string;
	/** 形状默认描边 */
	shapeStroke: string;
	/** 线条默认描边 */
	lineStroke: string;
	/** 文本默认颜色 */
	textFill: string;
}

const FALLBACK: ReportPalette = {
	pageFill: "#ffffff",
	pageShadow: "rgba(15, 23, 42, 0.18)",
	shapeFill: "#e2e8f0",
	shapeStroke: "#94a3b8",
	lineStroke: "#475569",
	textFill: "#1e293b",
};

let cached: ReportPalette | null = null;

const readToken = (name: string, fallback: string): string => {
	if (typeof window === "undefined") {
		return fallback;
	}
	const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return value || fallback;
};

/** 读取文档颜色令牌。首次调用后缓存，主题切换需要显式调用 refreshReportPalette() */
export function getReportPalette(): ReportPalette {
	if (cached) {
		return cached;
	}
	cached = {
		pageFill: readToken("--report-page-fill", FALLBACK.pageFill),
		pageShadow: readToken("--report-page-shadow", FALLBACK.pageShadow),
		shapeFill: readToken("--report-shape-fill", FALLBACK.shapeFill),
		shapeStroke: readToken("--report-shape-stroke", FALLBACK.shapeStroke),
		lineStroke: readToken("--report-line-stroke", FALLBACK.lineStroke),
		textFill: readToken("--report-text-fill", FALLBACK.textFill),
	};
	return cached;
}

/** 主题切换后调用，让下一次绘制拿到新的令牌值 */
export function refreshReportPalette(): void {
	cached = null;
}
