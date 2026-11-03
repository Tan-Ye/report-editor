import { describe, expect, it } from "vitest";
// 直接 import JSON：不依赖 node:fs，测试在任何环境下都能跑
import fixtureJson from "../fixtures/report-v1.json";
import { applyReportFile, parseReportFile, toReportFile } from "@/store/report-file";

/**
 * 金标报告（golden report）：一份"能代表当前格式"的文档。
 *
 * 它随版本更新 —— 每次改格式（加字段、改语义）都要在这里补一条，
 * 让"打开 → 序列化 → 再打开"整条链路始终有回归样本。
 */
const fixture: unknown = fixtureJson;

const json = (value: unknown) => JSON.stringify(value);

describe("parseReportFile：金标报告", () => {
	it("能无损解析，且没有任何警告", () => {
		const result = parseReportFile(fixture);
		expect(result.warnings).toEqual([]);
		expect(result.file.reportId).toBe("report-fixture-v1");
		expect(result.file.pages).toHaveLength(2);
	});

	it("元素类型和顺序都保留", () => {
		const result = parseReportFile(fixture);
		const types = result.file.pages.map((page) => page.elements.map((el) => el.elementType));
		expect(types).toEqual([
			["text", "rect", "image", "line-solid"],
			["ellipse", "brush"],
		]);
	});

	it("页面背景、参考线、阴影、画笔路径都还在", () => {
		const result = parseReportFile(fixture);
		const cover = result.file.pages[0];
		expect(cover.style?.fill).toMatchObject({ kind: "gradient", angle: 90 });
		expect(cover.guides).toEqual([
			{ axis: "x", position: 120 },
			{ axis: "y", position: 240 },
		]);

		const card = cover.elements.find((el) => el.id === "el-fixture-card");
		expect(card?.attrs.shadow).toMatchObject({ blur: 18, offsetY: 6 });

		const stroke = result.file.pages[1].elements.find((el) => el.elementType === "brush");
		expect(Array.isArray(stroke?.attrs.path)).toBe(true);
	});
});

describe("序列化往返", () => {
	it("apply → toReportFile → 再 parse，结果稳定（幂等）", () => {
		const first = parseReportFile(fixture);
		applyReportFile(first.file);
		const serialized = toReportFile();

		const second = parseReportFile(JSON.parse(json(serialized)));
		expect(second.warnings).toEqual([]);

		applyReportFile(second.file);
		// 第二遍序列化的结果必须和第一遍完全一致，否则说明解析/序列化里有不对称
		expect(json(toReportFile())).toBe(json(serialized));
	});
});

describe("parseReportFile：容错", () => {
	it("缺 reportId 时补一个，并给警告", () => {
		const result = parseReportFile({ pages: [] });
		expect(result.file.reportId).not.toBe("");
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	it("元素 id 重复时重新生成，只留第一个", () => {
		const result = parseReportFile({
			reportId: "r1",
			pages: [
				{
					pageId: "p1",
					elements: [
						{ id: "same", elementType: "rect", attrs: { width: 10 } },
						{ id: "same", elementType: "rect", attrs: { width: 20 } },
					],
				},
			],
		});
		expect(result.file.pages[0].elements).toHaveLength(2);
		expect(result.file.pages[0].elements[1].id).not.toBe("same");
		expect(result.warnings.join()).toContain("重复");
	});

	it("不认识的元素类型要原样保留（否则旧版本打开一次就永久丢数据）", () => {
		const result = parseReportFile({
			reportId: "r1",
			pages: [
				{
					pageId: "p1",
					elements: [{ id: "chart-1", elementType: "future-chart", attrs: { kind: "bar" } }],
				},
			],
		});
		expect(result.file.pages[0].elements[0].elementType).toBe("future-chart");
		expect(result.file.pages[0].elements[0].attrs.kind).toBe("bar");
	});

	it("缺 elementType 的元素丢弃并警告", () => {
		const result = parseReportFile({
			reportId: "r1",
			pages: [{ pageId: "p1", elements: [{ id: "x", attrs: {} }] }],
		});
		expect(result.file.pages[0].elements).toHaveLength(0);
		expect(result.warnings.join()).toContain("elementType");
	});

	it("空文本元素读取时保留、落盘时丢弃", () => {
		const result = parseReportFile({
			reportId: "r1",
			pages: [
				{
					pageId: "p1",
					elements: [
						{ id: "t1", elementType: "text", attrs: { text: "   " } },
						{ id: "t2", elementType: "text", attrs: { text: "有内容" } },
					],
				},
			],
		});
		// 读的时候不动它：用户可能只是还没开始打字
		expect(result.file.pages[0].elements.map((el) => el.id)).toEqual(["t1", "t2"]);

		// 落盘时清掉：占位框写进文件就是垃圾数据
		applyReportFile(result.file);
		const serialized = toReportFile();
		expect(serialized.pages[0].elements.map((el) => el.id)).toEqual(["t2"]);
	});
});
