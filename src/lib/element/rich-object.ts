import * as fabric from "fabric";
import {
	TEXT_BOX_WIDTH,
	TEXT_FONT_FAMILY,
	TEXT_FONT_SIZE,
	TEXT_LINE_HEIGHT,
} from "@/base/elements";
import type { ElementAttrs, FillSpec } from "@/store";
import { getReportPalette } from "../theme-tokens";
import {
	layoutRichText,
	type RichTextLayout,
	type RichTextMetrics,
	type RichTextSegment,
} from "./rich-layout";
import {
	isRichTextEmpty,
	normalizeRichText,
	plainTextToRichText,
	richTextToPlainText,
	type RichTextAlign,
	type RichTextDoc,
} from "./rich-text";
import { measureTextWidth, toFontString } from "./text-measure";

/**
 * 富文本元素对象：**自己画**，不依赖 fabric 的 Textbox。
 *
 * 为什么自绘：
 * - fabric 的 Textbox 没有段落概念，做不了首行缩进、悬挂缩进和项目符号；
 * - 自己按 `rich-layout` 的断行结果逐段 fillText，缩进/对齐/列表/链接
 *   全都是算好的坐标，行为和导出一致；
 * - 一个元素仍然是一个 fabric 对象，选中、移动、旋转、层级、导出、
 *   缩略图全部沿用现有逻辑。
 *
 * 编辑不在这里做：双击由 DOM 覆盖层（Tiptap）接管，提交时把
 * ProseMirror 文档转回 `textDoc` 并重排。
 */

const MIN_WIDTH = 24;
/** 链接默认颜色（和 UI 的 primary 不一样：导出里要像普通超链接的蓝） */
const LINK_COLOR = "#2563eb";

export interface RichTextStyle {
	fontSize: number;
	fontFamily: string;
	fontWeight?: string | number;
	lineHeight: number;
	textAlign: RichTextAlign;
}

export interface RichTextBoxOptions {
	doc: RichTextDoc;
	width: number;
	style: RichTextStyle;
	color: string;
	placeholder?: boolean;
}

const numberOr = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** 从元素 fill 取文字颜色：纯色直接用，渐变取第一个色标；图片填充退回主题文字色 */
export function textColorFromFill(fill: FillSpec | undefined): string | undefined {
	if (fill?.kind === "solid") {
		return fill.color;
	}
	if (fill?.kind === "gradient") {
		return fill.stops[0]?.color;
	}
	return undefined;
}

/** attrs → 富文本模型：优先 paragraphs，其次旧的纯文本 text */
export function resolveRichTextDoc(attrs: ElementAttrs | undefined): RichTextDoc {
	if (Array.isArray(attrs?.paragraphs)) {
		return normalizeRichText(attrs.paragraphs);
	}
	const text = typeof attrs?.text === "string" ? attrs.text : "";
	return plainTextToRichText(text);
}

/** attrs → 元素级排版参数（run 没覆盖时用它） */
export function resolveRichTextStyle(attrs: ElementAttrs | undefined): RichTextStyle {
	return {
		fontSize: Math.max(numberOr(attrs?.fontSize, TEXT_FONT_SIZE), 1),
		fontFamily: typeof attrs?.fontFamily === "string" ? attrs.fontFamily : TEXT_FONT_FAMILY,
		fontWeight:
			typeof attrs?.fontWeight === "string" || typeof attrs?.fontWeight === "number"
				? attrs.fontWeight
				: undefined,
		lineHeight: Math.max(numberOr(attrs?.lineHeight, TEXT_LINE_HEIGHT), 0.5),
		textAlign:
			attrs?.textAlign === "center" || attrs?.textAlign === "right"
				? attrs.textAlign
				: "left",
	};
}

export class RichTextBox extends fabric.Object {
	static type = "RichTextBox";

	textDoc: RichTextDoc = [{ runs: [] }];
	lines: RichTextLayout["lines"] = [];
	markers: RichTextLayout["markers"] = [];
	/** 空文本 / 占位时画虚线框，否则用户看不见也点不到 */
	showOutline = false;
	placeholder = false;
	/** 纯文本投影，给 dump / agent / 校验用 */
	text = "";
	/** 段落模型投影：白名单快照（新建元素）会读它 */
	paragraphs: RichTextDoc = [{ runs: [] }];

