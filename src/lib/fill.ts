import * as fabric from "fabric";
import type { FillSpec, GradientStop, ImageFit } from "@/store";
import { getMediaImage } from "./media";

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

/**
 * 图片填充 → fabric 的 Pattern。
 *
 * `patternTransform` 是 [scaleX, 0, 0, scaleY, offsetX, offsetY]：
 * cover/contain 按「图片自然尺寸 vs 元素尺寸」算缩放，再把多出来的部分居中裁掉/留白。
 * tile 直接用原尺寸平铺，original 不缩放贴左上角。
 */
function imagePattern(
	fit: ImageFit,
	image: HTMLImageElement,
	size: PaintSize,
): fabric.Pattern {
	const naturalWidth = image.naturalWidth || 1;
	const naturalHeight = image.naturalHeight || 1;
	let scale = 1;
	let offsetX = 0;
	let offsetY = 0;
	let repeat: "repeat" | "no-repeat" = "no-repeat";

	if (fit === "tile") {
		repeat = "repeat";
	} else if (fit === "cover" || fit === "contain") {
		const scaleX = size.width / naturalWidth;
		const scaleY = size.height / naturalHeight;
		scale = fit === "cover" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
		offsetX = (size.width - naturalWidth * scale) / 2;
		offsetY = (size.height - naturalHeight * scale) / 2;
	} else if (fit === "center") {
		offsetX = (size.width - naturalWidth) / 2;
		offsetY = (size.height - naturalHeight) / 2;
	}

	return new fabric.Pattern({
		source: image,
		repeat,
		patternTransform: [scale, 0, 0, scale, offsetX, offsetY],
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
		return image ? imagePattern(fill.fit, image, size) : undefined;
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
