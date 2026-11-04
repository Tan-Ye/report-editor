import * as fabric from "fabric";
import type { FillSpec, GradientStop, ImageCrop, ImageFillSpec } from "@/store";
import { getMediaImage } from "../media";

export interface PaintSize {
	width: number;
	height: number;
}

/** #rrggbb / rgb() / rgba() 都能转成带透明度的 rgba；认不出来的颜色放弃透明度 */
export function applyAlpha(color: string, alpha: number): string {
	if (alpha >= 1) {
		return color;
	}
	const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
	if (hex) {
		const value = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
		const r = Number.parseInt(value.slice(0, 2), 16);
		const g = Number.parseInt(value.slice(2, 4), 16);
		const b = Number.parseInt(value.slice(4, 6), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
	const rgb = color.match(/^rgba?\(([^)]+)\)$/i);
	if (rgb) {
		const [r, g, b] = rgb[1].split(",").map((part) => part.trim());
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
	return color;
}

function toColorStops(stops: GradientStop[]) {
	return stops
		.slice()
		.sort((a, b) => a.offset - b.offset)
		.map((stop) => ({
			offset: Math.min(Math.max(stop.offset, 0), 1),
			color: applyAlpha(stop.color, stop.alpha ?? 1),
		}));
}

/**
 * 按角度算出渐变线在对象本地坐标系里的两个端点（pixels 单位）。
 *
 * 用 pixels 而不是 percentage：percentage 会让角度随元素宽高比失真
 * （正方形上的 45° 到宽扁矩形上就不是 45° 了）。代价是尺寸变了要重算，
 * 由 `refreshFill` 在几何变化后调一次。
 */
function linearCoords(angle: number, size: PaintSize) {
	const radians = (angle * Math.PI) / 180;
	const directionX = Math.cos(radians);
	const directionY = Math.sin(radians);
	const centerX = size.width / 2;
	const centerY = size.height / 2;
	// 沿方向穿到包围盒边界所需的半长
	const extent = (Math.abs(size.width * directionX) + Math.abs(size.height * directionY)) / 2;
	return {
		x1: centerX - directionX * extent,
		y1: centerY - directionY * extent,
		x2: centerX + directionX * extent,
		y2: centerY + directionY * extent,
	};
}

export type FabricPaint = string | fabric.Gradient<"linear"> | fabric.Gradient<"radial"> | fabric.Pattern;

/** 图源 → 元素本地坐标的映射 */
export interface ImageLayout {
	/** 源图到元素本地坐标的缩放（元素被拉伸时 x/y 不等） */
	scaleX: number;
	scaleY: number;
	/** 图源左上角在元素本地坐标里的位置 */
	offsetX: number;
	offsetY: number;
	repeat: "repeat" | "no-repeat";
}

/**
 * 裁剪区域按原图尺寸夹取；没有 crop、或者夹完正好是整图时返回 null。
 * （整图会被当成"没裁剪"，这样"把框拉到全图再确认"能自然恢复 fit 渲染。）
 */
export function clampImageCrop(
	crop: ImageCrop | undefined,
	naturalWidth: number,
	naturalHeight: number,
): ImageCrop | null {
	if (!crop) {
		return null;
	}
	const x = Math.min(Math.max(0, Math.round(crop.x)), Math.max(0, naturalWidth - 1));
	const y = Math.min(Math.max(0, Math.round(crop.y)), Math.max(0, naturalHeight - 1));
	const width = Math.max(1, Math.min(Math.round(crop.width), naturalWidth - x));
	const height = Math.max(1, Math.min(Math.round(crop.height), naturalHeight - y));
	if (x === 0 && y === 0 && width === naturalWidth && height === naturalHeight) {
		return null;
	}
	return { x, y, width, height };
}

/**
 * 图源 → 元素本地坐标的映射。
 *
 * 有 crop 时：裁剪区域**铺满元素**，fit 不参与 —— 框里取到的就是最终画面；
 * 没有 crop 时：按 fit 的常规规则（cover/contain 等比、center 居中、tile 平铺、original 原大小）。
 *
 * 裁剪层也用这个函数摆图，所以覆盖层里的图和元素显示必须严丝合缝。
 */
export function imageLayout(
	fill: ImageFillSpec,
	image: HTMLImageElement,
	size: PaintSize,
): ImageLayout {
	const naturalWidth = image.naturalWidth || 1;
	const naturalHeight = image.naturalHeight || 1;
	const crop = clampImageCrop(fill.crop, naturalWidth, naturalHeight);

	if (crop) {
		const scaleX = size.width / crop.width;
		const scaleY = size.height / crop.height;
		return {
			scaleX,
			scaleY,
			offsetX: -crop.x * scaleX,
			offsetY: -crop.y * scaleY,
			repeat: "no-repeat",
		};
	}

	let scale = 1;
	let offsetX = 0;
	let offsetY = 0;
	let repeat: "repeat" | "no-repeat" = "no-repeat";

	if (fill.fit === "tile") {
		repeat = "repeat";
	} else if (fill.fit === "cover" || fill.fit === "contain") {
		const scaleX = size.width / naturalWidth;
		const scaleY = size.height / naturalHeight;
		scale = fill.fit === "cover" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
		offsetX = (size.width - naturalWidth * scale) / 2;
		offsetY = (size.height - naturalHeight * scale) / 2;
	} else if (fill.fit === "center") {
		offsetX = (size.width - naturalWidth) / 2;
		offsetY = (size.height - naturalHeight) / 2;
	}

	return { scaleX: scale, scaleY: scale, offsetX, offsetY, repeat };
}

/** 图片填充 → fabric 的 Pattern；映射规则全在 imageLayout 里 */
function imagePattern(
	fill: ImageFillSpec,
	image: HTMLImageElement,
	size: PaintSize,
): fabric.Pattern {
	const layout = imageLayout(fill, image, size);
	return new fabric.Pattern({
		source: image,
		repeat: layout.repeat,
		patternTransform: [layout.scaleX, 0, 0, layout.scaleY, layout.offsetX, layout.offsetY],
	});
}

/**
 * FillSpec → fabric 能画的东西。
 *
 * 这是「JSON → fabric」唯一的方向；反方向不做，因为 FillSpec 里的意图
 * （角度、图片适应方式）在 Gradient/Pattern 里已经还原不出来了。
 */
export function toFabricPaint(
	fill: FillSpec | undefined,
	size: PaintSize,
): FabricPaint | undefined {
	if (!fill) {
		return undefined;
	}
	if (fill.kind === "solid") {
		return fill.color;
	}
	if (fill.kind === "image") {
		// 图片是异步解码的：第一次调用会顺手发起加载并返回 undefined，
		// 加载完成后由 media 的回调重新应用一次填充
		const image = getMediaImage(fill.source);
		return image ? imagePattern(fill, image, size) : undefined;
	}

	const colorStops = toColorStops(fill.stops);
	if (colorStops.length === 0) {
		return undefined;
	}

	if (fill.type === "radial") {
		const centerX = size.width / 2;
		const centerY = size.height / 2;
		return new fabric.Gradient<"radial">({
			type: "radial",
			gradientUnits: "pixels",
			coords: {
				x1: centerX,
				y1: centerY,
				r1: 0,
				x2: centerX,
				y2: centerY,
				r2: Math.max(size.width, size.height) / 2,
			},
			colorStops,
		});
	}

	return new fabric.Gradient<"linear">({
		type: "linear",
		gradientUnits: "pixels",
		coords: linearCoords(fill.angle, size),
		colorStops,
	});
}
