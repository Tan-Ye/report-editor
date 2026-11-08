import type {
	RichTextAlign,
	RichTextDoc,
	RichTextListKind,
	RichTextMark,
	RichTextParagraph,
} from "./rich-text";

/**
 * 富文本排版：把段落模型切成一行一行，算出每行的坐标和每个字符的样式。
 *
 * 为什么不用 fabric 的自动换行：Textbox 是"一整段"，做不到首行缩进、
 * 悬挂缩进和项目符号；这里自己断行，画布上每一行就是一个 fabric.Text，
 * 缩进/对齐/列表全都是数字，能单测。
 *
 * 纯函数：字体宽度通过 `measure` 注入，测试里可以给假的测量函数。
 */

export interface RichTextMetrics {
	fontSize: number;
	fontFamily: string;
	/** 元素级字重；run 的 bold 覆盖成 700 */
	fontWeight?: string | number;
	/** 行高倍数 */
	lineHeight: number;
	/** 元素级对齐 */
	textAlign: RichTextAlign;
	/** 列表层级的缩进，默认 24px */
	listIndent?: number;
	/** 列表符号与正文的间距，默认 6px */
	listGap?: number;
}

export interface RichTextMeasureStyle {
	fontSize: number;
	fontFamily: string;
	fontWeight?: string | number;
	italic?: boolean;
}

export type RichTextMeasure = (text: string, style: RichTextMeasureStyle) => number;

export interface RichTextSegment {
	text: string;
	marks?: RichTextMark;
	width: number;
}

export interface RichTextLine {
	text: string;
	/** 元素本地坐标（左上角） */
	x: number;
	y: number;
	width: number;
	height: number;
	/** 每个字符的样式覆盖，undefined = 继承元素默认 */
	styles: (RichTextMark | undefined)[];
	/** 按样式切好的连续片段，画布渲染按它逐段 fillText */
	segments: RichTextSegment[];
	paragraphIndex: number;
	firstLine: boolean;
}

export interface RichTextMarker {
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
	paragraphIndex: number;
}

export interface RichTextLayout {
	lines: RichTextLine[];
	markers: RichTextMarker[];
	height: number;
}

export interface RichTextLayoutOptions {
	paragraphs: RichTextDoc;
	/** 元素宽度 */
	width: number;
	metrics: RichTextMetrics;
	measure: RichTextMeasure;
}

const DEFAULT_LIST_INDENT = 24;
const DEFAULT_LIST_GAP = 6;
/** 行宽保护：太窄会让每个字符都单独成行，排版会失控 */
const MIN_CONTENT_WIDTH = 16;

interface Token {
	text: string;
	marks?: RichTextMark;
	width: number;
}

