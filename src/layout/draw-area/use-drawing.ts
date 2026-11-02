import { useCallback, useEffect, useRef } from "react";
import * as fabric from "fabric";
import { TEXT_ELEMENT_TYPE, lineStyleToElementType } from "@/base/elements";
import { toast } from "@/components/ui/toast";
import {
	assignProps,
	getElementDefinition,
	snapshotElementInfo,
	type DragBox,
	type ElementDefinition,
} from "@/lib/element-registry";
import { createUniqueId } from "@/lib/utils";
import { elementObjectMap, historyStore, pageStore, toolStore, type ToolId } from "@/store";

/** 单击（没有拖出范围）时使用的默认元素尺寸 */
const DEFAULT_ELEMENT_WIDTH = 240;
const DEFAULT_ELEMENT_HEIGHT = 160;

/** 拖拽小于这个像素就当成单击 */
const MIN_DRAG_SIZE = 4;

/** 线条按住 Shift 时的吸附步长：45° */
const SNAP_STEP = Math.PI / 4;

/** 当前工具对应的元素类型；选择工具返回 null */
function resolveElementType(): string | null {
	const tool = toolStore.getActiveTool();
	if (tool === "rect") {
		return "rect";
	}
	if (tool === "line") {
		return lineStyleToElementType(toolStore.getLineStyle());
	}
	if (tool === "shape") {
		return toolStore.getShapeType();
	}
	if (tool === "text") {
		return TEXT_ELEMENT_TYPE;
	}
	return null;
}

/**
 * 拖拽绘制状态机：起框、预览、定稿，外加 Shift 跟踪与指针移出画布的收尾。
 *
 * 文本不走拖拽流程，落框交给 use-text-editing 的 placeTextElement（由参数传入，
 * 避免两个 hook 互相依赖）。Shift 与 pointerleave 也留在这里：它们都要读写
 * 绘制会话的状态（dragging / lastPoint / lockedRatio），拆出去只会把内部状态外泄。
 */
