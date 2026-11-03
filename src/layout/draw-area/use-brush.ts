import { useEffect } from "react";
import * as fabric from "fabric";
import { BRUSH_ELEMENT_TYPE } from "@/base/elements";
import { snapshotElementInfo } from "@/lib/element-registry";
import { createUniqueId } from "@/lib/utils";
import { brushStore, elementObjectMap, historyStore, pageStore, toolStore, type BrushCap } from "@/store";

/**
 * 画笔光标：按笔头和粗细生成一个内联 SVG 光标。
 *
 * 用图片光标而不是 CSS 十字：圆头和方头必须一眼能看出来，
 * 而且粗细改了光标也要跟着变，否则用户只能靠"画一笔试试"来确认设置。
 */
function cursorFor(color: string, width: number, cap: BrushCap): string {
	// 光标最多画到 40px：线宽再大也得看得见落点
	const diameter = Math.min(Math.max(width, 3), 40);
	const radius = diameter / 2;
	const shape =
		cap === "round"
			? `<circle cx="24" cy="24" r="${radius}"/>`
			: `<rect x="${24 - radius}" y="${24 - radius}" width="${diameter}" height="${diameter}" rx="1"/>`;
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">` +
		`<g fill="${color}" fill-opacity="0.85" stroke="#ffffff" stroke-width="1">${shape}</g></svg>`;
	// 24 24 是热点：光标中心对准落笔点
	return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 24 24, crosshair`;
}

/**
 * 画笔。
 *
 * 落笔走 fabric 的自由绘制（`isDrawingMode`），松手时 fabric 会构造一条 `fabric.Path`
 * 并触发 `path:created` —— 就在那一刻把它登记成普通元素：
 *
 * - 路径数据（`path`）+ 颜色 + 线宽一起进 `attrs`，所以笔迹是**真元素**，能选中、移动、删除、撤销
 * - 重建时由 `buildBrush` 按存下来的宽高缩放，不是重新描一遍
 */
export function useBrush(canvas: fabric.Canvas | null) {
	useEffect(() => {
		if (!canvas) {
			return;
		}
		return setup(canvas);
	}, [canvas]);

	function setup(canvas: fabric.Canvas) {
		const brush = new fabric.PencilBrush(canvas);
		canvas.freeDrawingBrush = brush;

		const applySettings = () => {
			const state = brushStore.getState();
			brush.color = state.color;
			brush.width = state.width;
			brush.strokeLineCap = state.cap;
			// 光标也跟着变：换笔头/改粗细时，鼠标形状要立刻对应上
			canvas.freeDrawingCursor = cursorFor(state.color, state.width, state.cap);
			if (canvas.isDrawingMode) {
				canvas.setCursor(canvas.freeDrawingCursor);
			}
		};
		applySettings();

		const syncMode = () => {
			const drawing = toolStore.getActiveTool() === "brush";
			canvas.isDrawingMode = drawing;
			if (drawing) {
				// 进画笔模式先松掉选中：选中框和变换控件会挡住落笔
				canvas.discardActiveObject();
				// 光标要等 isDrawingMode 打开后才生效，所以这里再刷一次
				canvas.setCursor(canvas.freeDrawingCursor);
				canvas.requestRenderAll();
			} else {
				// 退出画笔：把光标还原成当前工具该有的样子（不用等鼠标移动）
				canvas.setCursor(canvas.defaultCursor);
			}
		};
		syncMode();

		const unsubscribeTool = toolStore.subscribe(syncMode);
		const unsubscribeBrush = brushStore.subscribe(applySettings);

		const handlePathCreated = (event: { path?: fabric.FabricObject }) => {
			const path = event.path;
			if (!path) {
				return;
			}
			path.set({ selectable: true, evented: true, objectCaching: false });
			elementObjectMap.attach(
				{ id: createUniqueId("element"), elementType: BRUSH_ELEMENT_TYPE },
				path,
			);
			const info = snapshotElementInfo(path);
			if (!info) {
				return;
			}
			pageStore.addElementToCurrentPage(info);
			canvas.requestRenderAll();
			historyStore.commit();
		};

		canvas.on("path:created", handlePathCreated);

		return () => {
			unsubscribeTool();
			unsubscribeBrush();
			canvas.off("path:created", handlePathCreated);
			canvas.isDrawingMode = false;
		};
	}
}
