import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import * as fabric from "fabric";
import { baseHeight, baseWidth } from "@/base/index";
import { setActiveCanvas } from "@/lib/canvas-registry";
import { getReportPalette } from "@/lib/theme-tokens";
import { computeViewportFit } from "@/lib/utils";
import { viewportStore, zoomStore } from "@/store";

/** 画布句柄：画布与白页都在挂载之后才有值 */
export interface CanvasHandle {
	/** 画布实例；还没创建好时是 null，其它 hook 等它就绪后再接管 */
	canvas: fabric.Canvas | null;
	/** 白页背景：铺在场景原点、固定在最底层，切页重建元素时要跳过它 */
	page: fabric.Rect | null;
	/** 承载画布的容器，画布尺寸与视口适配都以它为准 */
	containerRef: RefObject<HTMLDivElement | null>;
	/** 挂画布 wrapper 的层 */
	stageRef: RefObject<HTMLDivElement | null>;
	/** 平移视口：拖动画布时由 use-space-pan 调用，参数是屏幕像素位移 */
	panBy: (dx: number, dy: number) => void;
	/** 卸载收尾，交给 useCanvasTeardown 在组件末尾注册 */
	teardown: () => void;
}

/**
 * 创建画布：只创建一次，挂到容器上，跟随容器尺寸，
 * 并按 zoomStore 里的比例把页面居中铺到容器视口里。
 *
 * 清理没有写在这个 effect 里 —— React 按 hook 定义顺序执行 effect 清理，
 * 画布 hook 排在最前面，清理就会早于其它 hook 摘监听；而 dispose 之后
 * upperCanvasEl 之类的访问器会失效。所以收尾单独拆成 useCanvasTeardown，
 * 组件里把它放在最后一个 hook 位置调用。
 */
