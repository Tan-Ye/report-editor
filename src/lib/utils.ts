import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { baseWidth, baseHeight, baseRatio, bgCanvasWidth, bgCanvasHeight } from "../base/index";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

interface computeCanvasPositionArgs {
	containerRect: DOMRect;
	padding?: number | number[];
}

type CanvasInfo = {
	left: number;
	top: number;
	width: number;
	height: number;
	scale: number;
};

/** 计算画布区域在容器中的位置与大小，画布区域固定为 1920*1080，在容器中保持比例展示 */
export function computeCanvasPositionAndSize({ containerRect, padding = 20 }: computeCanvasPositionArgs): CanvasInfo {
	const { width, height } = containerRect;
	let paddingTop = 0;
	let paddingRight = 0;
	let paddingBottom = 0;
	let paddingLeft = 0;
	if (Array.isArray(padding)) {
		[paddingTop, paddingRight, paddingBottom, paddingLeft] = padding;
	} else {
		paddingTop = paddingRight = paddingBottom = paddingLeft = padding;
	}

	const canvasPosition: CanvasInfo = {
		top: bgCanvasHeight / 2,
		left: bgCanvasWidth / 2,
		width: baseWidth,
		height: baseHeight,
		// width: 100,
		// height: 100,
		// scale: 1,
	} as CanvasInfo;
	const adaptWidth = Math.floor(width - paddingLeft - paddingRight);
	canvasPosition.scale = adaptWidth / baseWidth;
	return canvasPosition;
}
