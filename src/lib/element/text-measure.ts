/**
 * 文本测量：排版和画布渲染必须用同一套字体度量。
 *
 * 用一张离屏 canvas 的 2D context 量宽度：和 fabric 最终 fillText
 * 用的是同一套浏览器字体引擎，换行位置才不会和显示对不上。
 */

export interface TextMeasureStyle {
	fontSize: number;
	fontFamily: string;
	fontWeight?: string | number;
	italic?: boolean;
}

let context: CanvasRenderingContext2D | null | undefined;

function getContext(): CanvasRenderingContext2D | null {
	if (context !== undefined) {
		return context;
	}
	context =
		typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
	return context;
}

/** 拼 CSS font 简写；fontFamily 里可能带逗号列表，原样拼进去 */
export function toFontString(style: TextMeasureStyle): string {
	const weight = style.fontWeight ?? 400;
	const italic = style.italic ? "italic " : "";
	return `${italic}${weight} ${style.fontSize}px ${style.fontFamily}`;
}

/** 量一段文字的宽度；拿不到 canvas（测试环境）时按字号估算 */
export function measureTextWidth(text: string, style: TextMeasureStyle): number {
	if (!text) {
		return 0;
	}
	const ctx = getContext();
	if (!ctx) {
		return text.length * style.fontSize * 0.6;
	}
	ctx.font = toFontString(style);
	return ctx.measureText(text).width;
}
