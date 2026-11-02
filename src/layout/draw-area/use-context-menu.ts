import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import * as fabric from "fabric";
import {
	applyElementLock,
	isElementLocked,
	readElementInfo,
} from "@/lib/element-registry";
import {
	coordination,
	elementObjectMap,
	historyStore,
	pageStore,
	type ElementInfo,
} from "@/store";
import type { ElementContextMenuState, LayerDirection } from "./element-context-menu";

/**
 * 右键菜单：菜单状态与本层的所有操作回调（删除/锁定/层级）。
 * 菜单组件只负责渲染，碰 fabric 的部分都在这里。
 */
export function useContextMenu(canvas: fabric.Canvas | null) {
	/** 右键菜单的目标元素与操作回调；null 表示菜单不显示 */
	const [contextMenu, setContextMenu] = useState<ElementContextMenuState | null>(null);

	useEffect(() => {
		if (!canvas) {
			return;
		}
		return setup(canvas);
	}, [canvas]);

	/**
	 * 挂上右键菜单的命中监听，返回卸载函数。
	 * 单独写成函数是为了让内层函数声明里的 canvas 保持非空类型 ——
	 * TS 不会把参数的类型收窄带进内层函数。
	 */
	function setup(canvas: fabric.Canvas) {
		/**
		 * 用 fabric 自己的 contextmenu 事件：它已经把命中结果算好了（opt.target），
		 * 而且监听挂在画布元素上，一定早于外层菜单触发器的冒泡监听。
		 * 数据必须用 flushSync 同步提交 —— 菜单是在同一个事件里立刻打开的。
		 */
		function handleContextMenu(opt: { target?: fabric.FabricObject }) {
			const target = opt.target;
			const info = target ? readElementInfo(target) : null;

			if (!target || !info) {
				// 空白处或白页背景：不弹菜单
				flushSync(() => setContextMenu(null));
				return;
			}

			const locked = isElementLocked(target);
			// 锁定的元素不可选中，但右键仍然要能命中它，否则解不了锁
			if (!locked) {
				canvas.setActiveObject(target);
			}

			const objects = canvas.getObjects();
			const index = objects.indexOf(target);
			const lastIndex = objects.length - 1;

			flushSync(() => {
				setContextMenu({
					element: info,
					locked,
					// index 0 永远是白页，元素最低只能到 1
					canForward: index >= 0 && index < lastIndex,
					canBackward: index > 1,
					onDelete: () => {
						canvas.discardActiveObject();
						canvas.remove(target);
						elementObjectMap.deleteByObject(target);
						coordination.onElementDelete(info);
						canvas.requestRenderAll();
						historyStore.commit();
						setContextMenu(null);
					},
					onToggleLock: () => {
						const nextLocked = !isElementLocked(target);
						applyElementLock(target, nextLocked);
						const nextInfo = readElementInfo(target);
						if (nextInfo) {
							pageStore.updateElementInCurrentPage(nextInfo);
						}
						// 选中状态由 selection:cleared / selection:created 事件统一同步
						if (nextLocked) {
							canvas.discardActiveObject();
						} else {
							canvas.setActiveObject(target);
						}
						canvas.requestRenderAll();
						historyStore.commit();
						setContextMenu(null);
					},
					onMove: (direction: LayerDirection) => {
						moveElementLayer(target, direction);
						setContextMenu(null);
					},
				});
			});
		}

		/** 调整元素的层叠顺序。白页固定在最底层，不参与排序 */
		function moveElementLayer(target: fabric.FabricObject, direction: LayerDirection) {
			const objects = canvas.getObjects();
			const from = objects.indexOf(target);
			const lastIndex = objects.length - 1;
			if (from === -1) {
				return;
			}

			const desired =
				direction === "front"
					? lastIndex
					: direction === "back"
						? 1
						: direction === "forward"
							? from + 1
							: from - 1;
			const next = Math.min(Math.max(desired, 1), lastIndex);
			if (next === from) {
				return;
			}

			// 用「移除 + 按最终下标插入」来排序：insertAt 的 index 就是最终位置
			canvas.remove(target);
			canvas.insertAt(next, target);
			canvas.requestRenderAll();

			// 只按新顺序重排数组、复用现有的 ElementInfo 对象：不重新 dump，
			// 这样历史快照里的元素对象继续共享，也不会丢掉画布上没有的元素（比如未注册类型）
			const orderIds = canvas
				.getObjects()
				.map((object) => elementObjectMap.getRef(object)?.id)
				.filter((id): id is string => Boolean(id));
			const byId = new Map<string, ElementInfo>();
			for (const element of pageStore.currentPage.elements) {
				byId.set(element.id, element);
			}
			const usedIds = new Set(orderIds);
			const placed = orderIds
				.map((id) => byId.get(id))
				.filter((element): element is ElementInfo => element !== undefined);
			const unplaced = pageStore.currentPage.elements.filter(
				(element) => !usedIds.has(element.id),
			);

			pageStore.updateCurrentPage({
				...pageStore.currentPage,
				elements: [...placed, ...unplaced],
			});
			historyStore.commit();
		}

		canvas.on("contextmenu", handleContextMenu);

		return () => {
			canvas.off("contextmenu", handleContextMenu);
		};
	}

	return contextMenu;
}
