import { describe, expect, it } from "vitest";
import { orphanDrafts, type DraftEntry } from "@/lib/report/service/library";
import { buildWindowUrl, parseOpenTarget } from "@/lib/report/service/window";

function makeDraft(overrides: Partial<DraftEntry> = {}): DraftEntry {
	return {
		root: "D:\\data",
		folder: "未命名报告-1",
		reportId: "report-1",
		reportName: "未命名报告",
		updatedAt: Date.now(),
		hasSavedCopy: false,
		...overrides,
	};
}

describe("孤儿草稿", () => {
	it("只留下没有正式报告的那些", () => {
		const drafts = [
			makeDraft({ reportId: "a", folder: "a" }),
			makeDraft({ reportId: "b", folder: "b", hasSavedCopy: true }),
		];
		expect(orphanDrafts(drafts).map((draft) => draft.reportId)).toEqual(["a"]);
	});

	it("全都有正式报告时是空的（不该天天弹提示框）", () => {
		expect(orphanDrafts([makeDraft({ hasSavedCopy: true })])).toEqual([]);
	});
});

describe("新窗口的打开参数", () => {
	const draftTarget = {
		area: "draft" as const,
		folder: "季度报告-8f3a",
		root: "D:\\报表\\report-editor",
	};
	const templateTarget = {
		area: "template" as const,
		folder: "月度模板-1a2b",
		root: "D:\\报表\\report-editor",
	};

	/** 写进 URL 的和从 URL 读出来的必须一模一样，否则新窗口打不开目标 */
	it("草稿：写出去再读回来是同一份目标", () => {
		const url = buildWindowUrl(draftTarget);
		expect(parseOpenTarget(url.slice(url.indexOf("?")))).toEqual(draftTarget);
	});

	it("模板：写出去再读回来是同一份目标", () => {
		const url = buildWindowUrl(templateTarget);
		expect(parseOpenTarget(url.slice(url.indexOf("?")))).toEqual(templateTarget);
	});

	it("没有目标时是空白窗口，解析回 null", () => {
		const url = buildWindowUrl(null);
		expect(url).toContain("new=1");
		expect(parseOpenTarget(url.slice(url.indexOf("?")))).toBeNull();
	});

	it("普通地址、缺目录、不认识的来源都当作没有目标", () => {
		expect(parseOpenTarget("")).toBeNull();
		expect(parseOpenTarget("?open=draft")).toBeNull();
		expect(parseOpenTarget("?open=template")).toBeNull();
		expect(parseOpenTarget("?open=report&folder=x")).toBeNull();
	});

	it("root 允许缺省（用当前默认目录）", () => {
		expect(parseOpenTarget("?open=template&folder=x")).toEqual({
			area: "template",
			folder: "x",
			root: "",
		});
	});
});
