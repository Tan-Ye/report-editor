import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as fabric from "fabric";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { acquireCanvasLock } from "@/lib/agent/session";
import { getActiveCanvas } from "@/lib/canvas-registry";
import {
	applyGeometryPatch,
	applyStylePatch,
	getElementDefinition,
	isElementLocked,
	readElementInfo,
} from "@/lib/element/registry";
import { clampImageCrop, imageLayout, type ImageLayout } from "@/lib/element/fill";
import { getMediaImage } from "@/lib/media";
import { getReportPalette } from "@/lib/theme-tokens";
import { elementObjectMap, historyStore, pageStore, toolStore, viewportStore } from "@/store";
import type { ImageFillSpec, ViewportState } from "@/store";

/**
 * 图片裁剪层。
 *
 * 交互和主画布**完全隔离**：这里是一个独立的 fabric.Canvas，尺寸和主画布一样，
 * 盖满整个可视区（整块画布都被压暗，只有裁剪框里是亮的），里面放
 * 「和元素同位置同大小的原图 + 裁剪框」。拖动图片、拉框都在这一层完成，
 * 确认时一次性写回元素几何和 `fill.crop`（一步撤销）。
 *
 * ⚠️ fabric v7 的对象默认 origin 是 **center**：这里每个对象都显式写
 * `originX/originY = "left"/"top"`，否则位置会整体偏半个宽高。
 */

const ACCENT = "#3b82f6";
/** 判断"点到控制点"的半径（画布 px）：命中这里就交给 fabric 做缩放 */
const CORNER_HIT = 14;
/** 裁剪框最小边长（画布 px） */
const MIN_FRAME = 16;

interface LocalRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface CropGeometry {
	fill: ImageFillSpec;
	image: HTMLImageElement;
	layout: ImageLayout;
	/** 元素本地尺寸 */
	boxWidth: number;
	boxHeight: number;
	/** 元素 origin 在场景里的位置 */
	left: number;
	top: number;
	angle: number;
	zoom: number;
	tx: number;
	ty: number;
	/** 可视区尺寸（裁剪层画布大小） */
	canvasWidth: number;
	canvasHeight: number;
}

function computeGeometry(elementId: string, viewport: ViewportState): CropGeometry | null {
	const object = elementObjectMap.getObject(elementId);
	if (!object || !elementObjectMap.getRef(object) || isElementLocked(object)) {
		return null;
	}
	// 元素正处于拉伸中时 scale 不是 1：坐标换算会绕，直接拒绝，松手后再来
	if (Math.abs(object.scaleX - 1) > 0.001 || Math.abs(object.scaleY - 1) > 0.001) {
		return null;
	}
	const info = readElementInfo(object);
	const fill = info?.attrs.fill;
	if (!fill || fill.kind !== "image") {
		return null;
	}
	const image = getMediaImage(fill.source);
	if (!image) {
		return null;
	}
	return {
		fill,
		image,
		layout: imageLayout(fill, image, { width: object.width, height: object.height }),
		boxWidth: object.width,
		boxHeight: object.height,
		left: object.left,
		top: object.top,
		angle: object.angle ?? 0,
		zoom: viewport.scale || 1,
		tx: viewport.tx,
		ty: viewport.ty,
		canvasWidth: Math.max(1, Math.round(viewport.width)),
		canvasHeight: Math.max(1, Math.round(viewport.height)),
	};
}

/** 裁剪态外壳：只负责按 id 挂载/卸载一次裁剪会话 */
export function CropOverlay() {
	const croppingId = useSyncExternalStore(toolStore.subscribe, toolStore.getCroppingId);
	if (!croppingId) {
		return null;
	}
	return <CropSession key={croppingId} elementId={croppingId} />;
}

