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
export async function withAgentCanvasLock<T>(task: () => Promise<T> | T): Promise<T> {
	const canvas = getActiveCanvas();
	if (!canvas) {
		// 没有画布（例如测试环境）就直接执行
		return await task();
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

	try {
		return await task();
	} finally {
		canvas.selection = previous.selection;
		canvas.skipTargetFind = previous.skipTargetFind;
		canvas.isDrawingMode = previous.drawingMode;
		canvas.requestRenderAll();
	}
}
