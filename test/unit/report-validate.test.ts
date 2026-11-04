import { describe, expect, it } from "vitest";
import { KNOWN_ELEMENT_TYPES } from "@/base/elements";
import { isClean, summarizeIssues, validateReportJson } from "@/lib/report/validate";
import fixtureJson from "../fixtures/report-v1.json";

/**
 * 金标报告既是"格式基准"，也是给 agent 看的 few-shot 样例：
 * 它必须**完全干净**—— 一旦它本身会触发警告，说明样例已经和程序对不上了。
 */
describe("validateReportJson：金标报告", () => {
	const validation = validateReportJson(fixtureJson);

	it("零问题", () => {
		expect(validation.issues).toEqual([]);
		expect(validation.ok).toBe(true);
		expect(isClean(validation)).toBe(true);
	});

	it("用到的元素类型都是已注册类型", () => {
		const types = new Set(
			validation.file?.pages.flatMap((page) => page.elements.map((el) => el.elementType)),
		);
		expect(types.size).toBeGreaterThan(0);
		for (const type of types) {
			expect(KNOWN_ELEMENT_TYPES).toContain(type);
		}
	});
});

describe("validateReportJson：输入形态", () => {
	it("接受 JSON 字符串", () => {
		const validation = validateReportJson(JSON.stringify(fixtureJson));
		expect(validation.ok).toBe(true);
		expect(validation.issues).toEqual([]);
	});

	it("非法 JSON → error", () => {
		const validation = validateReportJson("{ 不是 json");
		expect(validation.ok).toBe(false);
		expect(validation.file).toBeNull();
		expect(validation.issues[0]).toMatchObject({ level: "error", code: "not-an-object" });
	});

	it("不是对象 → error", () => {
		expect(validateReportJson([1, 2, 3]).issues[0].code).toBe("not-an-object");
		expect(validateReportJson(null).issues[0].code).toBe("not-an-object");
	});
});

describe("validateReportJson：问题分类", () => {
	it("缺 reportId → missing-report-id（已自动修正，所以只是 warning）", () => {
		const validation = validateReportJson({ pages: [{ pageId: "p1", elements: [] }] });
		expect(validation.issues.map((issue) => issue.code)).toContain("missing-report-id");
		expect(validation.ok).toBe(true);
		expect(validation.file?.reportId).toBeTruthy();
	});

	it("未知元素类型 → unknown-element-type，带位置", () => {
		const validation = validateReportJson({
			reportId: "r1",
			pages: [
				{ pageId: "p1", elements: [] },
				{
					pageId: "p2",
					elements: [{ id: "e1", elementType: "future-chart", attrs: {} }],
				},
			],
		});
		const issue = validation.issues.find((item) => item.code === "unknown-element-type");
		expect(issue).toMatchObject({ level: "warning", path: "pages[1].elements[0]" });
		// 数据本身还在
		expect(validation.file?.pages[1].elements[0].elementType).toBe("future-chart");
	});

	it("版本比程序新 → future-version", () => {
		const validation = validateReportJson({
			version: 999,
			reportId: "r1",
			pages: [{ pageId: "p1", elements: [] }],
		});
		expect(validation.issues.map((issue) => issue.code)).toContain("future-version");
	});

	it("摘要只取前几条，其余折成数量", () => {
		const validation = validateReportJson({
			reportId: "r1",
			pages: [
				{
					pageId: "p1",
					elements: [
						{ id: "a", elementType: "future-a", attrs: {} },
						{ id: "b", elementType: "future-b", attrs: {} },
						{ id: "c", elementType: "future-c", attrs: {} },
					],
				},
			],
		});
		const summary = summarizeIssues(validation, 2);
		// 这份数据同时会触发「缺 version」警告，所以按实际条数断言，别写死
		expect(validation.issues.length).toBeGreaterThan(2);
		expect(summary).toContain(`还有 ${validation.issues.length - 2} 条`);
	});
});