function CropSession({ elementId }: { elementId: string }) {
	// 进入时的视口快照：裁剪期间禁止缩放/平移，所以不需要跟着变
	const [geometry] = useState(() => computeGeometry(elementId, viewportStore.getSnapshot()));
	const hostRef = useRef<HTMLDivElement | null>(null);
	const confirmRef = useRef<() => void>(() => {});

	useEffect(() => {
		if (!geometry) {
			toast.add({
				title: "没法裁剪这张图",
				description: "图片还没加载好，或者元素正处在变换/锁定状态，稍后再试",
				type: "warning",
			});
			toolStore.stopCropping();
			return;
		}

		const host = hostRef.current;
		if (!host) {
			return;
		}
		const releaseLock = acquireCanvasLock();
		const canvasEl = document.createElement("canvas");
		host.appendChild(canvasEl);

		const canvas = new fabric.Canvas(canvasEl, {
			width: geometry.canvasWidth,
			height: geometry.canvasHeight,
			selection: false,
			preserveObjectStacking: true,
			stopContextMenu: true,
		});
		canvas.defaultCursor = "default";

		const { zoom } = geometry;
		const radians = (geometry.angle * Math.PI) / 180;
		const cos = Math.cos(radians);
		const sin = Math.sin(radians);
		/** 元素 origin 在画布（屏幕）坐标里的位置 */
		const originX = geometry.tx + zoom * geometry.left;
		const originY = geometry.ty + zoom * geometry.top;

		/** 元素本地坐标 → 画布坐标（含旋转） */
		const toScreen = (x: number, y: number) => {
			const dx = x * zoom;
			const dy = y * zoom;
			return { x: originX + cos * dx - sin * dy, y: originY + sin * dx + cos * dy };
		};
		/** 画布坐标 → 元素本地坐标（toScreen 的逆） */
		const toLocal = (x: number, y: number) => {
			const dx = x - originX;
			const dy = y - originY;
			return { x: (cos * dx + sin * dy) / zoom, y: (-sin * dx + cos * dy) / zoom };
		};

		/** 图源在元素本地坐标里的矩形：拖动只改 imageRect.x/y */
		const imageRect: LocalRect = {
			x: geometry.layout.offsetX,
			y: geometry.layout.offsetY,
			width: geometry.image.naturalWidth * geometry.layout.scaleX,
			height: geometry.image.naturalHeight * geometry.layout.scaleY,
		};

		// 初始框 = 元素框与图源矩形的交集：contain/center 留白的部分不该被框进来
		const overlapLeft = Math.max(0, imageRect.x);
		const overlapTop = Math.max(0, imageRect.y);
		const overlapRight = Math.min(geometry.boxWidth, imageRect.x + imageRect.width);
		const overlapBottom = Math.min(geometry.boxHeight, imageRect.y + imageRect.height);
		const frameRect: LocalRect =
			overlapRight > overlapLeft && overlapBottom > overlapTop
				? {
						x: overlapLeft,
						y: overlapTop,
						width: overlapRight - overlapLeft,
						height: overlapBottom - overlapTop,
					}
				: { x: 0, y: 0, width: geometry.boxWidth, height: geometry.boxHeight };
		let currentImage: LocalRect = { ...imageRect };

		// 垫在底下的"元素占位"：盖掉主画布上那个元素的旧画面
		const backdrop = new fabric.Rect({
			left: 0,
			top: 0,
			originX: "left",
			originY: "top",
			angle: geometry.angle,
			width: geometry.boxWidth * zoom,
			height: geometry.boxHeight * zoom,
			fill: getReportPalette().pageFill,
			selectable: false,
			evented: false,
			objectCaching: false,
		});
		const picture = new fabric.Image(geometry.image, {
			left: 0,
			top: 0,
			originX: "left",
			originY: "top",
			angle: geometry.angle,
			scaleX: geometry.layout.scaleX * zoom,
			scaleY: geometry.layout.scaleY * zoom,
			selectable: false,
			evented: false,
			objectCaching: false,
		});
		const dimOptions = {
			left: 0,
			top: 0,
			originX: "left" as const,
			originY: "top" as const,
			fill: "rgba(2, 6, 23, 0.45)",
			selectable: false,
			evented: false,
			objectCaching: false,
		};
		const dimTop = new fabric.Rect(dimOptions);
		const dimBottom = new fabric.Rect(dimOptions);
		const dimLeft = new fabric.Rect(dimOptions);
		const dimRight = new fabric.Rect(dimOptions);
		const frame = new fabric.Rect({
			left: 0,
			top: 0,
			originX: "left",
			originY: "top",
			angle: geometry.angle,
			width: frameRect.width * zoom,
			height: frameRect.height * zoom,
			fill: "rgba(255, 255, 255, 0.001)",
			stroke: ACCENT,
			strokeWidth: 1.5,
			strokeUniform: true,
			transparentCorners: false,
			cornerColor: "#ffffff",
			cornerStrokeColor: ACCENT,
			cornerSize: 9,
			borderColor: ACCENT,
			borderScaleFactor: 1,
			lockRotation: true,
			hasRotatingPoint: false,
			// 框自己不被拖动（拖框内 = 拖图片），只允许拉控制点
			lockMovementX: true,
			lockMovementY: true,
			objectCaching: false,
		});
		frame.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false, mtr: false });

		canvas.add(backdrop, picture, dimTop, dimBottom, dimLeft, dimRight, frame);
		canvas.setActiveObject(frame);

		/** 按当前 frameRect / currentImage 重新摆放对象 */
		const applyObjects = () => {
			const imageOrigin = toScreen(currentImage.x, currentImage.y);
			picture.set({ left: imageOrigin.x, top: imageOrigin.y });
			picture.setCoords();
			const elementOrigin = toScreen(0, 0);
			backdrop.set({ left: elementOrigin.x, top: elementOrigin.y });
			backdrop.setCoords();
			const frameOrigin = toScreen(frameRect.x, frameRect.y);
			frame.set({
				left: frameOrigin.x,
				top: frameOrigin.y,
				width: frameRect.width * zoom,
				height: frameRect.height * zoom,
				scaleX: 1,
				scaleY: 1,
			});
			frame.setCoords();
			syncDim();
		};

		/** 蒙层铺满整个画布：只有框内保持原样 */
		const syncDim = () => {
			const rect = frame.getBoundingRect();
			const width = canvas.getWidth();
			const height = canvas.getHeight();
			dimLeft.set({ left: 0, top: 0, width: Math.max(0, rect.left), height });
			dimRight.set({
				left: rect.left + rect.width,
				top: 0,
				width: Math.max(0, width - rect.left - rect.width),
				height,
			});
			dimTop.set({ left: rect.left, top: 0, width: rect.width, height: Math.max(0, rect.top) });
			dimBottom.set({
				left: rect.left,
				top: rect.top + rect.height,
				width: rect.width,
				height: Math.max(0, height - rect.top - rect.height),
			});
			for (const dim of [dimLeft, dimRight, dimTop, dimBottom]) {
				dim.setCoords();
			}
			canvas.requestRenderAll();
		};

		/** 框被拉过之后：从对象属性回收本地矩形，并夹在图源范围内 */
		const readFrameLocal = (): LocalRect => {
			const origin = toLocal(frame.left, frame.top);
			return {
				x: origin.x,
				y: origin.y,
				width: (frame.width * frame.scaleX) / zoom,
				height: (frame.height * frame.scaleY) / zoom,
			};
		};

		const clampFrame = () => {
			const next = readFrameLocal();
			const width = Math.min(Math.max(next.width, MIN_FRAME / zoom), currentImage.width);
			const height = Math.min(Math.max(next.height, MIN_FRAME / zoom), currentImage.height);
			frameRect.x = Math.min(
				Math.max(next.x, currentImage.x),
				currentImage.x + currentImage.width - width,
			);
			frameRect.y = Math.min(
				Math.max(next.y, currentImage.y),
				currentImage.y + currentImage.height - height,
			);
			frameRect.width = width;
			frameRect.height = height;
			applyObjects();
		};

		/** 拖框内 = 移动原图。框不动，图跟着指针走（按本地坐标算，带旋转也对） */
		let dragging = false;
		let lastLocal = { x: 0, y: 0 };

		const handleMouseDown = (opt: fabric.TPointerEventInfo) => {
			if (opt.target !== frame || !opt.viewportPoint) {
				return;
			}
			const rect = frame.getBoundingRect();
			const corners = [
				{ x: rect.left, y: rect.top },
				{ x: rect.left + rect.width, y: rect.top },
				{ x: rect.left, y: rect.top + rect.height },
				{ x: rect.left + rect.width, y: rect.top + rect.height },
			];
			if (
				corners.some(
					(corner) => Math.hypot(opt.viewportPoint.x - corner.x, opt.viewportPoint.y - corner.y) <= CORNER_HIT,
				)
			) {
				return;
			}
			dragging = true;
			lastLocal = toLocal(opt.viewportPoint.x, opt.viewportPoint.y);
		};

		const handleMouseMove = (opt: fabric.TPointerEventInfo) => {
			if (!dragging || !opt.viewportPoint) {
				return;
			}
			const now = toLocal(opt.viewportPoint.x, opt.viewportPoint.y);
			const deltaX = now.x - lastLocal.x;
			const deltaY = now.y - lastLocal.y;
			lastLocal = now;

			// 图必须始终盖住框（否则框里会露底色）
			currentImage = {
				...currentImage,
				x: Math.min(
					Math.max(currentImage.x + deltaX, frameRect.x + frameRect.width - currentImage.width),
					frameRect.x,
				),
				y: Math.min(
					Math.max(currentImage.y + deltaY, frameRect.y + frameRect.height - currentImage.height),
					frameRect.y,
				),
			};
			const imageOrigin = toScreen(currentImage.x, currentImage.y);
			picture.set({ left: imageOrigin.x, top: imageOrigin.y });
			picture.setCoords();
			canvas.requestRenderAll();
		};

		const handleMouseUp = () => {
			dragging = false;
			clampFrame();
		};

		canvas.on("mouse:down", handleMouseDown);
		canvas.on("mouse:move", handleMouseMove);
		canvas.on("mouse:up", handleMouseUp);
		canvas.on("object:scaling", syncDim);
		canvas.on("object:modified", clampFrame);

		applyObjects();

		/** 确认：框 + 图当前位置 → crop（源图 px）+ 元素几何，一次提交 */
		const confirm = () => {
			const crop = clampImageCrop(
				{
					x: (frameRect.x - currentImage.x) / geometry.layout.scaleX,
					y: (frameRect.y - currentImage.y) / geometry.layout.scaleY,
					width: frameRect.width / geometry.layout.scaleX,
					height: frameRect.height / geometry.layout.scaleY,
				},
				geometry.image.naturalWidth,
				geometry.image.naturalHeight,
			);

			const object = elementObjectMap.getObject(elementId);
			const ref = object ? elementObjectMap.getRef(object) : undefined;
			const definition = ref ? getElementDefinition(ref.elementType) : undefined;
			const mainCanvas = getActiveCanvas();
			if (!object || !definition || !mainCanvas) {
				toolStore.stopCropping();
				return;
			}

			// 元素 origin（左上角）跟着框的左上角走；元素有旋转时按原角度旋转偏移
			applyGeometryPatch(object, definition, {
				left: object.left + frameRect.x * cos - frameRect.y * sin,
				top: object.top + frameRect.x * sin + frameRect.y * cos,
				width: frameRect.width,
				height: frameRect.height,
			});

			const nextFill: ImageFillSpec = crop
				? { ...geometry.fill, crop }
				: { ...geometry.fill, crop: undefined };
			const stored = applyStylePatch(object, definition, { fill: nextFill });
			const info = readElementInfo(object);
			if (info) {
				pageStore.updateElementInCurrentPage({ ...info, attrs: { ...info.attrs, ...stored } });
			}
			mainCanvas.setActiveObject(object);
			mainCanvas.requestRenderAll();
			historyStore.commit();
			toolStore.stopCropping();
		};
		confirmRef.current = confirm;

		const cancel = () => toolStore.stopCropping();

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				cancel();
				return;
			}
			if (event.key === "Enter") {
				event.preventDefault();
				event.stopPropagation();
				confirm();
			}
		};

		const handleResize = () => cancel();
		// 换页/打开别的文档、视口变化都会让覆盖层和元素对不上，直接退出裁剪
		const unsubscribePage = pageStore.subscribe(cancel);
		const unsubscribeViewport = viewportStore.subscribe(cancel);

		window.addEventListener("keydown", handleKeyDown, true);
		window.addEventListener("resize", handleResize);

		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
			window.removeEventListener("resize", handleResize);
			unsubscribePage();
			unsubscribeViewport();
			confirmRef.current = () => {};
			canvas.dispose();
			host.innerHTML = "";
			releaseLock();
		};
	}, [elementId, geometry]);

	if (!geometry) {
		return null;
	}

	return (
		<div className="pointer-events-none absolute inset-0 z-40">
			<div ref={hostRef} className="pointer-events-auto absolute inset-0" />

			<div className="pointer-events-auto absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-popover/95 px-2 py-1.5 shadow-lg">
				<span className="px-1 text-xs text-muted-foreground">
					拖动图片调整取景，拖控制点调整裁剪范围
				</span>
				<Button type="button" size="xs" variant="ghost" onClick={() => toolStore.stopCropping()}>
					取消
				</Button>
				<Button type="button" size="xs" onClick={() => confirmRef.current()}>
					完成
				</Button>
			</div>
		</div>
	);
}