export function useCanvas(): CanvasHandle {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const stageRef = useRef<HTMLDivElement | null>(null);
	const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);
	const [page, setPage] = useState<fabric.Rect | null>(null);
	/** 真正的收尾动作，由创建 effect 填进来 */
	const cleanupRef = useRef<(() => void) | null>(null);
	/**
	 * 平移量（屏幕像素），叠加在「页面居中」的视口结果上。
	 * 用 ref 而不是 state：拖动时每一帧都在变，走 state 会让整个组件树跟着重渲染。
	 */
	const panOffsetRef = useRef({ x: 0, y: 0 });

	useEffect(() => {
		const container = containerRef.current;
		const stage = stageRef.current;
		if (!container || !stage) {
			return;
		}

		// ---------- 画布 ----------
		// 画布尺寸等于可视区：可视区外的内容本来就看不见，没必要铺更大的画布。
		// 点阵是容器上的 CSS 背景，不参与缩放。
		const fabricCanvas = new fabric.Canvas(document.createElement("canvas"), {
			width: 1,
			height: 1,
			// 默认 true 时 fabric 会把 contextmenu 事件 stopEvent 掉，菜单组件的触发器
			// （挂在画布外层）就收不到事件了。放开冒泡，由菜单组件去 preventDefault。
			stopContextMenu: false,
		});

		const wrapper = fabricCanvas.wrapperEl;
		Object.assign(wrapper.style, {
			position: "absolute",
			left: "0",
			top: "0",
		});
		stage.appendChild(wrapper);

		// 白页放在场景原点、保持原始尺寸，缩放交给 viewportTransform。
		// 元素坐标因此永远与窗口大小无关。
		// 颜色取自 global.css 的 --report-* 令牌（fabric 只认字面量，读不到 CSS 变量）
		const palette = getReportPalette();
		const pageRect = new fabric.Rect({
			left: 0,
			top: 0,
			originX: "left",
			originY: "top",
			width: baseWidth,
			height: baseHeight,
			fill: palette.pageFill,
			objectCaching: false,
			// 白页可以「被选中」来改背景色，但只是被选中，不能点、不能拖、没有控制点。
			// 不参与命中检测（evented/selectable 都为 false）是刻意的：
			// 一旦可点选，框选会把它一起框进去，拖动整个选区就能把页面拖走。
			selectable: false,
			evented: false,
			hasControls: false,
			hasBorders: true,
			hoverCursor: "default",
			shadow: new fabric.Shadow({
				color: palette.pageShadow,
				blur: 32,
				offsetX: 0,
				offsetY: 10,
			}),
		});
		fabricCanvas.add(pageRect);

		// 按 store 里的比例铺视口：页面在场景原点，把页面中心对到容器中心，再叠加平移量
		const applyViewport = () => {
			const rect = container.getBoundingClientRect();
			const { scale, manual } = zoomStore.getSnapshot();
			// 「适应窗口」模式下视口要重新居中，之前拖出来的偏移作废
			if (!manual) {
				panOffsetRef.current = { x: 0, y: 0 };
			}
			const offset = panOffsetRef.current;
			const tx = rect.width / 2 - (baseWidth * scale) / 2 + offset.x;
			const ty = rect.height / 2 - (baseHeight * scale) / 2 + offset.y;
			fabricCanvas.setViewportTransform([scale, 0, 0, scale, tx, ty]);
			// 镜像一份给覆盖层（刻度/参考线），它们读不到画布内部的变换
			viewportStore.set({ scale, tx, ty, width: rect.width, height: rect.height });
			fabricCanvas.requestRenderAll();
		};

		/** 容器尺寸变化：重设画布尺寸与适配比例，再按当前模式应用视口 */
		const syncToContainer = () => {
			const rect = container.getBoundingClientRect();
			const width = Math.max(Math.floor(rect.width), 1);
			const height = Math.max(Math.floor(rect.height), 1);

			fabricCanvas.setDimensions({ width, height });
			wrapper.style.width = `${width}px`;
			wrapper.style.height = `${height}px`;

			// 适配比例回填给 store：非手动模式下 store 会同步 scale（变化时通知订阅方）
			const { zoom } = computeViewportFit({
				containerRect: rect,
				pageWidth: baseWidth,
				pageHeight: baseHeight,
			});
			zoomStore.setFitScale(zoom);

			applyViewport();
		};
		syncToContainer();

		const resizeObserver = new ResizeObserver(syncToContainer);
		resizeObserver.observe(container);

		// 比例变化（状态栏按钮 / 适应窗口 / Ctrl+滚轮）→ 重设视口
		const unsubscribeZoom = zoomStore.subscribe(applyViewport);

		/** Ctrl/⌘ + 滚轮缩放：只接管这个组合键，其余滚轮保持原有滚动行为 */
		const handleWheel = (event: WheelEvent) => {
			if (!(event.ctrlKey || event.metaKey)) {
				return;
			}
			event.preventDefault();
			if (event.deltaY === 0) {
				return;
			}
			if (event.deltaY < 0) {
				zoomStore.zoomIn();
			} else {
				zoomStore.zoomOut();
			}
		};
		container.addEventListener("wheel", handleWheel, { passive: false });

		cleanupRef.current = () => {
			container.removeEventListener("wheel", handleWheel);
			unsubscribeZoom();
			resizeObserver.disconnect();
			// agent 执行器通过这里拿画布，销毁时登记处也要清掉
			setActiveCanvas(null);
			void fabricCanvas.dispose();
			// dispose 不保证把 wrapper 从 DOM 上摘掉，这里补一刀，
			// 否则热更新/重挂载会叠出第二个画布
			wrapper.remove();
		};

		setActiveCanvas(fabricCanvas);
		setCanvas(fabricCanvas);
		setPage(pageRect);
	}, []);

	/**
	 * 平移画布：只改视口矩阵，不动元素坐标，也不经过 React 状态。
	 * 偏移量另外记一份 —— 缩放、改窗口时视口会整个重算，靠它把用户拖到的位置保住。
	 */
	const panBy = useCallback(
		(dx: number, dy: number) => {
			if (!canvas || (dx === 0 && dy === 0)) {
				return;
			}
			const viewport = canvas.viewportTransform;
			if (!viewport) {
				return;
			}
			viewport[4] += dx;
			viewport[5] += dy;
			panOffsetRef.current = {
				x: panOffsetRef.current.x + dx,
				y: panOffsetRef.current.y + dy,
			};
			// setViewportTransform 内部会重算可视边界并请求重绘
			canvas.setViewportTransform(viewport);
			// 平移也要同步给覆盖层，否则刻度和参考线会留在原地
			const rect = containerRef.current?.getBoundingClientRect();
			viewportStore.set({
				scale: viewport[0],
				tx: viewport[4],
				ty: viewport[5],
				width: rect?.width ?? 0,
				height: rect?.height ?? 0,
			});
		},
		[canvas],
	);

	const teardown = useCallback(() => {
		const cleanup = cleanupRef.current;
		cleanupRef.current = null;
		cleanup?.();
	}, []);

	return { canvas, page, containerRef, stageRef, panBy, teardown };
}

/**
 * 画布收尾：dispose + 摘掉 wrapper。
 * 必须放在组件里所有 hook 的最后 —— React 按定义顺序清理，这样其它 hook
 * 会先摘掉事件监听、结束绘制，最后才销毁画布。
 */
export function useCanvasTeardown(teardown: () => void) {
	useEffect(() => {
		return teardown;
	}, [teardown]);
}
