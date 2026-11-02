import { useCallback, useEffect, useRef } from "react";
import * as fabric from "fabric";
import {
	TEXT_BOX_WIDTH,
	TEXT_ELEMENT_TYPE,
	TEXT_FONT_SIZE,
	TEXT_LINE_HEIGHT,
} from "@/base/elements";
import {
	assignProps,
	dumpElementFromObject,
	getElementDefinition,
	isElementLocked,
} from "@/lib/element-registry";
import { getReportPalette } from "@/lib/theme-tokens";
import { createUniqueId } from "@/lib/utils";
import { elementObjectMap, historyStore, pageStore, toolStore } from "@/store";

/** 文本工具落下时的占位文字：还没编辑也能看见框里有内容 */
const TEXT_PLACEHOLDER = "文本";

/**
 * 占位框：文本工具刚放下、还没编辑过的文本框。
 * 只记在内存里（WeakSet），不写进文件 —— 重新打开文件后都是正式文本。
 */
const placeholderTextBoxes = new WeakSet<fabric.FabricObject>();

/**
 * 文本元素：落框（占位文字 + 虚线框）、进入/退出编辑、空文本提示。
 * 画布实例由 use-canvas 创建，选中同步用 use-selection 的 syncSelection。
 */
export function useTextEditing(
	canvas: fabric.Canvas | null,
	syncSelection: (persist?: boolean) => void,
) {
	/** 落框入口的实现依赖编辑会话状态，通过 ref 转发给绘制 hook */
	const placeTextElementRef = useRef<((point: { x: number; y: number }) => void) | null>(null);

	useEffect(() => {
		if (!canvas) {
			return;
		}
		return setup(canvas);
	}, [canvas, syncSelection]);

	/**
	 * 挂上文本相关的事件与键盘监听，返回卸载函数。
	 * 单独写成函数是为了让内层函数声明里的 canvas 保持非空类型 ——
	 * TS 不会把参数的类型收窄带进内层函数。
	 */
	function setup(canvas: fabric.Canvas) {
		/** 结束文本输入时要摘掉的键盘监听 */
		let stopTextKeyWatcher: (() => void) | null = null;

		function clearTextKeyWatcher() {
			stopTextKeyWatcher?.();
			stopTextKeyWatcher = null;
		}

		/** 文本工具：在点击处放一个默认宽度、一行高的占位文本框，落完回到选择态 */
		function placeTextElement(point: { x: number; y: number }) {
			const definition = getElementDefinition(TEXT_ELEMENT_TYPE);
			if (!definition) {
				return;
			}

			const width = TEXT_BOX_WIDTH;
			const height = TEXT_FONT_SIZE * TEXT_LINE_HEIGHT;
			const object = definition.build({
				left: point.x,
				top: point.y,
				width,
				height,
				startX: point.x,
				startY: point.y,
				endX: point.x + width,
				endY: point.y + height,
			});

			// Textbox 的 left/top 会被内部文字布局重新算过，直接赋值会有偏移。
			// 这里按「实际包围盒」把左上角校回点击位置，跟它内部怎么算无关。
			if (object instanceof fabric.Textbox) {
				// 先补占位文字再校落点：Textbox 设了 text 会重新排版，顺序反了落点又偏
				object.set({ text: TEXT_PLACEHOLDER });
				placeholderTextBoxes.add(object);

				const bounds = object.getBoundingRect();
				object.set({
					left: object.left + (point.x - bounds.left),
					top: object.top + (point.y - bounds.top),
				});
				object.setCoords();
				updateTextOutline(object);
			}

			elementObjectMap.attach({ id: createUniqueId("element"), elementType: definition.type }, object);
			const info = dumpElementFromObject(object);
			if (info) {
				pageStore.addElementToCurrentPage(info);
			}
			// 必须真的加到画布上：setActiveObject 只是设为选中，不会把它渲染出来
			canvas.add(object);
			canvas.setActiveObject(object);
			canvas.requestRenderAll();
			historyStore.commit();

			// 放完回到选择态：元素保持选中，双击才进入编辑
			toolStore.setTool("select");
		}

		function startTextEditing(textbox: fabric.Textbox) {
			if (!canvas.getActiveObjects().includes(textbox)) {
				canvas.setActiveObject(textbox);
			}
			textbox.enterEditing();
			textbox.selectAll();
		}

		/** 进入编辑态：接管回车（fabric 默认会把回车当成换行） */
		function handleTextEditingEntered(opt: { target: fabric.IText }) {
			clearTextKeyWatcher();
			const target = opt.target;
			const onKeyDown = (event: KeyboardEvent) => {
				// 回车结束编辑，Shift+回车保留为换行
				if (event.key !== "Enter" || event.shiftKey) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				if (target.isEditing) {
					target.exitEditing();
				}
			};
			window.addEventListener("keydown", onKeyDown, true);
			stopTextKeyWatcher = () => window.removeEventListener("keydown", onKeyDown, true);
		}

		/** 双击文本进入编辑 */
		function handleTextDblClick(opt: { target?: fabric.FabricObject }) {
			const target = opt.target;
			if (!(target instanceof fabric.Textbox) || isElementLocked(target)) {
				return;
			}
			startTextEditing(target);
		}

		/**
		 * 虚线框：占位框（还没编辑过）和空文本都要显示 ——
		 * 前者表示框里的字还不是正式内容，后者表示空文本在画布上完全看不见。
		 */
		function updateTextOutline(textbox: fabric.Textbox) {
			const palette = getReportPalette();
			const needsOutline = placeholderTextBoxes.has(textbox) || textbox.text.trim() === "";
			assignProps(textbox, {
				stroke: needsOutline ? palette.shapeStroke : undefined,
				strokeWidth: needsOutline ? 1 : 0,
				strokeDashArray: needsOutline ? [4, 4] : null,
				strokeUniform: true,
			});
		}

		/** 结束编辑：空文本也保留 —— 删掉的话用户想再点它就无从点起 */
		function handleTextEditingExited(opt: { target: fabric.IText }) {
			clearTextKeyWatcher();
			const target = opt.target;

			// 切页/撤销恢复时画布会被清空，这时退出编辑不写回数据
			if (!canvas.getObjects().includes(target)) {
				return;
			}

			if (target instanceof fabric.Textbox) {
				// 退出编辑＝内容定稿：占位状态摘掉；内容为空时虚线框仍然保留
				placeholderTextBoxes.delete(target);
				updateTextOutline(target);
			}

			// 编辑过程中内容和宽高都会变，整份回写
			syncSelection(true);
			canvas.requestRenderAll();
			historyStore.commit();
		}

		placeTextElementRef.current = placeTextElement;

		canvas.on("mouse:dblclick", handleTextDblClick);
		canvas.on("text:editing:entered", handleTextEditingEntered);
		canvas.on("text:editing:exited", handleTextEditingExited);

		return () => {
			canvas.off("mouse:dblclick", handleTextDblClick);
			canvas.off("text:editing:entered", handleTextEditingEntered);
			canvas.off("text:editing:exited", handleTextEditingExited);
			clearTextKeyWatcher();
			placeTextElementRef.current = null;
		};
	}

	/** 文本工具落框：交给 use-drawing 在 mouse:down 时调用 */
	const placeTextElement = useCallback((point: { x: number; y: number }) => {
		placeTextElementRef.current?.(point);
	}, []);

	return { placeTextElement };
}
