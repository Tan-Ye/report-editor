import { describe, expect, it } from "vitest";
import { layoutRichText, type RichTextMeasure, type RichTextMetrics } from "@/lib/element/rich-layout";
import type { RichTextDoc } from "@/lib/element/rich-text";

/** 假测量：每个字符固定 10px，方便断言 */
const measure: RichTextMeasure = (text) => text.length * 10;

const metrics: RichTextMetrics = {
	fontSize: 10,
	fontFamily: "Inter",
	lineHeight: 2,
	textAlign: "left",
};

const layout = (paragraphs: RichTextDoc, width = 100) =>
	layoutRichText({ paragraphs, width, metrics, measure });

describe("layoutRichText 断行", () => {
	it("中文逐字断行，行高按 fontSize × lineHeight", () => {
		const result = layout([{ runs: [{ text: "一二三四五六七八九十一二三四五六七八九十一二三四五" }] }]);
		expect(result.lines.map((line) => line.text)).toEqual([
			"一二三四五六七八九十",
			"一二三四五六七八九十",
			"一二三四五",
		]);
		expect(result.lines.map((line) => line.y)).toEqual([0, 20, 40]);
		expect(result.height).toBe(60);
	});

	it("首行缩进只少吃第一行的宽度", () => {
		const result = layout([{ runs: [{ text: "一二三四五六七八九十一二三四五六七八九十" }], indent: 20 }]);
		expect(result.lines.map((line) => line.text)).toEqual([
			"一二三四五六七八",
			"九十一二三四五六七八",
			"九十",
		]);
		expect(result.lines[0].x).toBe(20);
		expect(result.lines[1].x).toBe(0);
	});

	it("长单词不拆开，放不下就整体换行", () => {
		const result = layout([{ runs: [{ text: "hello world" }] }]);
		expect(result.lines.map((line) => line.text)).toEqual(["hello ", "world"]);
	});
});

describe("layoutRichText 列表", () => {
	it("项目符号单独一行，正文悬挂对齐", () => {
		const result = layout([{ runs: [{ text: "一二三四五六七八九十一二三四五" }], list: { kind: "bullet", level: 0 } }]);
		expect(result.markers).toHaveLength(1);
		expect(result.markers[0]).toMatchObject({ text: "•", x: 0 });
		// 符号 10px + 间距 6px
		expect(result.lines[0].x).toBe(16);
		expect(result.lines[1].x).toBe(16);
	});

	it("有序列表连续累加，start 只对新开的一组生效", () => {
		const result = layout([
			{ runs: [{ text: "a" }], list: { kind: "ordered", level: 0, start: 7 } },
			{ runs: [{ text: "b" }], list: { kind: "ordered", level: 0 } },
			{ runs: [{ text: "c" }], list: { kind: "ordered", level: 0 } },
		]);
		expect(result.markers.map((marker) => marker.text)).toEqual(["7.", "8.", "9."]);
	});

	it("普通段落会打断编号", () => {
		const result = layout([
			{ runs: [{ text: "a" }], list: { kind: "ordered", level: 0 } },
			{ runs: [{ text: "断了" }] },
			{ runs: [{ text: "b" }], list: { kind: "ordered", level: 0 } },
		]);
		expect(result.markers.map((marker) => marker.text)).toEqual(["1.", "1."]);
	});
});

describe("layoutRichText 对齐与样式", () => {
	it("居中和右对齐按可用宽度算偏移", () => {
		const centered = layout([{ runs: [{ text: "一二三四" }], align: "center" }]);
		expect(centered.lines[0].x).toBe(30);

		const right = layout([{ runs: [{ text: "一二三四" }], align: "right" }]);
		expect(right.lines[0].x).toBe(60);
	});

	it("每个字符带上自己的 run 样式", () => {
		const result = layout([
			{
				runs: [
					{ text: "粗", marks: { bold: true } },
					{ text: "普" },
					{ text: "链", marks: { link: "https://example.com" } },
				],
			},
		]);
		expect(result.lines[0].styles).toEqual([
			{ bold: true },
			undefined,
			{ link: "https://example.com" },
		]);
	});

	it("空段落也占一行，避免高度为 0", () => {
		const result = layout([{ runs: [] }]);
		expect(result.lines).toHaveLength(1);
		expect(result.lines[0].text).toBe("");
		expect(result.height).toBe(20);
	});
});
