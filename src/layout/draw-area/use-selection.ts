import { useCallback, useEffect } from "react";
import * as fabric from "fabric";
import { baseHeight, baseWidth } from "@/base";
import { IMAGE_ELEMENT_TYPE } from "@/base/elements";
import { getAlignOffset, unionBounds, type AlignDirection } from "@/lib/element/align";
import {
	applyGeometryPatch,
	applyStylePatch,
	assignProps,
	createElementFromInfo,
	getElementDefinition,
	isElementLocked,
	readElementInfo,
	refreshFill,
	toFabricPaint,
} from "@/lib/element/registry";
import {
	ELEMENT_COMMAND,
	emitter,
	type ElementCommandPayload,
	type ElementGeometryPatch,
	type ElementStylePatch,
} from "@/lib/emitter";
import { getReportPalette } from "@/lib/theme-tokens";
import { setMediaImageListener } from "@/lib/media";
import { createUniqueId } from "@/lib/utils";
import {
	coordination,
	elementObjectMap,
	historyStore,
	pageStore,
	toolStore,
	type ElementInfo,
	type FillSpec,
} from "@/store";

/** 点击与拖动的分界：场景坐标里移动超过这么多像素就当成框选 */
const PAGE_CLICK_TOLERANCE = 3;

/** 收集画布上当前选中的受管元素（多选时是多个） */
function collectSelectedElements(canvas: fabric.Canvas): ElementInfo[] {
	const elements: ElementInfo[] = [];
	for (const object of canvas.getActiveObjects()) {
		const info = readElementInfo(object);
		if (info) {
			elements.push(info);
		}
	}
	return elements;
}

/**
 * 选中状态、变换与对齐。
 * 画布实例由 use-canvas 创建，这里只接管事件、同步 store。
 *
 * page 是那张铺在最底层的白页：它不可点选（不参与命中检测与框选），
 * 选中它是靠「点空白且落点在页面内」手动设置的 —— 详见 setup 里的说明。
 */
