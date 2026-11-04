import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import * as fabric from "fabric";
import { IMAGE_ELEMENT_TYPE } from "@/base/elements";
import {
	applyElementLock,
	isElementLocked,
	readElementInfo,
} from "@/lib/element/registry";
import { elementObjectMap, historyStore, pageStore, toolStore, type ElementInfo } from "@/store";
import type { ElementContextMenuState, LayerDirection } from "./element-context-menu";
import { hasClipboardContent, type ElementActions, type ScenePoint } from "./use-element-actions";

/**
 * 右键菜单：菜单状态与本层的所有操作回调（复制/粘贴/删除/锁定/层级）。
 * 菜单组件只负责渲染，碰 fabric 的部分都在这里。
 *
 * 选中与删除都走「元素 id + 共享动作」：多选时右键落在选中项上，
 * 菜单应该作用于整组，而不是把多选塌成一个。
 */
export function useContextMenu(canvas: fabric.Canvas | null, actions: ElementActions) {
	/** 右键菜单的目标元素与操作回调；null 表示菜单不显示 */
	const [contextMenu, setContextMenu] = useState<ElementContextMenuState | null>(null);

	useEffect(() => {
		if (!canvas) {
			return;
		}
		return setup(canvas);
	}, [canvas, actions]);

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
		function handleContextMenu(opt: { target?: fabric.FabricObject; e?: Event }) {
			// 裁剪态不弹元素菜单
			if (toolStore.getCroppingId()) {
				flushSync(() => setContextMenu(null));
				return;
			}
			const target = opt.target;
			const info = target ? readElementInfo(target) : null;
			// 右键落点的场景坐标：粘贴就粘在这儿
			const point: ScenePoint | undefined = opt.e
				? canvas.getScenePoint(opt.e as MouseEvent)
				: undefined;

			if (!target || !info) {
				// 空白处：不提供元素操作，但剪贴板有内容时给一个「粘贴」
				const canPaste = hasClipboardContent();
				flushSync(() =>
					setContextMenu(
						canPaste
							? {
									kind: "canvas",
									canPaste,
									onPaste: () => {
										actions.paste(point);
										setContextMenu(null);
									},
								}
							: null,
					),
				);
				return;
			}

			const locked = isElementLocked(target);
			// 右键落在多选里的某个元素上时，菜单作用于整组；否则只作用于这一元素
			const activeObjects = canvas.getActiveObjects();
			const multi = activeObjects.length > 1 && activeObjects.includes(target);
			const ids = multi
				? activeObjects
						.map((object) => elementObjectMap.getRef(object)?.id)
						.filter((id): id is string => id !== undefined)
				: [info.id];

			// 单选态右键：把这个元素设为选中。锁定的元素不选 —— 它本来就选不中，
			// 选中了反而解不了锁（锁定的元素靠右键命中，见决策 7）
			if (!multi && !locked) {
				canvas.setActiveObject(target);
			}

			const objects = canvas.getObjects();
			const index = objects.indexOf(target);
			const lastIndex = objects.length - 1;

			flushSync(() => {
				setContextMenu({
					kind: "element",
					ids,
					single: ids.length === 1,
					locked,
					// index 0 永远是白页，元素最低只能到 1
					canForward: index >= 0 && index < lastIndex,
					canBackward: index > 1,
					canPaste: hasClipboardContent(),
					// 裁剪只对「单个 + 图片元素 + 未锁定」开放
					canCrop:
						ids.length === 1 &&
						info.elementType === IMAGE_ELEMENT_TYPE &&
						info.attrs.fill?.kind === "image" &&
						!locked,
					onCopy: () => {
						actions.copyElements(ids);
						setContextMenu(null);
					},
					onCrop: () => {
						if (ids[0]) {
							toolStore.startCropping(ids[0]);
						}
						setContextMenu(null);
					},
					onPaste: () => {
						actions.paste(point);
						setContextMenu(null);
					},
					onDelete: () => {
						actions.deleteElements(ids);
						setContextMenu(null);
					},
					onToggleLock: () => {
						toggleLock(ids[0]);
						setContextMenu(null);
					},
					onMove: (direction: LayerDirection) => {
						moveElementLayer(target, direction);
						setContextMenu(null);
					},
				});
			});
		}

		/** 单个元素的锁定/解锁（多选时菜单不提供这一项） */
		function toggleLock(id: string | undefined) {
			const object = id ? elementObjectMap.getObject(id) : undefined;
			if (!object) {
				return;
			}
			const nextLocked = !isElementLocked(object);
			applyElementLock(object, nextLocked);
			const nextInfo = readElementInfo(object);
			if (nextInfo) {
				pageStore.updateElementInCurrentPage(nextInfo);
			}
			// 选中状态由 selection:cleared / selection:created 事件统一同步
			if (nextLocked) {
				canvas.discardActiveObject();
			} else {
				canvas.setActiveObject(object);
			}
			canvas.requestRenderAll();
			historyStore.commit();
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
