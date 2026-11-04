import { beforeEach, describe, expect, it } from "vitest";
import {
	addElement,
	addGuide,
	addPage,
	batchCommands,
	deleteElement,
	getDocumentSummary,
	getPageDetail,
	setPageFill,
	updateElement,
} from "@/lib/report-commands";
import { createPage, historyStore, pageStore, reportStore } from "@/store";

/** 每个用例从"一页空白文档 + 干净历史"开始 */
beforeEach(() => {
	pageStore.replacePages([createPage({ pageName: "页面 1" })], 0);
	historyStore.reset();
	reportStore.reset({ reportId: "r-test", reportName: "测试报告" });
});

const currentPage = () => pageStore.currentPage;

describe("新增页面", () => {
	it("页数 +1 并切到新页", () => {
		const before = pageStore.getPages().length;
		const result = addPage({ name: "图表页" });

		expect(result.ok).toBe(true);
		expect(pageStore.getPages()).toHaveLength(before + 1);
		expect(pageStore.state.current).toBe(before);
		expect(currentPage().pageName).toBe("图表页");
	});

	it("不传名字时自动编号", () => {
		addPage();
		expect(currentPage().pageName).toBe("页面 2");
	});
});

describe("新增元素", () => {
	it("给了 text 的文本元素能落下去", () => {
		const result = addElement({
			elementType: "text",
			attrs: { text: "季度经营分析", left: 100, top: 80 },
		});
		expect(result.ok).toBe(true);
		expect(result.data?.elementId).toBeTruthy();
		expect(currentPage().elements).toHaveLength(1);
		expect(currentPage().elements[0].attrs.text).toBe("季度经营分析");
	});

	it("文本元素没有 text 直接拒绝（空文本存盘会被丢掉）", () => {
		const result = addElement({ elementType: "text", attrs: {} });
		expect(result.ok).toBe(false);
		expect(result.message).toContain("attrs.text");
		expect(currentPage().elements).toHaveLength(0);
	});

	it("未知类型拒绝，并在提示里列出可用类型", () => {
		const result = addElement({ elementType: "chart", attrs: {} });
		expect(result.ok).toBe(false);
		expect(result.message).toContain("不认识元素类型");
		expect(result.message).toContain("rect");
	});

	it("不传位置时居中，不传尺寸时用默认值", () => {
		const result = addElement({ elementType: "rect", attrs: {} });
		expect(result.ok).toBe(true);
		const attrs = currentPage().elements[0].attrs;
		expect(attrs.width).toBe(480);
		expect(attrs.height).toBe(280);
		// 960 - 480/2 = 720；540 - 280/2 = 400
		expect(attrs.left).toBe(720);
		expect(attrs.top).toBe(400);
	});

	it("填充会被归一化：纯色字符串也能用", () => {
		addElement({ elementType: "rect", attrs: { fill: "#2563eb" } });
		expect(currentPage().elements[0].attrs.fill).toEqual({ kind: "solid", color: "#2563eb" });
	});

	it("image 元素缺图片填充时拒绝", () => {
		const result = addElement({ elementType: "image", attrs: {} });
		expect(result.ok).toBe(false);
		expect(result.message).toContain("image");
	});

	it("线条不需要 height", () => {
		const result = addElement({ elementType: "line-solid", attrs: { length: 600 } });
		expect(result.ok).toBe(true);
		expect(currentPage().elements[0].attrs.height).toBeUndefined();
	});
});

describe("修改与删除元素", () => {
	it("只覆盖传进来的字段", () => {
		const created = addElement({
			elementType: "rect",
			attrs: { left: 10, top: 20, width: 100, height: 50 },
		});
		const id = String(created.data?.elementId);

		const result = updateElement({ elementId: id, attrs: { left: 300 } });
		expect(result.ok).toBe(true);
		const attrs = currentPage().elements[0].attrs;
		expect(attrs.left).toBe(300);
		// 其它字段保持原样
		expect(attrs.width).toBe(100);
		expect(attrs.top).toBe(20);
	});

	it("跨页也能按 id 改（元素 id 全文档唯一）", () => {
		const first = addElement({ elementType: "rect", attrs: {} });
		addPage({ name: "第二页" });
		const id = String(first.data?.elementId);

		expect(updateElement({ elementId: id, attrs: { left: 42 } }).ok).toBe(true);
		expect(pageStore.getPages()[0].elements[0].attrs.left).toBe(42);
	});

	it("删掉之后页面上就没有了", () => {
		const created = addElement({ elementType: "rect", attrs: {} });
		const id = String(created.data?.elementId);
		expect(deleteElement({ elementId: id }).ok).toBe(true);
		expect(currentPage().elements).toHaveLength(0);
	});

	it("改不存在的元素会报错", () => {
		expect(updateElement({ elementId: "nope", attrs: { left: 1 } }).ok).toBe(false);
		expect(deleteElement({ elementId: "nope" }).ok).toBe(false);
	});
});