export function useSelection(canvas: fabric.Canvas | null, page: fabric.Rect | null) {
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
				page: page !== null && canvas.getActiveObject() === page,
			});
			if (persist && elements.length > 0) {
				pageStore.batchUpdateElementsInCurrentPage(elements);
			}
		},
		[canvas, page],
	);

	useEffect(() => {
		if (!canvas) {
			return;
		}
		return setup(canvas);
	}, [canvas, page, syncSelection]);

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

		/** 把对象的最新状态写回 store，并让面板跟着刷新（不记历史） */
		function persistElement(object: fabric.FabricObject) {
			const info = readElementInfo(object);
			if (!info) {
				return;
			}
			pageStore.updateElementInCurrentPage(info);
			// 面板显示的是 store 里的快照，这里刷新一次选中态
			syncSelection();
			canvas.requestRenderAll();
		}

		/**
		 * 属性面板改几何。
		 * 画布对象才是几何的真值，所以先改对象、再从对象 dump 回 store，
		 * 而不是反过来拿面板的数值直接拼一份 ElementInfo 写进 store。
		 * commit 传 false 时只改不记历史 —— 拖角度圆盘途中用它，松手后由面板提交一次。
		 */
		function updateElementGeometry(id: string, patch: ElementGeometryPatch, commit: boolean) {
			const object = elementObjectMap.getObject(id);
			const ref = object ? elementObjectMap.getRef(object) : undefined;
			const definition = ref ? getElementDefinition(ref.elementType) : undefined;
			if (!object || !definition || isElementLocked(object)) {
				return;
			}

			applyGeometryPatch(object, definition, patch);

			// Textbox 的排版不把 width 当排版属性，改了宽度不会自己重新折行，得手动触发一次
			if (object instanceof fabric.Textbox && patch.width !== undefined) {
				object.initDimensions();
				object.setCoords();
			}

			// 尺寸变了，渐变坐标/图片适应方式都得按新尺寸重算
			if (patch.width !== undefined || patch.height !== undefined) {
				refreshFill(object, readElementInfo(object)?.attrs.fill);
			}

			persistElement(object);
			if (commit) {
				historyStore.commit();
			}
		}

		/**
		 * 属性面板改外观（填充/描边/字号/字体…）。
		 * commit 传 false 时只画不记历史 —— 取色器拖动途中用它，松手后由面板统一提交一次。
		 */
		function updateElementStyle(id: string, patch: ElementStylePatch, commit: boolean) {
			const object = elementObjectMap.getObject(id);
			const ref = object ? elementObjectMap.getRef(object) : undefined;
			const definition = ref ? getElementDefinition(ref.elementType) : undefined;
			if (!object || !definition || isElementLocked(object)) {
				return;
			}

			// 样式以 store 为准：applyStylePatch 返回「该落库的字段」，
			// 不能改完再从对象上 read 回来 —— 对象上的 fill 已经是 Gradient 实例了
			const applied = applyStylePatch(object, definition, patch);
			const info = readElementInfo(object);
			if (!info) {
				return;
			}

			pageStore.updateElementInCurrentPage({ ...info, attrs: { ...info.attrs, ...applied } });
			syncSelection();
			canvas.requestRenderAll();
			if (commit) {
				historyStore.commit();
			}
		}

		/**
		 * 插入图片元素。
		 *
		 * 尺寸**按原始像素 1:1**，只有比页面还大的图才等比缩到页面内 ——
		 * 元素宽高要和文件分辨率对得上，否则用户没法判断自己放的图是不是被压缩过。
		 * 走 `createElementFromInfo` 而不是手搓 fabric 对象：登记、描边、填充都复用同一套。
		 */
		function insertImageElement(fill: FillSpec, naturalWidth: number, naturalHeight: number) {
			// 原图比页面大才缩，等比缩放保证不裁切、不变形
			const scale = Math.min(
				1,
				baseWidth / Math.max(naturalWidth, 1),
				baseHeight / Math.max(naturalHeight, 1),
			);
			const width = Math.round(naturalWidth * scale);
			const height = Math.round(naturalHeight * scale);

			const info: ElementInfo = {
				id: createUniqueId("element"),
				elementType: IMAGE_ELEMENT_TYPE,
				attrs: {
					left: Math.round((baseWidth - width) / 2),
					top: Math.round((baseHeight - height) / 2),
					width,
					height,
					angle: 0,
					opacity: 1,
					fill,
				},
			};

			const object = createElementFromInfo(info);
			if (!object) {
				return;
			}
			canvas.add(object);
			pageStore.addElementToCurrentPage(info);
			canvas.setActiveObject(object);
			// 插图片是"一次性动作"，顺手回到选择态，免得还停在某个绘制工具上
			toolStore.setTool("select");
			syncSelection();
			canvas.requestRenderAll();
			historyStore.commit();
		}

		/**
		 * 点空白选背景。
		 *
		 * 白页对象本身是 evented:false / selectable:false —— 让它可点选会带来两个副作用：
		 * 框选会把它一起框进去（再拖动整个选区就能把页面拖走），悬停也会改光标。
		 * 所以改成手动判：mousedown 记落点，mouseup 时如果「原地一点 + 落点在页面内 + 没选中任何东西」，
		 * 就把白页设为激活对象。背景只用来改填充色，不提供移动/缩放，所以没有变换控件。
		 */
		let pageClickStart: fabric.Point | null = null;

		function handlePageMouseDown(opt: { target?: unknown; e: Event }) {
			pageClickStart = null;
			// 裁剪态由覆盖层接管鼠标，不在这里选背景
			if (toolStore.getCroppingId()) {
				return;
			}
			// 画笔模式下拖笔不该顺带选中背景
			if (!page || opt.target || toolStore.getActiveTool() === "brush") {
				return;
			}
			const point = canvas.getScenePoint(opt.e as unknown as MouseEvent);
			if (
				point.x < 0 ||
				point.y < 0 ||
				point.x > baseWidth ||
				point.y > baseHeight
			) {
				// 页面外的灰色工作区：不选背景，交给 fabric 清空选中
				return;
			}
			pageClickStart = point;
		}

		function handlePageMouseUp(opt: { e: Event }) {
			const start = pageClickStart;
			pageClickStart = null;
			if (!start || !page) {
				return;
			}
			// 拖动过（框选）就不抢：只有原地一点才选背景
			const end = canvas.getScenePoint(opt.e as unknown as MouseEvent);
			if (Math.hypot(end.x - start.x, end.y - start.y) > PAGE_CLICK_TOLERANCE) {
				return;
			}
			if (canvas.getActiveObjects().length > 0) {
				return;
			}
			canvas.setActiveObject(page);
			canvas.requestRenderAll();
			syncSelection();
		}

		/** 属性面板改页面背景（绘制区域填充） */
		function updatePageBackground(paint: FillSpec | undefined, commit: boolean) {
			if (!page) {
				return;
			}
			assignProps(page, {
				fill:
					toFabricPaint(paint, { width: baseWidth, height: baseHeight }) ??
					getReportPalette().pageFill,
			});
			pageStore.updateCurrentPageStyle({ ...pageStore.currentPage.style, fill: paint });
			canvas.requestRenderAll();
			if (commit) {
				historyStore.commit();
			}
		}

		// 图片解码完成：重新应用一次填充（第一次应用时图片还没就绪），再重绘
		setMediaImageListener(() => {
			for (const object of canvas.getObjects()) {
				const info = readElementInfo(object);
				if (info) {
					refreshFill(object, info.attrs.fill);
				}
			}
			if (page) {
				refreshFill(page, pageStore.currentPage.style?.fill);
			}
			canvas.requestRenderAll();
		});

		canvas.on("selection:created", handleSelectionChange);
		canvas.on("selection:updated", handleSelectionChange);
		canvas.on("selection:cleared", handleSelectionChange);
		canvas.on("object:modified", handleObjectsModified);
		canvas.on("mouse:down", handlePageMouseDown);
		canvas.on("mouse:up", handlePageMouseUp);

		// 顶栏与属性面板发来的元素命令（对齐、改几何、改外观、改背景）
		const unsubscribeCommand = emitter.on<ElementCommandPayload>(ELEMENT_COMMAND, (payload) => {
			// 裁剪态里面板命令不该插进来：几何和填充会在确认时统一写
			if (toolStore.getCroppingId()) {
				return;
			}
			if (payload?.type === "align") {
				alignSelectedElements(payload.direction);
				return;
			}
			if (payload?.type === "update-geometry") {
				updateElementGeometry(payload.id, payload.patch, payload.commit ?? true);
				return;
			}
			if (payload?.type === "update-style") {
				updateElementStyle(payload.id, payload.patch, payload.commit ?? true);
				return;
			}
			if (payload?.type === "update-page-background") {
				updatePageBackground(payload.paint, payload.commit ?? true);
				return;
			}
			if (payload?.type === "insert-image") {
				insertImageElement(payload.fill, payload.width, payload.height);
			}
		});

		return () => {
			canvas.off("selection:created", handleSelectionChange);
			canvas.off("selection:updated", handleSelectionChange);
			canvas.off("selection:cleared", handleSelectionChange);
			canvas.off("object:modified", handleObjectsModified);
			canvas.off("mouse:down", handlePageMouseDown);
			canvas.off("mouse:up", handlePageMouseUp);
			unsubscribeCommand();
			// 监听器是模块级的，卸载时清空，避免指向已经销毁的画布
			setMediaImageListener(() => {});
		};
	}

	return { syncSelection };
}