/** 拉丁词字符：连续的字母/数字算一个不可断的词 */
const WORD_CHAR = /[A-Za-z0-9_@#$%&*+=/\\'"-]/;

const isWordChar = (char: string) => WORD_CHAR.test(char);

function tokenStyle(metrics: RichTextMetrics, marks?: RichTextMark): RichTextMeasureStyle {
	return {
		fontSize: metrics.fontSize,
		fontFamily: metrics.fontFamily,
		fontWeight: marks?.bold ? 700 : metrics.fontWeight,
		italic: marks?.italic,
	};
}

/**
 * 断词规则（简版）：
 * - 连续的拉丁字母/数字合成一个词，词内不折行；
 * - 中日韩字符、标点、空格各自可断；
 * - 空格保留在行尾，交给对齐计算忽略。
 */
function tokenize(
	paragraph: RichTextParagraph,
	metrics: RichTextMetrics,
	measure: RichTextMeasure,
): Token[] {
	const tokens: Token[] = [];
	for (const run of paragraph.runs) {
		const marks = run.marks;
		let buffer = "";
		const flush = () => {
			if (!buffer) {
				return;
			}
			tokens.push({ text: buffer, marks, width: measure(buffer, tokenStyle(metrics, marks)) });
			buffer = "";
		};
		for (const char of run.text) {
			if (isWordChar(char)) {
				buffer += char;
				continue;
			}
			flush();
			tokens.push({ text: char, marks, width: measure(char, tokenStyle(metrics, marks)) });
		}
		flush();
	}
	return tokens;
}

function markerText(kind: RichTextListKind, value: number): string {
	return kind === "bullet" ? "•" : `${value}.`;
}

export function layoutRichText(options: RichTextLayoutOptions): RichTextLayout {
	const { paragraphs, width, metrics, measure } = options;
	const listIndent = metrics.listIndent ?? DEFAULT_LIST_INDENT;
	const listGap = metrics.listGap ?? DEFAULT_LIST_GAP;
	const lineHeight = metrics.fontSize * metrics.lineHeight;

	const lines: RichTextLine[] = [];
	const markers: RichTextMarker[] = [];
	let y = 0;
	let orderedValue = 0;
	let previousList: { kind: RichTextListKind; level: number } | null = null;

	paragraphs.forEach((paragraph, paragraphIndex) => {
		const list = paragraph.list;
		const level = Math.min(Math.max(list?.level ?? 0, 0), 3);
		const marginLeft = list ? level * listIndent : 0;

		// 有序列表的序号：连续同层同类型的列表才累加，否则从 start 重新开始
		let marker: string | null = null;
		if (list) {
			if (list.kind === "ordered") {
				const continues =
					previousList?.kind === "ordered" && previousList.level === level;
				// start 只对"新开的一串编号"生效；继续的项顺着上一项数
				orderedValue = continues ? orderedValue + 1 : (list.start ?? 1);
				marker = markerText("ordered", orderedValue);
			} else {
				marker = markerText("bullet", 0);
			}
			previousList = { kind: list.kind, level };
		} else {
			previousList = null;
			orderedValue = 0;
		}

		const markerWidth = marker
			? measure(marker, {
					fontSize: metrics.fontSize,
					fontFamily: metrics.fontFamily,
					fontWeight: metrics.fontWeight,
				}) + listGap
			: 0;
		const contentLeft = marginLeft + markerWidth;
		const contentWidth = Math.max(width - contentLeft, MIN_CONTENT_WIDTH);
		const firstIndent = paragraph.indent ?? 0;

		const tokens = tokenize(paragraph, metrics, measure);
		const paragraphAlign = paragraph.align ?? metrics.textAlign;
		const paragraphLines: RichTextLine[] = [];

		let current: Token[] = [];
		let currentWidth = 0;
		let lineIndex = 0;

		const flushLine = () => {
			const text = current.map((token) => token.text).join("");
			const styles: (RichTextMark | undefined)[] = [];
			const segments: RichTextSegment[] = [];
			for (const token of current) {
				for (const _ of token.text) {
					styles.push(token.marks);
				}
				const previous = segments[segments.length - 1];
				if (previous && previous.marks === token.marks) {
					previous.text += token.text;
					previous.width += token.width;
				} else {
					segments.push({ text: token.text, marks: token.marks, width: token.width });
				}
			}
			const isFirst = lineIndex === 0;
			const indent = isFirst ? firstIndent : 0;
			const available = Math.max(contentWidth - indent, MIN_CONTENT_WIDTH);
			let offset = 0;
			if (paragraphAlign === "center") {
				offset = Math.max(0, (available - currentWidth) / 2);
			} else if (paragraphAlign === "right") {
				offset = Math.max(0, available - currentWidth);
			}
			paragraphLines.push({
				text,
				x: contentLeft + indent + offset,
				y: 0,
				width: currentWidth,
				height: lineHeight,
				styles,
				segments,
				paragraphIndex,
				firstLine: isFirst,
			});
			current = [];
			currentWidth = 0;
			lineIndex += 1;
		};

		for (const token of tokens) {
			const isFirst = lineIndex === 0;
			const limit = Math.max(contentWidth - (isFirst ? firstIndent : 0), MIN_CONTENT_WIDTH);
			if (current.length > 0 && currentWidth + token.width > limit) {
				flushLine();
			}
			current.push(token);
			currentWidth += token.width;
		}
		if (current.length > 0 || paragraphLines.length === 0) {
			flushLine();
		}

		// 段落内的行统一按累计高度摆放
		let cursor = y;
		for (const line of paragraphLines) {
			line.y = cursor;
			cursor += line.height;
			lines.push(line);
		}
		y = cursor;

		if (marker) {
			markers.push({
				text: marker,
				x: marginLeft,
				y: paragraphLines[0]?.y ?? y - lineHeight,
				width: markerWidth - listGap,
				height: lineHeight,
				paragraphIndex,
			});
		}
	});

	return { lines, markers, height: Math.max(y, lineHeight) };
}
