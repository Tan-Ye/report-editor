import { useCallback, useEffect } from "react";
import * as fabric from "fabric";
import { getAlignOffset, unionBounds, type AlignDirection } from "@/lib/align";
import { assignProps, dumpElementFromObject } from "@/lib/element-registry";
import { ELEMENT_COMMAND, emitter, type ElementCommandPayload } from "@/lib/emitter";
import {
	coordination,
	elementObjectMap,
	historyStore,
	pageStore,
	type ElementInfo,
} from "@/store";

/** 收集画布上当前选中的受管元素（多选时是多个） */
function collectSelectedElements(canvas: fabric.Canvas): ElementInfo[] {
	const elements: ElementInfo[] = [];
	for (const object of canvas.getActiveObjects()) {
		const info = dumpElementFromObject(object);
		if (info) {
			elements.push(info);
		}
	}
	return elements;
}

/**
 * 选中状态、变换与对齐。
 * 画布实例由 use-canvas 创建，这里只接管事件、同步 store。
 */
export function useSelection(canvas: fabric.Canvas | null) {
	/**
	 * 同步选中状态到 store。
	 * persist 为真时把属性写回当前页 —— 拖动/缩放、以及对齐之后都需要。
	 */
	const syncSelection = useCallback(
		(persist = false) => {
			if (!canvas) {
				return;
			}
			const elements = collectSelectedElements(canvas);
			coordination.onSelectionChange({
				ids: elements.map((element) => element.id),
				primary: elements.length === 1 ? elements[0] : null,
			});
			if (persist && elements.length > 0) {
				pageStore.batchUpdateElementsInCurrentPage(elements);
			}
		},
		[canvas],
	);

	useEffect(() => {
		if (!canvas) {
			return;
		}
		return setup(canvas);
	}, [canvas, syncSelection]);

	/**
	 * 挂上选中/变换事件与对齐命令，返回卸载函数。
	 * 单独写成函数是为了让内层函数声明里的 canvas 保持非空类型 ——
	 * TS 不会把参数的类型收窄带进内层函数。
	 */
	function setup(canvas: fabric.Canvas) {
		/** 选中变化：只同步状态 */
		function handleSelectionChange() {
			syncSelection();
		}

		/** 用户拖动/缩放/旋转结束：同步状态 + 回写页面数据 + 记一步历史 */
		function handleObjectsModified() {
			syncSelection(true);
			historyStore.commit();
		}

		/**
		 * 以选中元素的整体包围盒为基准对齐。
		 * 少于 2 个没有意义（对齐自己等于没动），单个元素对齐页面走右键菜单。
		 */
		function alignSelectedElements(direction: AlignDirection) {
			const objects = canvas
				.getActiveObjects()
				.filter((object) => elementObjectMap.getRef(object) !== undefined);
			if (objects.length < 2) {
				return;
			}

			// 多选时对象坐标是相对 ActiveSelection 的，必须先解除选中再改 left/top，
			// 改完再把选中恢复回来。
			canvas.discardActiveObject();

			const items = objects.map((object) => ({ object, box: object.getBoundingRect() }));
			const target = unionBounds(items.map((item) => item.box));
			if (!target) {
				return;
			}

			for (const { object, box } of items) {
				const { dx, dy } = getAlignOffset(box, target, direction);
				if (dx === 0 && dy === 0) {
					continue;
				}
				assignProps(object, {
					left: (object.left ?? 0) + dx,
					top: (object.top ?? 0) + dy,
				});
			}

			canvas.setActiveObject(new fabric.ActiveSelection(objects));
			canvas.requestRenderAll();
			syncSelection(true);
			historyStore.commit();
		}

		canvas.on("selection:created", handleSelectionChange);
		canvas.on("selection:updated", handleSelectionChange);
		canvas.on("selection:cleared", handleSelectionChange);
		canvas.on("object:modified", handleObjectsModified);

		// 顶栏发来的元素命令（对齐等）
		const unsubscribeCommand = emitter.on<ElementCommandPayload>(ELEMENT_COMMAND, (payload) => {
			if (payload?.type === "align") {
				alignSelectedElements(payload.direction);
			}
		});

		return () => {
			canvas.off("selection:created", handleSelectionChange);
			canvas.off("selection:updated", handleSelectionChange);
			canvas.off("selection:cleared", handleSelectionChange);
			canvas.off("object:modified", handleObjectsModified);
			unsubscribeCommand();
		};
	}

	return { syncSelection };
}