	private style: RichTextStyle = {
		fontSize: TEXT_FONT_SIZE,
		fontFamily: TEXT_FONT_FAMILY,
		lineHeight: TEXT_LINE_HEIGHT,
		textAlign: "left",
	};
	private color = getReportPalette().textFill;

	constructor(options: RichTextBoxOptions) {
		super();
		this.set({ originX: "left", originY: "top", objectCaching: false });
		this.textDoc = options.doc;
		this.style = options.style;
		this.color = options.color;
		this.placeholder = options.placeholder ?? false;
		this.width = Math.max(options.width, MIN_WIDTH);
		this.relayout();
	}

	get richStyle(): RichTextStyle {
		return this.style;
	}

	get textColor(): string {
		return this.color;
	}

	/** 重排：宽度/字号/字体/文档变了都调它 */
	relayout(): void {
		const metrics: RichTextMetrics = {
			fontSize: this.style.fontSize,
			fontFamily: this.style.fontFamily,
			fontWeight: this.style.fontWeight,
			lineHeight: this.style.lineHeight,
			textAlign: this.style.textAlign,
		};
		const layout = layoutRichText({
			paragraphs: this.textDoc,
			width: this.width,
			metrics,
			measure: measureTextWidth,
		});
		this.lines = layout.lines;
		this.markers = layout.markers;
		this.height = Math.max(layout.height, 1);
		this.text = richTextToPlainText(this.textDoc);
		this.paragraphs = this.textDoc;
		this.showOutline = this.placeholder || isRichTextEmpty(this.textDoc);
		this.dirty = true;
		this.setCoords();
	}

	/** 换文档（编辑器提交时用） */
	setDoc(doc: RichTextDoc, options?: { placeholder?: boolean }): void {
		this.textDoc = doc;
		if (options?.placeholder !== undefined) {
			this.placeholder = options.placeholder;
		}
		this.relayout();
	}

	/** 从完整 attrs 还原（读文件、撤销、面板刷新都走这里） */
	applyAttrs(attrs: ElementAttrs): void {
		this.textDoc = resolveRichTextDoc(attrs);
		this.style = resolveRichTextStyle(attrs);
		this.color = textColorFromFill(attrs.fill) ?? getReportPalette().textFill;
		this.placeholder = false;
		this.width = Math.max(numberOr(attrs.width, this.width), MIN_WIDTH);
		this.relayout();
	}

	/** 属性面板改的是元素级样式（字号/字体/对齐/行高/颜色） */
	applyBasicStyle(patch: {
		fontSize?: number;
		fontFamily?: string;
		fontWeight?: string | number;
		lineHeight?: number;
		textAlign?: RichTextAlign;
		color?: string;
	}): void {
		if (patch.fontSize !== undefined) {
			this.style.fontSize = Math.max(patch.fontSize, 1);
		}
		if (patch.fontFamily !== undefined) {
			this.style.fontFamily = patch.fontFamily;
		}
		if (patch.fontWeight !== undefined) {
			this.style.fontWeight = patch.fontWeight;
		}
		if (patch.lineHeight !== undefined) {
			this.style.lineHeight = Math.max(patch.lineHeight, 0.5);
		}
		if (patch.textAlign !== undefined) {
			this.style.textAlign = patch.textAlign;
		}
		if (patch.color !== undefined) {
			this.color = patch.color;
		}
		this.relayout();
	}

	/**
	 * 拉伸结束时把 scale 折进 width：文本不跟着缩放，而是按新宽度重排。
	 * 返回是否真的折过，调用方据此决定是否要同步 store。
	 */
	normalizeScale(): boolean {
		let changed = false;
		if (Math.abs(this.scaleX - 1) > 0.001) {
			this.width = Math.max(this.width * this.scaleX, MIN_WIDTH);
			this.scaleX = 1;
			changed = true;
		}
		if (Math.abs(this.scaleY - 1) > 0.001) {
			this.scaleY = 1;
			changed = true;
		}
		if (changed) {
			this.relayout();
		}
		return changed;
	}

