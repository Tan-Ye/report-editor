import {
	normalizeRichText,
	type RichTextAlign,
	type RichTextDoc,
	type RichTextListKind,
	type RichTextMark,
	type RichTextParagraph,
	type RichTextRun,
} from "./rich-text";

/**
 * 段落模型 ↔ ProseMirror 文档（Tiptap 的底层格式）。
 *
 * 这里只处理**纯 JSON**，不 import Tiptap：转换逻辑可以单测，
 * 编辑器组件只负责把 Tiptap 的 JSON 丢进来/拿出去。
 *
 * 约定：
 * - 段落 → paragraph，对齐/缩进放 attrs（textAlign / indent）
 * - 列表 → bulletList / orderedList + listItem（嵌套表示层级）
 * - 字符样式 → marks：bold / italic / underline / strike / link / textStyle.color
 */

interface PmMark {
	type: string;
	attrs?: Record<string, unknown>;
}

interface PmNode {
	type: string;
	attrs?: Record<string, unknown>;
	content?: PmNode[];
	text?: string;
	marks?: PmMark[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function marksOf(marks: RichTextMark | undefined): PmMark[] | undefined {
	if (!marks) {
		return undefined;
	}
	const result: PmMark[] = [];
	if (marks.bold) {
		result.push({ type: "bold" });
	}
	if (marks.italic) {
		result.push({ type: "italic" });
	}
	if (marks.underline) {
		result.push({ type: "underline" });
	}
	if (marks.strike) {
		result.push({ type: "strike" });
	}
	if (marks.color) {
		result.push({ type: "textStyle", attrs: { color: marks.color } });
	}
	if (marks.link) {
		result.push({ type: "link", attrs: { href: marks.link } });
	}
	return result.length > 0 ? result : undefined;
}

function paragraphNode(paragraph: RichTextParagraph): PmNode {
	const content: PmNode[] = [];
	for (const run of paragraph.runs) {
		if (!run.text) {
			continue;
		}
		const marks = marksOf(run.marks);
		content.push({
			type: "text",
			text: run.text,
			...(marks ? { marks } : {}),
		});
	}
	const attrs: Record<string, unknown> = {};
	if (paragraph.align) {
		attrs.textAlign = paragraph.align;
	}
	if (paragraph.indent) {
		attrs.indent = paragraph.indent;
	}
	return {
		type: "paragraph",
		...(Object.keys(attrs).length > 0 ? { attrs } : {}),
		...(content.length > 0 ? { content } : {}),
	};
}

interface PmListBuild {
	node: PmNode;
	next: number;
}

/** 从 index 开始构造一层列表；返回这颗子树和下一个未消费的下标 */
function buildList(
	paragraphs: RichTextDoc,
	index: number,
	kind: RichTextListKind,
	level: number,
	start: number | undefined,
): PmListBuild {
	const items: PmNode[] = [];
	let cursor = index;

	while (cursor < paragraphs.length) {
		const paragraph = paragraphs[cursor];
		const list = paragraph.list;
		if (!list || list.kind !== kind || list.level !== level) {
			break;
		}

		const itemContent: PmNode[] = [paragraphNode(paragraph)];
		cursor += 1;

		// 比当前层更深的后续段落，归到这一项的嵌套列表里
		const child = paragraphs[cursor];
		if (child?.list && child.list.level > level) {
			const nested = buildList(paragraphs, cursor, child.list.kind, child.list.level, child.list.start);
			itemContent.push(nested.node);
			cursor = nested.next;
		}

		items.push({ type: "listItem", content: itemContent });
	}

	return {
		node: {
			type: kind === "bullet" ? "bulletList" : "orderedList",
			...(kind === "ordered" && start !== undefined && start > 0 ? { attrs: { start } } : {}),
			content: items,
		},
		next: cursor,
	};
}

/** 段落模型 → ProseMirror 文档 JSON */
export function toProseMirrorDoc(paragraphs: RichTextDoc): PmNode {
	const content: PmNode[] = [];
	let index = 0;
	while (index < paragraphs.length) {
		const paragraph = paragraphs[index];
		if (paragraph.list) {
			const built = buildList(
				paragraphs,
				index,
				paragraph.list.kind,
				paragraph.list.level,
				paragraph.list.start,
			);
			content.push(built.node);
			index = built.next;
			continue;
		}
		content.push(paragraphNode(paragraph));
		index += 1;
	}
	return { type: "doc", content };
}

function markFromPm(mark: PmMark): RichTextMark | null {
	switch (mark.type) {
		case "bold":
			return { bold: true };
		case "italic":
			return { italic: true };
		case "underline":
			return { underline: true };
		case "strike":
			return { strike: true };
		case "link": {
			const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
			return href ? { link: href } : null;
		}
		case "textStyle": {
			const color = typeof mark.attrs?.color === "string" ? mark.attrs.color : "";
			return color ? { color } : null;
		}
		default:
			return null;
	}
}

function mergeMarkList(marks: PmMark[] | undefined): RichTextMark | undefined {
	if (!marks || marks.length === 0) {
		return undefined;
	}
	const merged: RichTextMark = {};
	for (const mark of marks) {
		const parsed = markFromPm(mark);
		if (!parsed) {
			continue;
		}
		Object.assign(merged, parsed);
	}
	return Object.keys(merged).length > 0 ? merged : undefined;
}

function paragraphFromPm(
	node: PmNode,
	list: { kind: RichTextListKind; level: number; start?: number } | undefined,
): RichTextParagraph {
	const runs: RichTextRun[] = [];
	for (const child of node.content ?? []) {
		if (child.type === "hardBreak") {
			runs.push({ text: "\n" });
			continue;
		}
		if (child.type !== "text" || typeof child.text !== "string" || !child.text) {
			continue;
		}
		const marks = mergeMarkList(child.marks);
		runs.push(marks ? { text: child.text, marks } : { text: child.text });
	}
	const paragraph: RichTextParagraph = { runs };
	const attrs = isRecord(node.attrs) ? node.attrs : {};
	if (attrs.textAlign === "left" || attrs.textAlign === "center" || attrs.textAlign === "right") {
		paragraph.align = attrs.textAlign as RichTextAlign;
	}
	if (typeof attrs.indent === "number" && Number.isFinite(attrs.indent) && attrs.indent > 0) {
		paragraph.indent = Math.round(attrs.indent);
	}
	if (list) {
		paragraph.list = { ...list };
	}
	return paragraph;
}

function readList(
	node: PmNode,
	level: number,
	out: RichTextDoc,
	start: number | undefined,
): void {
	let itemIndex = 0;
	for (const item of node.content ?? []) {
		if (item.type !== "listItem") {
			continue;
		}
		for (const child of item.content ?? []) {
			if (child.type === "paragraph") {
				out.push(
					paragraphFromPm(child, {
						kind: node.type === "orderedList" ? "ordered" : "bullet",
						level,
						// start 只挂在第一项上：排版层靠"接着上一项数"往下累加
						...(start !== undefined && itemIndex === 0 ? { start } : {}),
					}),
				);
				continue;
			}
			if (child.type === "bulletList" || child.type === "orderedList") {
				const nestedStart =
					child.type === "orderedList" && typeof child.attrs?.start === "number"
						? child.attrs.start
						: undefined;
				readList(child, level + 1, out, nestedStart);
			}
		}
		itemIndex += 1;
	}
}

/** ProseMirror 文档 JSON → 段落模型（容错：认不出的节点跳过） */
export function fromProseMirrorDoc(raw: unknown): RichTextDoc {
	if (!isRecord(raw) || !Array.isArray(raw.content)) {
		return [{ runs: [] }];
	}
	const paragraphs: RichTextParagraph[] = [];
	for (const child of raw.content as PmNode[]) {
		if (!isRecord(child) || typeof child.type !== "string") {
			continue;
		}
		if (child.type === "paragraph" || child.type === "heading") {
			paragraphs.push(paragraphFromPm(child as PmNode, undefined));
			continue;
		}
		if (child.type === "bulletList" || child.type === "orderedList") {
			const start =
				child.type === "orderedList" && typeof child.attrs?.start === "number"
					? child.attrs.start
					: undefined;
			readList(child as PmNode, 0, paragraphs, start);
			continue;
		}
		if (child.type === "hardBreak") {
			paragraphs.push({ runs: [] });
		}
	}
	return normalizeRichText(paragraphs);
}
