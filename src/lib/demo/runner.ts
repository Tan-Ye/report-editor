import { toast } from "@/components/ui/toast";
import { demoStore, pageStore } from "@/store";
import { acquireCanvasLock } from "../agent/session";
import { runDemoReport } from "./report";
import { commitHistoryNow, setHistorySuppressed } from "../report/commands";

/**
 * 示例演示的调度：加锁 → 抑制历史 → 逐步执行 → 补一步历史 → 解锁。
 *
 * 放 lib 而不是 hook：顶栏按钮和空页提示卡都要能启动演示，
 * 用一个模块级的中止句柄比传 props 简单。
 */

let current: AbortController | null = null;

export function isDemoRunning(): boolean {
	return current !== null;
}

/** 开始演示；已在跑就直接返回，不叠加 */
export async function startDemo(): Promise<void> {
	if (current) {
		return;
	}
	const controller = new AbortController();
	current = controller;
	demoStore.set({ running: true, step: "准备中…" });

	// 演示期间用户不能操作：锁画布（点不中任何元素、不能框选、退出自由绘制）
	const release = acquireCanvasLock();
	// 每一步都要重载画布，但整场只占一步撤销
	setHistorySuppressed(true);

	let elementCount = 0;
	try {
		const result = await runDemoReport({
			signal: controller.signal,
			getElementCount: () => pageStore.currentPage.elements.length,
			onStep: (step, index, total) => {
				demoStore.set({ step: `${index + 1}/${total} ${step.label}` });
			},
		});
		elementCount = result.elementCount;
		if (elementCount > 0) {
			commitHistoryNow();
		}
		if (result.stopped) {
			toast.add({
				title: "示例已停止",
				description: `已画 ${elementCount} 个元素，Ctrl+Z 可整体撤销`,
				type: "info",
			});
		} else {
			toast.add({
				title: "示例完成",
				description: `新增一页，${elementCount} 个元素。Ctrl+Z 可以整体撤销`,
				type: "success",
			});
		}
	} catch (error) {
		toast.add({
			title: "示例生成失败",
			description: error instanceof Error ? error.message : String(error),
			type: "error",
		});
	} finally {
		setHistorySuppressed(false);
		release();
		current = null;
		demoStore.set({ running: false, step: "" });
	}
}

/** 停止演示：保留已画的部分，由 startDemo 的收尾补历史 */
export function stopDemo(): void {
	current?.abort();
}
