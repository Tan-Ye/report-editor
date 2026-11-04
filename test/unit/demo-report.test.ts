import { beforeEach, describe, expect, it } from "vitest";
import { baseHeight, baseWidth } from "@/base";
import { buildDemoSteps, runDemoReport } from "@/lib/demo/report";
import { createPage, historyStore, pageStore, reportStore } from "@/store";

/**
 * 示例演示的测试。
 *
 * 跑的是命令层（agent 用的同一批函数），所以这组挂了往往意味着命令层出问题。
 * 演示是异步逐步执行的，这里把延迟调到 0 让它跑完。
 */
beforeEach(() => {
	pageStore.replacePages([createPage({ pageName: "页面 1" })], 0);
	historyStore.reset();
	reportStore.reset({ reportId: "r-demo", reportName: "演示" });
});

const runToEnd = (signal = new AbortController().signal) =>
	runDemoReport({
		signal,
		stepDelay: 0,
		getElementCount: () => pageStore.currentPage.elements.length,
	});

describe("示例演示", () => {
	it("拆成了多步（不是一次性画完）", () => {
		const steps = buildDemoSteps();
		// 新建页 + 背景 + 标题组 + 三张卡片 + 结论 + 收尾 = 8
		expect(steps.length).toBe(8);
	});

	it("新开一页，不动原来那页", async () => {
		await runToEnd();
		expect(pageStore.getPages()).toHaveLength(2);
		expect(pageStore.getPages()[0].elements).toHaveLength(0);
	});

	it("产出 18 个元素且都在页面范围内", async () => {
		const result = await runToEnd();
		// 标题组 3 + 三张卡片 12 + 结论 2 + 页脚 1
		expect(result.elementCount).toBe(18);
		for (const element of pageStore.currentPage.elements) {
			const { left = 0, top = 0, width = 0, height = 0 } = element.attrs;
			expect(left).toBeGreaterThanOrEqual(0);
			expect(top).toBeGreaterThanOrEqual(0);
			expect(left + width).toBeLessThanOrEqual(baseWidth);
			expect(top + height).toBeLessThanOrEqual(baseHeight);
		}
	});

	it("中止后停下，已画的部分保留", async () => {
		const controller = new AbortController();
		const promise = runDemoReport({
			signal: controller.signal,
			stepDelay: 0,
			getElementCount: () => pageStore.currentPage.elements.length,
		});
		controller.abort();
		const result = await promise;
		expect(result.stopped).toBe(true);
		expect(result.elementCount).toBeLessThan(18);
	});

	it("页面有背景色", async () => {
		await runToEnd();
		expect(pageStore.currentPage.style?.fill).toMatchObject({ kind: "solid" });
	});
});
