import { getActiveCanvas } from "./canvas-registry";

/**
 * Agent 执行期的画布锁。
 *
 * 为什么要锁：命令层改完 store 会触发整页重载（`use-page` 的 `loadPage` 会清空
 * 画布对象并 `discardActiveObject`）。如果用户这时正在拖元素或编辑文本，
 * 会被硬生生打断 —— 手动操作和 AI 操作就在物理上撞了。
 *
 * 锁的内容：
 * - 关掉框选和命中测试（用户点不中任何东西）
 * - 退出自由绘制（画笔模式下 isDrawingMode 会吞掉鼠标事件）
 * - 清掉当前选中（反正马上也要被重载掉）
 *
 * 注意：这是**执行层**的职责，命令层（report-commands）不碰画布 ——
 * 这样命令层仍然能脱离 UI 跑测试。
 */
/**
 * 获取画布锁，返回"释放"函数。
 *
 * 适合长时间任务（例如示例演示要分十几步、每步之间停顿），
 * 需要在任务开始时加锁、结束时释放。
 */
export function acquireCanvasLock(): () => void {
	const canvas = getActiveCanvas();
	if (!canvas) {
		return () => {};
	}

	const previous = {
		selection: canvas.selection,
		skipTargetFind: canvas.skipTargetFind,
		drawingMode: canvas.isDrawingMode,
	};

	canvas.discardActiveObject();
	canvas.selection = false;
	canvas.skipTargetFind = true;
	canvas.isDrawingMode = false;

	let released = false;
	return () => {
		if (released) {
			return;
		}
		released = true;
		canvas.selection = previous.selection;
		canvas.skipTargetFind = previous.skipTargetFind;
		canvas.isDrawingMode = previous.drawingMode;
		canvas.requestRenderAll();
	};
}

export async function withAgentCanvasLock<T>(task: () => Promise<T> | T): Promise<T> {
	const release = acquireCanvasLock();
	try {
		return await task();
	} finally {
		release();
	}
}
