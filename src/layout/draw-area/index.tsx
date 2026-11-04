import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { EmptyCanvasHint } from "@/components/report/empty-canvas-hint";
import { CanvasOverlay } from "./canvas-overlay";
import { CropOverlay } from "./crop-overlay";
import { ElementContextMenu } from "./element-context-menu";
import { useBrush } from "./use-brush";
import { useCanvas, useCanvasTeardown } from "./use-canvas";
import { useContextMenu } from "./use-context-menu";
import { useDrawing } from "./use-drawing";
import { useElementActions } from "./use-element-actions";
import { usePage } from "./use-page";
import { usePageThumbnail } from "./use-page-thumbnail";
import { useSelection } from "./use-selection";
import { useSnapping } from "./use-snapping";
import { useSpacePan } from "./use-space-pan";
import { useTextEditing } from "./use-text-editing";

export function DrawArea() {
	// 画布与白页只在这里创建一次；其它 hook 都等 canvas 就绪后再接管
	const { canvas, page, containerRef: boardContainer, stageRef, panBy, teardown } = useCanvas();

	// 依赖关系按「画布 → 选中 → 文本 → 绘制 → 元素动作 → 右键菜单 → 页面」串起来，
	// 跨 hook 的回调一律走参数，避免互相 import 造成循环依赖
	const { syncSelection } = useSelection(canvas, page);
	const { placeTextElement } = useTextEditing(canvas, syncSelection);
	const { cancelDrag } = useDrawing(canvas, placeTextElement);
	// 删除/复制/粘贴：右键菜单与快捷键共用同一套动作
	const elementActions = useElementActions(canvas, boardContainer, syncSelection);
	const contextMenu = useContextMenu(canvas, elementActions);
	// 当前页缩略图：必须在 usePage 之前 —— pageStore 按订阅顺序通知，
	// 换页时要先轮到它把旧页最后的状态抓下来，再让 usePage 重载画布
	usePageThumbnail(canvas);
	usePage(canvas, page, cancelDrag);
	// 空格 + 拖动平移：放大后靠它去够可视区外的部分
	useSpacePan({ canvas, containerRef: boardContainer, panBy });
	// 顶点吸附：拖动元素时靠近顶点/页面边角/参考线就贴上去
	useSnapping(canvas);
	// 画笔：切到画笔工具时打开自由绘制，落笔结束后把路径登记成普通元素
	useBrush(canvas);
	// 必须最后调用：React 按 hook 定义顺序执行清理，这样其它 hook 先摘掉监听、
	// 结束绘制，最后才 dispose 画布
	useCanvasTeardown(teardown);

	return (
		<ContextMenu>
			{/*
				布局类名写在 Trigger 上而不是 render 的 div 上：
				组件会把 className 合并进被渲染的元素，写在这里不会被覆盖掉
			*/}
			<ContextMenuTrigger
				className="canvas-grid relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-workspace"
				render={
					// 类名在 Trigger 和这里各写一遍：两份都生效也无害，避免组件只认其中一处
					// tabIndex：键盘快捷键只认画布区域（见 use-element-actions），点一下就聚焦
					<div
						ref={boardContainer}
						tabIndex={0}
						onMouseDown={(event) => event.currentTarget.focus({ preventScroll: true })}
						className="canvas-grid relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-workspace outline-none"
					>
						<div ref={stageRef} className="absolute inset-0" />
						{/* 刻度 / 参考线覆盖层：默认不吃事件，只有刻度条和参考线热区可交互 */}
						<CanvasOverlay />
						{/* 裁剪层：独立 fabric 画布，盖在画布上接管裁剪交互 */}
						<CropOverlay />
						{/* 空页提示：只在当前页没有元素时出现 */}
						<EmptyCanvasHint />
					</div>
				}
			/>
			<ElementContextMenu state={contextMenu} />
		</ContextMenu>
	);
}
