import { useCallback, useEffect, useRef } from "react";
import * as fabric from "fabric";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "@/components/ui/toast";
import { isElementLocked } from "@/lib/element/registry";
import { RichTextBox } from "@/lib/element/rich-object";
import { elementObjectMap, toolStore } from "@/store";
import { createTextElement } from "./text-element";

/**
 * 文本元素：落框、双击进入富文本编辑、Ctrl+点击打开链接。
 *
 * 编辑本身不在这里做 —— 双击后把元素 id 交给 `toolStore.startTextEditing`，
 * 由 `rich-text-editor.tsx` 用 Tiptap 覆盖层接管；提交后它负责写回数据。
 */
export function useTextEditing(
	canvas: fabric.Canvas | null,
	_syncSelection: (persist?: boolean) => void,
) {
	/** 落框入口的实现依赖 canvas，通过 ref 转发给绘制 hook */
	const placeTextElementRef = useRef<((point: { x: number; y: number }) => void) | null>(null);

	useEffect(() => {
		if (!canvas) {
			return;
		}
		return setup(canvas);
	}, [canvas]);

	/**
	 * 挂上文本相关的事件，返回卸载函数。
	 * 单独写成函数是为了让内层函数声明里的 canvas 保持非空类型。
	 */
	function setup(canvas: fabric.Canvas) {
		/** 文本工具：在点击处放一个默认宽度的富文本元素，落完回到选择态 */
		function placeTextElement(point: { x: number; y: number }) {
			createTextElement(canvas, point);
		}

		/** 双击文本进入富文本编辑（DOM 覆盖层） */
		function handleTextDblClick(opt: { target?: fabric.FabricObject }) {
			const target = opt.target;
			if (!(target instanceof RichTextBox) || isElementLocked(target)) {
				return;
			}
			const ref = elementObjectMap.getRef(target);
			if (ref) {
				toolStore.startTextEditing(ref.id);
			}
		}

		/** Ctrl/Cmd + 点击链接：打开浏览器；普通点击仍然只是选中文本元素 */
		function handleLinkClick(opt: { target?: fabric.FabricObject; e: Event }) {
			const target = opt.target;
			if (!(target instanceof RichTextBox)) {
				return;
			}
			const event = opt.e as MouseEvent;
			if (!event.ctrlKey && !event.metaKey) {
				return;
			}
			const local = target.toLocalPoint(canvas.getScenePoint(event));
			const href = target.linkAt(local.x, local.y);
			if (!href) {
				return;
			}
			event.preventDefault();
			void openUrl(href).catch((error: unknown) => {
				toast.add({
					title: "打不开链接",
					description: error instanceof Error ? error.message : String(error),
					type: "error",
				});
			});
		}

		/** 悬停在链接上时给个手型光标 */
		function handleLinkHover(opt: { target?: fabric.FabricObject; e: Event }) {
			const canvasEl = canvas.upperCanvasEl;
			const target = opt.target;
			if (!(target instanceof RichTextBox)) {
				canvasEl.style.cursor = "";
				return;
			}
			const local = target.toLocalPoint(canvas.getScenePoint(opt.e as MouseEvent));
			canvasEl.style.cursor = target.linkAt(local.x, local.y) ? "pointer" : "";
		}

		placeTextElementRef.current = placeTextElement;

		canvas.on("mouse:dblclick", handleTextDblClick);
		canvas.on("mouse:down", handleLinkClick);
		canvas.on("mouse:move", handleLinkHover);

		return () => {
			canvas.off("mouse:dblclick", handleTextDblClick);
			canvas.off("mouse:down", handleLinkClick);
			canvas.off("mouse:move", handleLinkHover);
			canvas.upperCanvasEl.style.cursor = "";
			placeTextElementRef.current = null;
		};
	}

	/** 文本工具落框：交给 use-drawing 在 mouse:down 时调用 */
	const placeTextElement = useCallback((point: { x: number; y: number }) => {
		placeTextElementRef.current?.(point);
	}, []);

	return { placeTextElement };
}
