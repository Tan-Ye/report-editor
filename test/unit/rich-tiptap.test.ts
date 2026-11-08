import { describe, expect, it } from "vitest";
import { fromProseMirrorDoc, toProseMirrorDoc } from "@/lib/element/rich-tiptap";
import { normalizeRichText, type RichTextDoc } from "@/lib/element/rich-text";

const doc: RichTextDoc = normalizeRichText([
	{
		runs: [
			{ text: "标题", marks: { bold: true } },
			{ text: "正文", marks: { color: "#c00000" } },
		],
		align: "center",
		indent: 20,
	},
	{ runs: [{ text: "链接", marks: { link: "https://example.com" } }] },
	{ runs: [{ text: "项目一" }], list: { kind: "bullet", level: 0 } },
	{ runs: [{ text: "子项" }], list: { kind: "bullet", level: 1 } },
	{ runs: [{ text: "项目二" }], list: { kind: "bullet", level: 0 } },
	{ runs: [{ text: "第一" }], list: { kind: "ordered", level: 0, start: 3 } },
	{ runs: [{ text: "第二" }], list: { kind: "ordered", level: 0 } },
]);

describe("toProseMirrorDoc", () => {
	it("段落对齐/缩进和字符标记落到 attrs/marks", () => {
		const pm = toProseMirrorDoc(doc);
		const first = pm.content?.[0];
		expect(first?.type).toBe("paragraph");
		expect(first?.attrs).toEqual({ textAlign: "center", indent: 20 });
		expect(first?.content?.[0]).toMatchObject({
			type: "text",
			text: "标题",
			marks: [{ type: "bold" }],
		});
		expect(pm.content?.[1]?.content?.[0]?.marks).toEqual([
			{ type: "link", attrs: { href: "https://example.com" } },
		]);
	});

	it("列表转成 bulletList / orderedList，层级用嵌套表示", () => {
		const pm = toProseMirrorDoc(doc);
		const bullet = pm.content?.[2];
		expect(bullet?.type).toBe("bulletList");
		expect(bullet?.content).toHaveLength(2);
		// 子项挂在"项目一"这一项下面
		expect(bullet?.content?.[0].content?.[1]?.type).toBe("bulletList");

		const ordered = pm.content?.[3];
		expect(ordered).toMatchObject({ type: "orderedList", attrs: { start: 3 } });
		expect(ordered?.content).toHaveLength(2);
	});
});

describe("fromProseMirrorDoc", () => {
	it("往返后模型一致（含缩进、对齐、链接、颜色、嵌套列表、编号起始）", () => {
		const round = fromProseMirrorDoc(toProseMirrorDoc(doc));
		expect(round).toEqual(doc);
	});

	it("start 只落在每组编号的第一项", () => {
		const round = fromProseMirrorDoc(toProseMirrorDoc(doc));
		const ordered = round.filter((paragraph) => paragraph.list?.kind === "ordered");
		expect(ordered[0].list?.start).toBe(3);
		expect(ordered[1].list?.start).toBeUndefined();
	});

	it("认不出的输入退回一段空文本", () => {
		expect(fromProseMirrorDoc(null)).toEqual([{ runs: [] }]);
		expect(fromProseMirrorDoc({ type: "doc", content: [{ type: "image" }] })).toEqual([
			{ runs: [] },
		]);
	});

	it("空段落保留", () => {
		const round = fromProseMirrorDoc({
			type: "doc",
			content: [
				{ type: "paragraph" },
				{ type: "paragraph", content: [{ type: "text", text: "x" }] },
			],
		});
		expect(round).toHaveLength(2);
		expect(round[0].runs).toEqual([]);
	});
});
