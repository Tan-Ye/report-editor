import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import * as fabric from "fabric";
import { createElementFromInfo } from "@/lib/element/registry";
import { createUniqueId } from "@/lib/utils";
import {
	coordination,
	demoStore,
	elementObjectMap,
	historyStore,
	pageStore,
	selectionStore,
	toolStore,
	type ElementInfo,
} from "@/store";

/** 场景坐标点（页面坐标，和元素 attrs 里的 left/top 同一个坐标系） */
export interface ScenePoint {
	x: number;
	y: number;
}

/** 元素动作的统一入口：右键菜单和快捷键都走这里，保证两条路的语义完全一样 */
export interface ElementActions {
	/** 按 id 删除（多选时一次删一批） */
	deleteElements: (ids: string[]) => boolean;
	/** 按 id 复制到应用内剪贴板 */
	copyElements: (ids: string[]) => boolean;
	/** 粘贴。`at` 是场景坐标：粘出来的内容左上角对齐到这里；不传就用鼠标最后的位置 */
	paste: (at?: ScenePoint) => boolean;
}

/** 同一处连续粘贴时每次错开的距离（场景单位），否则两次粘贴完全重叠、看着像没粘上 */
const PASTE_OFFSET_STEP = 20;

/**
 * 应用内剪贴板：复制下来的元素快照。
 *
 * **和系统剪贴板完全隔离**：不读也不写 `navigator.clipboard`。
 * 复制元素不会冲掉用户在别处复制的文字，外部复制的图文也不会被粘进画布。
 * 一个窗口一份（每个窗口是独立 store），关窗口即失效。
 */
let clipboard: ElementInfo[] | null = null;
/** 同一位置连续粘贴的次数 */
let pasteRound = 0;
/** 上一次粘贴用的锚点 */
let lastPastePoint: ScenePoint | null = null;

const numberOf = (value: unknown): number =>
	typeof value === "number" && Number.isFinite(value) ? value : 0;

/** 剪贴板里所有元素的左上角：粘贴时用它对齐鼠标位置 */
function clipboardOrigin(): ScenePoint {
	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	for (const element of clipboard ?? []) {
		left = Math.min(left, numberOf(element.attrs.left));
		top = Math.min(top, numberOf(element.attrs.top));
	}
	return {
		x: Number.isFinite(left) ? left : 0,
		y: Number.isFinite(top) ? top : 0,
	};
}

/** 剪贴板里有没有内容（右键菜单据此决定「粘贴」能不能点） */
export function hasClipboardContent(): boolean {
	return clipboard !== null && clipboard.length > 0;
}

/**
 * 元素的批量动作：删除、复制、粘贴。
 *
 * 元素数据一律从 **store** 读，不从 fabric 对象读：
 * 多选时子对象的 left/top 是相对 ActiveSelection 的，读出来会把整组的位置算错。
 * store 里的元素几何在每次拖动/改属性后都会回写，和画布是一致的。
 */
