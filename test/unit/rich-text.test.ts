import { describe, expect, it } from "vitest";
import {
	isRichTextEmpty,
	normalizeRichText,
	plainTextToRichText,
	richTextToPlainText,
} from "@/lib/element/rich-text";

describe("normalizeRichText", () => {
	it("相邻同款 run 合并", () => {
		const doc = normalizeRichText([
			{
				runs: [
					{ text: "加粗", marks: { bold: true } },
					{ text: "也加粗", marks: { bold: true } },
					{ text: "普通" },
				],
			},
		]);
		expect(doc).toEqual([
			{ runs: [{ text: "加粗也加粗", marks: { bold: true } }, { text: "普通" }] },
		]);
	});

	it("丢掉空 run 和认不出的标记", () => {
		const doc = normalizeRichText([
			{
				runs: [
					{ text: "" },
					{ text: "文字", marks: { bold: "yes", color: "  " } },
				],
			},
		]);
		expect(doc).toEqual([{ runs: [{ text: "文字" }] }]);
	});

	it("段落属性越界会夹住", () => {
		const doc = normalizeRichText([
			{ runs: [{ text: "a" }], indent: 9999, align: "center" },
			{ runs: [{ text: "b" }], list: { kind: "ordered", level: 9, start: 3 } },
			{ runs: [{ text: "c" }], list: { kind: "nope", level: 0 } },
		]);
		expect(doc[0]).toMatchObject({ indent: 400, align: "center" });
		expect(doc[1].list).toEqual({ kind: "ordered", level: 3, start: 3 });
		expect(doc[2].list).toBeUndefined();
	});

	it("空数组/非法值给一段空文本", () => {
		expect(normalizeRichText(null)).toEqual([{ runs: [] }]);
		expect(normalizeRichText([])).toEqual([{ runs: [] }]);
		expect(normalizeRichText([{ runs: "nope" }])).toEqual([{ runs: [] }]);
	});
});

describe("纯文本互转", () => {
	it("段落用换行连接", () => {
		const doc = normalizeRichText([
			{ runs: [{ text: "第一段" }] },
			{ runs: [{ text: "第二段" }, { text: "尾巴" }] },
		]);
		expect(richTextToPlainText(doc)).toBe("第一段\n第二段尾巴");
	});

	it("纯文本按换行拆成段落，空行保留段落", () => {
		expect(plainTextToRichText("a\n\nb")).toEqual([
			{ runs: [{ text: "a" }] },
			{ runs: [] },
			{ runs: [{ text: "b" }] },
		]);
	});

	it("空内容判定只看非空白字符", () => {
		expect(isRichTextEmpty([{ runs: [] }])).toBe(true);
		expect(isRichTextEmpty([{ runs: [{ text: "  " }] }])).toBe(true);
		expect(isRichTextEmpty([{ runs: [{ text: "x" }] }])).toBe(false);
	});
});