	/**
	 * 场景坐标 → 元素本地坐标（左上角为原点）。
	 * 和 fabric 内部命中测试同一套算法：先绕中心反旋转，再减去 origin 点。
	 */
	toLocalPoint(scenePoint: fabric.Point): fabric.Point {
		const center = this.getRelativeCenterPoint();
		const origin = this.translateToGivenOrigin(center, "center", "center", "left", "top");
		const radians = ((this.angle ?? 0) * Math.PI) / 180;
		const rotated = scenePoint.rotate(-radians, center);
		return rotated.subtract(origin);
	}

	/** 命中测试：本地坐标处是不是一条链接（Ctrl+点击打开用） */
	linkAt(localX: number, localY: number): string | null {
		for (const line of this.lines) {
			if (localY < line.y || localY > line.y + line.height) {
				continue;
			}
			let cursor = line.x;
			for (const segment of line.segments) {
				const href = segment.marks?.link;
				if (href && localX >= cursor && localX <= cursor + segment.width) {
					return href;
				}
				cursor += segment.width;
			}
		}
		return null;
	}

	_render(ctx: CanvasRenderingContext2D): void {
		const offsetX = -this.width / 2;
		const offsetY = -this.height / 2;
		const palette = getReportPalette();

		if (this.showOutline) {
			ctx.save();
			ctx.strokeStyle = palette.shapeStroke;
			ctx.lineWidth = 1;
			ctx.setLineDash([4, 4]);
			ctx.strokeRect(offsetX + 0.5, offsetY + 0.5, this.width - 1, this.height - 1);
			ctx.restore();
		}

		ctx.save();
		ctx.textBaseline = "middle";
		ctx.fillStyle = this.color;

		for (const marker of this.markers) {
			ctx.font = toFontString({
				fontSize: this.style.fontSize,
				fontFamily: this.style.fontFamily,
				fontWeight: this.style.fontWeight,
			});
			ctx.fillText(marker.text, offsetX + marker.x, offsetY + marker.y + marker.height / 2);
		}

		for (const line of this.lines) {
			const centerY = offsetY + line.y + line.height / 2;
			let cursor = offsetX + line.x;
			for (const segment of line.segments) {
				this.drawSegment(ctx, segment, cursor, centerY);
				cursor += segment.width;
			}
		}

		ctx.restore();
	}

	private drawSegment(
		ctx: CanvasRenderingContext2D,
		segment: RichTextSegment,
		x: number,
		centerY: number,
	): void {
		const marks = segment.marks;
		ctx.font = toFontString({
			fontSize: this.style.fontSize,
			fontFamily: this.style.fontFamily,
			fontWeight: marks?.bold ? 700 : this.style.fontWeight,
			italic: marks?.italic,
		});
		ctx.fillStyle = marks?.color ?? (marks?.link ? LINK_COLOR : this.color);
		ctx.fillText(segment.text, x, centerY);

		const thickness = Math.max(1, this.style.fontSize * 0.06);
		if (marks?.underline || marks?.link) {
			ctx.fillRect(x, centerY + this.style.fontSize * 0.42, segment.width, thickness);
		}
		if (marks?.strike) {
			ctx.fillRect(x, centerY, segment.width, thickness);
		}
	}
}

/** 新建一个富文本对象（definitions.build 用） */
export function createRichTextBox(
	box: { left: number; top: number; width: number },
	attrs?: ElementAttrs,
): RichTextBox {
	const style = resolveRichTextStyle(attrs);
	const object = new RichTextBox({
		doc: resolveRichTextDoc(attrs),
		width: Math.max(numberOr(attrs?.width, box.width || TEXT_BOX_WIDTH), MIN_WIDTH),
		style,
		color: textColorFromFill(attrs?.fill) ?? getReportPalette().textFill,
	});
	object.set({ left: box.left, top: box.top });
	return object;
}