export function useElementActions(
	canvas: fabric.Canvas | null,
	containerRef: RefObject<HTMLDivElement | null>,
	syncSelection: (persist?: boolean) => void,
): ElementActions {
	/** 鼠标在画布上的最后位置（场景坐标）：Ctrl+V 就粘在这儿 */
	const pointerRef = useRef<ScenePoint | null>(null);

	useEffect(() => {
		if (!canvas) {
			return;
		}
		const record = (opt: { e?: Event }) => {
			if (!opt.e) {
				return;
			}
			const point = canvas.getScenePoint(opt.e as MouseEvent);
			pointerRef.current = { x: point.x, y: point.y };
		};
		canvas.on("mouse:move", record);
		canvas.on("mouse:down", record);
		return () => {
			canvas.off("mouse:move", record);
			canvas.off("mouse:down", record);
		};
	}, [canvas]);

	const deleteElements = useCallback(
		(ids: string[]) => {
			if (!canvas || ids.length === 0) {
				return false;
			}
			// 先解除选中：多选时子对象挂在 ActiveSelection 下面，带着选区删会留下悬空状态
			canvas.discardActiveObject();
			for (const id of ids) {
				const object = elementObjectMap.getObject(id);
				if (!object) {
					continue;
				}
				elementObjectMap.delete(id);
				canvas.remove(object);
			}
			// 页面数据按 id 删：画布上造不出对象的未知类型元素也要一起删掉
			coordination.onElementsDelete(ids);
			canvas.requestRenderAll();
			historyStore.commit();
			syncSelection();
			return true;
		},
		[canvas, syncSelection],
	);

	const copyElements = useCallback((ids: string[]) => {
		if (ids.length === 0) {
			return false;
		}
		const wanted = new Set(ids);
		// store 里的顺序就是层叠顺序，粘贴出来的副本也按这个顺序叠
		const elements = pageStore.currentPage.elements.filter((element) => wanted.has(element.id));
		if (elements.length === 0) {
			return false;
		}
		// 存快照：之后原元素怎么改都不影响剪贴板；锁定状态不跟着走，副本要能选中
		clipboard = elements.map((element) => {
			const attrs = structuredClone(element.attrs);
			delete attrs.locked;
			return { elementType: element.elementType, id: element.id, attrs };
		});
		pasteRound = 0;
		lastPastePoint = null;
		return true;
	}, []);

	const paste = useCallback(
		(at?: ScenePoint) => {
			if (!canvas || !clipboard || clipboard.length === 0) {
				return false;
			}

			// 位置：优先用调用方给的（右键点击处），否则用鼠标最后的位置
			const anchor = at ?? pointerRef.current;
			const origin = clipboardOrigin();
			let offsetX: number;
			let offsetY: number;

			if (anchor) {
				// 同一处连续粘贴就逐次错开，避免完全重叠
				const sameSpot =
					lastPastePoint !== null &&
					Math.hypot(anchor.x - lastPastePoint.x, anchor.y - lastPastePoint.y) < 1;
				pasteRound = sameSpot ? pasteRound + 1 : 0;
				lastPastePoint = anchor;
				offsetX = anchor.x - origin.x + pasteRound * PASTE_OFFSET_STEP;
				offsetY = anchor.y - origin.y + pasteRound * PASTE_OFFSET_STEP;
			} else {
				// 鼠标还没进过画布（纯键盘操作）：从原位置错开
				pasteRound += 1;
				offsetX = pasteRound * PASTE_OFFSET_STEP;
				offsetY = pasteRound * PASTE_OFFSET_STEP;
			}

			const added: { info: ElementInfo; object: fabric.FabricObject }[] = [];
			for (const element of clipboard) {
				const info: ElementInfo = {
					elementType: element.elementType,
					id: createUniqueId("element"),
					attrs: {
						...structuredClone(element.attrs),
						left: numberOf(element.attrs.left) + offsetX,
						top: numberOf(element.attrs.top) + offsetY,
					},
				};
				// 类型未注册（旧文件里的未知元素）造不出对象，跳过而不是往 store 里塞看不见的东西
				const object = createElementFromInfo(info);
				if (!object) {
					continue;
				}
				canvas.add(object);
				added.push({ info, object });
			}
			if (added.length === 0) {
				return false;
			}

			pageStore.batchAddElementsToCurrentPage(added.map((item) => item.info));
			// 多选时对象坐标是相对选区的，所以先解除选中、再用新对象建一个选区
			canvas.discardActiveObject();
			const objects = added.map((item) => item.object);
			canvas.setActiveObject(
				objects.length === 1 ? objects[0] : new fabric.ActiveSelection(objects),
			);
			canvas.requestRenderAll();
			syncSelection();
			historyStore.commit();
			// 粘出来就是要接着摆的：顺手切回选择工具
			toolStore.setTool("select");
			return true;
		},
		[canvas, syncSelection],
	);

	/**
	 * 快捷键：
	 * - Delete / Backspace 删除选中元素（多选一次删完）
	 * - Ctrl/Cmd + C       复制选中元素
	 * - Ctrl/Cmd + V       粘贴到鼠标位置
	 *
	 * 监听挂在**画布容器**上（not window）：容器是 tabIndex=0 的可聚焦元素，
	 * 点画布时聚焦（见 draw-area/index.tsx）。焦点在属性面板输入框、抽屉里时，
	 * 键盘事件根本不会经过容器 —— 不用再自己判断"是不是在输入框里"。
	 * 文本编辑也天然让路：fabric 的隐藏 textarea 挂在 body 上，键盘事件不经过容器。
	 */
	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			// 裁剪/富文本编辑态有自己的键处理，其它快捷键让路
			if (toolStore.getCroppingId() || toolStore.getEditingTextId()) {
				return;
			}
			// 示例演示期间画布被锁、历史被抑制，快捷键不要掺进去
			if (demoStore.isRunning()) {
				return;
			}

			if (event.ctrlKey || event.metaKey) {
				if (event.altKey) {
					return;
				}
				const key = event.key.toLowerCase();
				if (key === "c" && copyElements(selectionStore.getIds())) {
					event.preventDefault();
					return;
				}
				if (key === "v" && paste()) {
					event.preventDefault();
				}
				return;
			}

			if (event.key === "Delete" || event.key === "Backspace") {
				if (deleteElements(selectionStore.getIds())) {
					event.preventDefault();
				}
			}
		};

		container.addEventListener("keydown", handleKeyDown);
		return () => {
			container.removeEventListener("keydown", handleKeyDown);
		};
	}, [containerRef, copyElements, deleteElements, paste]);

	return useMemo<ElementActions>(
		() => ({ deleteElements, copyElements, paste }),
		[deleteElements, copyElements, paste],
	);
}