export function useDrawing(
	canvas: fabric.Canvas | null,
	placeTextElement: (point: { x: number; y: number }) => void,
) {
	/** 取消绘制要能被 use-page 在同步页面时调用，实现依赖绘制会话，走 ref 转发 */
	const cancelDragRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		if (!canvas) {
			return;
		}
		return setup(canvas);
	}, [canvas, placeTextElement]);

	/**
	 * 挂上绘制用的事件与订阅，返回卸载函数。
	 * 单独写成函数是为了让内层函数声明里的 canvas 保持非空类型 ——
	 * TS 不会把参数的类型收窄带进内层函数。
	 */
	function setup(canvas: fabric.Canvas) {
		// ---------- 绘制态 ----------
		let dragging = false;
		let startPoint = { x: 0, y: 0 };
		/** 最后一次指针所在的场景坐标：按住 Shift 但不移动鼠标时，用它重绘预览 */
		let lastPoint = { x: 0, y: 0 };
		let pendingDefinition: ElementDefinition | null = null;
		/** 预览对象；每帧重建，定稿时把最后一个直接转正 */
		let preview: fabric.FabricObject | null = null;
		let lastBox: DragBox | null = null;
		/** Shift 锁定用的宽高比；null 表示不锁比例 */
		let lockedRatio: number | null = null;
		/** 上一帧 Shift 是否按下，用来识别「刚刚按下 Shift」这一刻 */
		let shiftDown = false;

		const toScenePoint = (event: Event) =>
			canvas.getScenePoint(event as unknown as MouseEvent);

		/**
		 * 把终点吸附到离它最近的 45° 方向上。
		 * 长度取指针在该方向上的投影，这样终点会跟着光标走，不会突然变长。
		 */
		function snapSegmentEnd(point: { x: number; y: number }) {
			const deltaX = point.x - startPoint.x;
			const deltaY = point.y - startPoint.y;
			const snappedAngle = Math.round(Math.atan2(deltaY, deltaX) / SNAP_STEP) * SNAP_STEP;
			const unitX = Math.cos(snappedAngle);
			const unitY = Math.sin(snappedAngle);
			const projected = Math.max(deltaX * unitX + deltaY * unitY, 0);

			return {
				x: startPoint.x + unitX * projected,
				y: startPoint.y + unitY * projected,
			};
		}

		/**
		 * 用起点和当前点算出拖拽框。
		 * - 线条类（segment）：Shift 把方向吸附到 45° 的整数倍，线条没有「比例」可锁
		 * - 其余元素：Shift 锁定宽高比，以变化较大的那一维为准，另一维按比例换算
		 */
		function makeBox(point: { x: number; y: number }, shiftKey: boolean): DragBox {
			if (shiftKey && pendingDefinition?.geometry === "segment") {
				const end = snapSegmentEnd(point);
				return {
					left: Math.min(startPoint.x, end.x),
					top: Math.min(startPoint.y, end.y),
					width: Math.max(Math.abs(end.x - startPoint.x), 1),
					height: Math.max(Math.abs(end.y - startPoint.y), 1),
					startX: startPoint.x,
					startY: startPoint.y,
					endX: end.x,
					endY: end.y,
				};
			}

			const deltaX = point.x - startPoint.x;
			const deltaY = point.y - startPoint.y;
			const directionX = deltaX < 0 ? -1 : 1;
			const directionY = deltaY < 0 ? -1 : 1;

			let width = Math.max(Math.abs(deltaX), 1);
			let height = Math.max(Math.abs(deltaY), 1);

			if (shiftKey) {
				// 拖拽一开始就按着 Shift → 1:1；中途按下 → 用按下那一刻的比例
				const ratio = lockedRatio ?? 1;
				if (width >= height) {
					height = width / ratio;
				} else {
					width = height * ratio;
				}
			}

			return {
				left: directionX < 0 ? startPoint.x - width : startPoint.x,
				top: directionY < 0 ? startPoint.y - height : startPoint.y,
				width,
				height,
				startX: startPoint.x,
				startY: startPoint.y,
				endX: startPoint.x + directionX * width,
				endY: startPoint.y + directionY * height,
			};
		}

		/** 只是点了一下没拖动：给一个默认大小的拖拽框 */
		function makeDefaultBox(definition: ElementDefinition): DragBox {
			if (definition.geometry === "segment") {
				return {
					left: startPoint.x,
					top: startPoint.y,
					width: DEFAULT_ELEMENT_WIDTH,
					height: 0,
					startX: startPoint.x,
					startY: startPoint.y,
					endX: startPoint.x + DEFAULT_ELEMENT_WIDTH,
					endY: startPoint.y,
				};
			}
			return {
				left: startPoint.x - DEFAULT_ELEMENT_WIDTH / 2,
				top: startPoint.y - DEFAULT_ELEMENT_HEIGHT / 2,
				width: DEFAULT_ELEMENT_WIDTH,
				height: DEFAULT_ELEMENT_HEIGHT,
				startX: startPoint.x,
				startY: startPoint.y,
				endX: startPoint.x + DEFAULT_ELEMENT_WIDTH / 2,
				endY: startPoint.y + DEFAULT_ELEMENT_HEIGHT / 2,
			};
		}

		// 用较长的那一维判断：锁比例时会有一条边被压得很短，不能算作「点击」
		const isTooSmall = (box: DragBox, definition: ElementDefinition) =>
			definition.geometry === "segment"
				? Math.hypot(box.endX - box.startX, box.endY - box.startY) < MIN_DRAG_SIZE
				: Math.max(box.width, box.height) < MIN_DRAG_SIZE;

		/**
		 * 预览对象每帧重建。
		 * 不走「基准图形 + scaleX 拉伸」：那样虚线间距、箭头大小都会跟着被拉变形。
		 */
		function renderPreview(box: DragBox) {
			if (!pendingDefinition) {
				return;
			}
			const object = pendingDefinition.build(box);
			assignProps(object, { selectable: false, evented: false, objectCaching: false });
			if (preview) {
				canvas.remove(preview);
			}
			preview = object;
			lastBox = box;
			canvas.add(object);
			canvas.requestRenderAll();
		}

		function dropPreview() {
			if (!preview) {
				return;
			}
			canvas.remove(preview);
			preview = null;
			canvas.requestRenderAll();
		}

		/**
		 * 跟踪 Shift 的状态变化：
		 * 按下的那一瞬间，把当前预览的宽高比记下来锁定；松开就解除。
		 * （线条不锁比例，这个值对它们没有作用）
		 */
		function syncShiftKey(shiftKey: boolean) {
			if (shiftKey && !shiftDown && lastBox) {
				lockedRatio = lastBox.height > 0 ? lastBox.width / lastBox.height : 1;
			}
			if (!shiftKey) {
				lockedRatio = null;
			}
			shiftDown = shiftKey;
		}

		/** 取消绘制：预览对象直接扔掉，不产生元素 */
		function cancelDrag() {
			if (!dragging) {
				return;
			}
			dragging = false;
			pendingDefinition = null;
			lastBox = null;
			lockedRatio = null;
			shiftDown = false;
			dropPreview();
			toolStore.setDrawing(false);
		}

		/** 结束绘制：把最后一个预览对象转成正式元素 */
		function finishDrag() {
			if (!dragging) {
				return;
			}
			dragging = false;
			toolStore.setDrawing(false);

			const definition = pendingDefinition;

			if (definition && lastBox && isTooSmall(lastBox, definition)) {
				renderPreview(makeDefaultBox(definition));
			}

			const object = preview;
			pendingDefinition = null;
			preview = null;
			lastBox = null;
			lockedRatio = null;
			shiftDown = false;

			// 无论这次有没有生成元素，一次绘制结束都回到选择态
			toolStore.setTool("select");

			if (!object || !definition) {
				return;
			}

			// 预览期关掉的交互要还回来，否则新元素选不中
			assignProps(object, { selectable: true, evented: true });

			elementObjectMap.attach({ id: createUniqueId("element"), elementType: definition.type }, object);
			const info = snapshotElementInfo(object);
			if (info) {
				pageStore.addElementToCurrentPage(info);
			}

			canvas.setActiveObject(object);
			canvas.requestRenderAll();
			historyStore.commit();
		}

		function handleMouseDown(opt: { e: Event }) {
			if (dragging) {
				return;
			}
			const nativeEvent = opt.e as MouseEvent;
			// 只响应左键；右键菜单走 contextmenu 事件，中键留给以后的手势
			if (typeof nativeEvent.button === "number" && nativeEvent.button !== 0) {
				return;
			}
			const elementType = resolveElementType();
			if (!elementType) {
				return;
			}
			const definition = getElementDefinition(elementType);
			if (!definition) {
				// 工具存在但元素类型没注册：不静默失败，给用户明确反馈
				toast.add({
					title: "无法创建元素",
					type: "error",
					description: `元素类型「${elementType}」尚未注册`,
				});
				return;
			}

			// 文本是「点一下就落一个框」，不走拖拽流程
			if (definition.type === TEXT_ELEMENT_TYPE) {
				placeTextElement(toScenePoint(opt.e));
				return;
			}

			startPoint = toScenePoint(opt.e);
			lastPoint = { x: startPoint.x, y: startPoint.y };
			// 拖拽一开始就按着 Shift，就按 1:1 起步（线条则是先按水平方向起步）
			shiftDown = nativeEvent.shiftKey === true;
			lockedRatio = shiftDown ? 1 : null;
			pendingDefinition = definition;
			dragging = true;
			toolStore.setDrawing(true);
			renderPreview(makeBox(startPoint, shiftDown));
		}

		function handleMouseMove(opt: { e: Event }) {
			if (!dragging) {
				return;
			}
			const point = toScenePoint(opt.e);
			lastPoint = { x: point.x, y: point.y };
			const shiftKey = (opt.e as MouseEvent).shiftKey === true;
			syncShiftKey(shiftKey);
			renderPreview(makeBox(lastPoint, shiftKey));
		}

		function handleMouseUp() {
			if (!dragging) {
				return;
			}
			finishDrag();
		}

		/** 指针离开画布＝mouseup：用最后一帧预览的范围定稿 */
		function handlePointerLeave() {
			if (!dragging) {
				return;
			}
			finishDrag();
		}

		/** 按住/松开 Shift 时立刻重绘预览，不必等下一次鼠标移动 */
		function handleShiftKey(event: KeyboardEvent) {
			if (event.key !== "Shift" || !dragging) {
				return;
			}
			const shiftKey = event.type === "keydown";
			// 长按会触发系统自动重复的 keydown，状态没变就不用重绘
			if (shiftKey === shiftDown) {
				return;
			}
			syncShiftKey(shiftKey);
			renderPreview(makeBox(lastPoint, shiftKey));
		}

		// ---------- 工具模式 ----------
		function applyMode(tool: ToolId) {
			const isDrawingTool = tool !== "select";
			canvas.selection = !isDrawingTool;
			// 绘制态关掉命中检测：鼠标压在已有元素上也不会触发它的点击/拖拽
			canvas.skipTargetFind = isDrawingTool;
			canvas.defaultCursor = isDrawingTool ? "crosshair" : "default";
			if (isDrawingTool) {
				canvas.discardActiveObject();
			}
			canvas.requestRenderAll();
		}

		let currentTool = toolStore.getActiveTool();
		applyMode(currentTool);

		canvas.on("mouse:down", handleMouseDown);
		canvas.on("mouse:move", handleMouseMove);
		canvas.on("mouse:up", handleMouseUp);
		canvas.upperCanvasEl.addEventListener("pointerleave", handlePointerLeave);
		window.addEventListener("keydown", handleShiftKey);
		window.addEventListener("keyup", handleShiftKey);

		const unsubscribeTool = toolStore.subscribe(() => {
			const next = toolStore.getActiveTool();
			if (next === currentTool) {
				return;
			}
			currentTool = next;
			cancelDrag();
			applyMode(next);
		});

		cancelDragRef.current = cancelDrag;

		return () => {
			unsubscribeTool();
			cancelDrag();
			canvas.off("mouse:down", handleMouseDown);
			canvas.off("mouse:move", handleMouseMove);
			canvas.off("mouse:up", handleMouseUp);
			canvas.upperCanvasEl.removeEventListener("pointerleave", handlePointerLeave);
			window.removeEventListener("keydown", handleShiftKey);
			window.removeEventListener("keyup", handleShiftKey);
			cancelDragRef.current = null;
		};
	}

	/** 取消绘制（切页、恢复历史时用）：实现依赖会话状态，通过 ref 转发 */
	const cancelDrag = useCallback(() => {
		cancelDragRef.current?.();
	}, []);

	return { cancelDrag };
}
