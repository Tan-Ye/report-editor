/**
 * 富文本的数据模型（纯数据，和 fabric / Tiptap 都无关）。
 *
 * 结构：文本元素 = 若干段落；段落 = 若干 run（连续同款文字）。
 * 行高、字体、字号、对齐这些"元素级默认"仍放在 attrs 上；
 * 段落/run 只存**覆盖项**，没有覆盖就继承元素默认。
 *
 * 这样存文件不依赖编辑库版本：Tiptap 只是在编辑时把这份模型转成
 * ProseMirror 文档，提交时再转回来。
 */

export type RichTextAlign = "left" | "center" | "right";

export type RichTextListKind = "bullet" | "ordered";

/** 字符级样式覆盖 */
export interface RichTextMark {
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strike?: boolean;
	/** #rrggbb；缺省继承元素 fill */
	color?: string;
	/** 超链接地址；画布上渲染成蓝字下划线，Ctrl+点击打开 */
	link?: string;
}

/** 一段连续同款文字 */
export interface RichTextRun {
	text: string;
	marks?: RichTextMark;
}

/** 项目符号 / 编号列表 */
export interface RichTextList {
	kind: RichTextListKind;
	/** 层级，0 开始；v1 支持 0~3 */
	level: number;
	/** 有序列表起始序号，缺省 1 */
	start?: number;
}

export interface RichTextParagraph {
	runs: RichTextRun[];
	/** 段落对齐；缺省继承元素 textAlign */
	align?: RichTextAlign;
	/** 首行缩进（px）；缺省 0 */
	indent?: number;
	list?: RichTextList;
}

export type RichTextDoc = RichTextParagraph[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const finiteNumber = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const MAX_INDENT = 400;
const MAX_LIST_LEVEL = 3;

function parseMark(raw: unknown): RichTextMark | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const mark: RichTextMark = {};
	if (raw.bold === true) {
		mark.bold = true;
	}
	if (raw.italic === true) {
		mark.italic = true;
	}
	if (raw.underline === true) {
		mark.underline = true;
	}
	if (raw.strike === true) {
		mark.strike = true;
	}
	if (typeof raw.color === "string" && raw.color.trim()) {
		mark.color = raw.color.trim();
	}
	if (typeof raw.link === "string" && raw.link.trim()) {
		mark.link = raw.link.trim();
	}
	return Object.keys(mark).length > 0 ? mark : undefined;
}

function parseRun(raw: unknown): RichTextRun | undefined {
	if (!isRecord(raw) || typeof raw.text !== "string" || !raw.text) {
		return undefined;
	}
	const marks = parseMark(raw.marks);
	return marks ? { text: raw.text, marks } : { text: raw.text };
}

function sameMarks(left: RichTextMark | undefined, right: RichTextMark | undefined): boolean {
	const a = left ?? {};
	const b = right ?? {};
	return (
		a.bold === b.bold &&
		a.italic === b.italic &&
		a.underline === b.underline &&
		a.strike === b.strike &&
		a.color === b.color &&
		a.link === b.link
	);
}

/** 合并相邻同款 run，避免编辑器每一次按键都留下碎片 */
function mergeRuns(runs: RichTextRun[]): RichTextRun[] {
	const merged: RichTextRun[] = [];
	for (const run of runs) {
		if (!run.text) {
			continue;
		}
		const previous = merged[merged.length - 1];
		if (previous && sameMarks(previous.marks, run.marks)) {
			previous.text += run.text;
			continue;
		}
		merged.push({ ...run });
	}
	return merged;
}

function parseList(raw: unknown): RichTextList | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const kind = raw.kind === "ordered" ? "ordered" : raw.kind === "bullet" ? "bullet" : undefined;
	if (!kind) {
		return undefined;
	}
	const level = Math.min(Math.max(Math.round(finiteNumber(raw.level) ?? 0), 0), MAX_LIST_LEVEL);
	const start = finiteNumber(raw.start);
	return {
		kind,
		level,
		...(kind === "ordered" && start !== undefined && start > 0
			? { start: Math.round(start) }
			: {}),
	};
}

/**
 * 把任意来源（文件、agent、旧版纯文本）还原成富文本模型。
 *
 * 认不出来就当成一段空文本，不抛错 —— 文件是外部输入。
 */
export function normalizeRichText(raw: unknown): RichTextDoc {
	if (!Array.isArray(raw)) {
		return [{ runs: [] }];
	}
	const paragraphs: RichTextParagraph[] = [];
	for (const item of raw) {
		if (!isRecord(item)) {
			continue;
		}
		const runs = Array.isArray(item.runs)
			? mergeRuns(item.runs.map(parseRun).filter((run): run is RichTextRun => Boolean(run)))
			: [];
		const paragraph: RichTextParagraph = { runs };
		if (item.align === "left" || item.align === "center" || item.align === "right") {
			paragraph.align = item.align;
		}
		const indent = finiteNumber(item.indent);
		if (indent !== undefined && indent > 0) {
			paragraph.indent = Math.min(Math.round(indent), MAX_INDENT);
		}
		const list = parseList(item.list);
		if (list) {
			paragraph.list = list;
		}
		paragraphs.push(paragraph);
	}
	return paragraphs.length > 0 ? paragraphs : [{ runs: [] }];
}

/** 纯文本：段落之间用换行连接（agent、校验、搜索都用它） */
export function richTextToPlainText(paragraphs: RichTextDoc): string {
	return paragraphs
		.map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
		.join("\n");
}

/** 纯文本 → 富文本（旧文件、agent 只给 text 时的兼容入口） */
export function plainTextToRichText(text: string): RichTextDoc {
	const lines = text.split("\n");
	return lines.map((line) => ({ runs: line ? [{ text: line }] : [] }));
}

/** 富文本是否"没有内容"（空段落不算内容） */
export function isRichTextEmpty(paragraphs: RichTextDoc): boolean {
	return paragraphs.every((paragraph) => paragraph.runs.every((run) => !run.text.trim()));
}
