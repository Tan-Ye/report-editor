import * as fabric from "fabric";
import { baseHeight, baseWidth } from "@/base";
import { buildElementObject, toFabricPaint } from "./element-registry";
import { getReportPalette } from "./theme-tokens";
import type { PageInfo } from "@/store";

/**
 * 把一页离屏渲染成图片。
 *
 * 导出和缩略图用的是同一条链路：`buildElementObject` 按 attrs 重建对象，
 * 离屏 StaticCanvas 铺完再 `toDataURL`。**不能直接抓主画布** ——
 * 主画布上有选中框、控件、缩放，导出的图会带上这些。
 */
export interface RenderPageOptions {
	/** 输出缩放：1 = 1920×1080，2 = 3840×2160 */
	scale: number;
	format: "png" | "jpeg";
	/** JPEG 质量 0~1，PNG 忽略 */
	quality?: number;
}

export function renderPageImage(page: PageInfo, options: RenderPageOptions): string | null {
	const { scale, format, quality = 0.92 } = options;
	if (!(scale > 0)) {
		return null;
	}

	const offscreen = new fabric.StaticCanvas(undefined, {
		width: baseWidth,
		height: baseHeight,
		// 背景要自己铺：离屏画布里没有主画布那个白页对象
		backgroundColor: (toFabricPaint(page.style?.fill, { width: baseWidth, height: baseHeight }) ??
			getReportPalette().pageFill) as never,
		enableRetinaScaling: false,
	});

	for (const info of page.elements) {
		// 不登记的构建函数：别把主画布的 id → 对象表污染成离屏对象
		const object = buildElementObject(info);
		if (object) {
			offscreen.add(object);
		}
	}

	const url = offscreen.toDataURL({
		format,
		quality,
		multiplier: scale,
		left: 0,
		top: 0,
		width: baseWidth,
		height: baseHeight,
	});

	void offscreen.dispose();
	return url;
}

/** 把多页竖着拼成一张长图（页数多时注意内存：3× 下每页约 75MB 位图） */
export function stitchPagesVertically(
	images: HTMLImageElement[],
	scale: number,
	format: "png" | "jpeg",
	quality = 0.92,
): string | null {
	if (images.length === 0) {
		return null;
	}
	const width = Math.round(baseWidth * scale);
	const height = Math.round(baseHeight * scale);
	const total = height * images.length;

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = total;
	const context = canvas.getContext("2d");
	if (!context) {
		return null;
	}

	// 空白区域补白：JPEG 不支持透明，PNG 也应该是白底而不是透明
	context.fillStyle = "#ffffff";
	context.fillRect(0, 0, width, total);

	images.forEach((image, index) => {
		context.drawImage(image, 0, index * height, width, height);
	});

	return canvas.toDataURL(format === "jpeg" ? "image/jpeg" : "image/png", quality);
}

/** data URL → 裸 base64（交给 Rust 落盘） */
export function dataUrlToBase64(dataUrl: string): string {
	const index = dataUrl.indexOf(",");
	return index >= 0 ? dataUrl.slice(index + 1) : dataUrl;
}

/** base64/PNG 等 → HTMLImageElement，拼长图时要先把每页图解码出来 */
export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("图片解码失败"));
		image.src = dataUrl;
	});
}