describe("页面背景与参考线", () => {
	it("背景支持纯色字符串和 FillSpec", () => {
		expect(setPageFill({ fill: "#ffffff" }).ok).toBe(true);
		expect(currentPage().style?.fill).toEqual({ kind: "solid", color: "#ffffff" });

		expect(
			setPageFill({
				fill: {
					kind: "gradient",
					type: "linear",
					angle: 90,
					stops: [
						{ offset: 0, color: "#ffffff", alpha: 1 },
						{ offset: 1, color: "#e2e8f0", alpha: 1 },
					],
				},
			}).ok,
		).toBe(true);
		expect(currentPage().style?.fill).toMatchObject({ kind: "gradient", angle: 90 });
	});

	it("传 null 清空背景", () => {
		setPageFill({ fill: "#000000" });
		expect(setPageFill({ fill: null }).ok).toBe(true);
		expect(currentPage().style?.fill).toBeUndefined();
	});

	it("参考线位置按 10 取整并夹在页面内", () => {
		expect(addGuide({ axis: "x", position: 123.4 }).ok).toBe(true);
		expect(addGuide({ axis: "y", position: 5000 }).ok).toBe(true);
		expect(currentPage().guides).toEqual([
			{ axis: "x", position: 120 },
			{ axis: "y", position: 1080 },
		]);
	});
});

describe("读取接口", () => {
	it("概览列出页数和元素数", () => {
		addElement({ elementType: "rect", attrs: {} });
		addPage({ name: "第二页" });
		const summary = getDocumentSummary();
		expect(summary.reportName).toBe("测试报告");
		expect(summary.pageCount).toBe(2);
		expect(summary.pages[0].elementCount).toBe(1);
		expect(summary.pages[1].elementCount).toBe(0);
	});

	it("页面明细带元素 id 和类型，便于模型继续操作", () => {
		addElement({ elementType: "rect", attrs: { left: 5 } });
		const detail = getPageDetail();
		expect(detail.ok).toBe(true);
		const elements = (detail.data as { elements: { id: string; elementType: string }[] }).elements;
		expect(elements[0].elementType).toBe("rect");
		expect(elements[0].id).toBeTruthy();
	});

	it("找不存在的页会报错", () => {
		expect(getPageDetail("nope").ok).toBe(false);
	});
});

describe("撤销与画布刷新", () => {
	it("一个命令正好一步撤销", () => {
		addPage({ name: "第一笔" });
		addElement({ elementType: "rect", attrs: {} });
		expect(currentPage().elements).toHaveLength(1);

		historyStore.undo();
		expect(currentPage().elements).toHaveLength(0);
		historyStore.undo();
		expect(pageStore.getPages()).toHaveLength(1);

		historyStore.redo();
		expect(pageStore.getPages()).toHaveLength(2);
	});

	it("命令会 bump revision，画布才会重载", () => {
		const before = pageStore.state.revision;
		addElement({ elementType: "rect", attrs: {} });
		expect(pageStore.state.revision).toBeGreaterThan(before);
	});
});

describe("批量执行", () => {
	it("多个命令合并成一次重载 + 一步撤销", () => {
		const revisionBefore = pageStore.state.revision;

		const ids = batchCommands(() => {
			const a = addElement({ elementType: "rect", attrs: {} });
			const b = addElement({ elementType: "text", attrs: { text: "标题" } });
			return [a.data?.elementId, b.data?.elementId];
		});

		// 三个元素在批量里都能看到彼此（读的是工作副本）
		expect(ids).toHaveLength(2);
		expect(currentPage().elements).toHaveLength(2);
		// 只 bump 一次 revision
		expect(pageStore.state.revision).toBe(revisionBefore + 1);

		// 一步撤销回到批量之前
		historyStore.undo();
		expect(currentPage().elements).toHaveLength(0);
	});

	it("批量里能接着改前面新增的元素（读的是工作副本）", () => {
		batchCommands(() => {
			const created = addElement({ elementType: "rect", attrs: { left: 10 } });
			const id = String(created.data?.elementId);
			expect(updateElement({ elementId: id, attrs: { left: 200 } }).ok).toBe(true);
		});
		expect(currentPage().elements[0].attrs.left).toBe(200);
	});

	it("批量里一个命令都没成功时不产生空的撤销步", () => {
		const revisionBefore = pageStore.state.revision;
		batchCommands(() => {
			addElement({ elementType: "text", attrs: {} }); // 会失败
		});
		expect(pageStore.state.revision).toBe(revisionBefore);
		expect(historyStore.getSnapshot().canUndo).toBe(false);
	});
});
