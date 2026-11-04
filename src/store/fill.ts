/**
 * 填充的文档模型 + 值规整。
 *
 * 类型和 `normalizeFill` 放在一起：解析要懂填充自己的历史格式
 * （纯色字符串、旧版渐变坐标、fabric 至少两个色标），属于这个领域，
 * 不是全局通用工具。fabric 转换在 `lib/element/fill.ts`。
 */

/** 图片填充的适应方式 */
export type ImageFit = "cover" | "contain" | "tile" | "center" | "original";

/**
 * 图片裁剪区域：**源图的像素矩形**（不是元素坐标，也不是 0~1 比例）。
 *
 * 存原图像素的好处：元素之后怎么缩放都不影响裁剪内容；
 * 越界/超出原图的部分交给渲染时按 naturalWidth/naturalHeight 夹取。
 */
export interface ImageCrop {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** 渐变的一个色标 */
export interface GradientStop {
	/** 位置 0~1 */
	offset: number;
	/** #rrggbb 或任意 CSS 颜色 */
	color: string;
	/** 透明度 0~1，缺省 1 */
	alpha?: number;
}

/**
 * 填充规格 —— **JSON 里存的就是它**，与 fabric 的 Gradient / Pattern 无关。
 *
 * 存的是「意图」（角度、适应方式），不是渲染产物：
 * 元素尺寸变了要按新尺寸重算，把 fabric 的对象存进 JSON 就再也算不出来了。
 * 转换只发生在 store → fabric 这一侧，见 `lib/element/fill.ts`。
 */
export type FillSpec =
	| { kind: "solid"; color: string }
	| {
			kind: "gradient";
			type: "linear" | "radial";
			/** 线性渐变角度（度）：0 = 从左到右，顺时针为正 */
			angle: number;
			stops: GradientStop[];
	  }
	| {
			kind: "image";
			/** 相对报告目录的路径，例如 "media/3f2a9c1e.png" */
			source: string;
			fit: ImageFit;
			/**
			 * 裁剪区域。**有它的时候 fit 不参与渲染** —— 元素显示的就是裁剪块本身，
			 * 否则改一次填充方式就把裁剪结果又裁了一遍（"框里是什么就是什么"）。
			 */
			crop?: ImageCrop;
	  };

/** 图片填充的完整规格：面板、裁剪层、渲染都按它读写 */
export type ImageFillSpec = Extract<FillSpec, { kind: "image" }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

const numberOr = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

/**
 * 裁剪区域只接受有限数字和正数宽高；x/y 夹到 0 以上。
 * 超出原图的部分不在这里处理 —— 读文件时还没有图片尺寸，交给渲染层夹取。
 */
function parseCrop(raw: unknown): ImageCrop | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}
	const x = Math.round(numberOr(raw.x, Number.NaN));
	const y = Math.round(numberOr(raw.y, Number.NaN));
	const width = Math.round(numberOr(raw.width, Number.NaN));
	const height = Math.round(numberOr(raw.height, Number.NaN));
	if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || height <= 0) {
		return undefined;
	}
	return { x: Math.max(0, x), y: Math.max(0, y), width, height };
}

function parseStops(raw: unknown): GradientStop[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const stops = raw
		.filter(isRecord)
		.map((stop) => ({
			offset: clamp01(numberOr(stop.offset, 0)),
			color: typeof stop.color === "string" ? stop.color : "#ffffff",
			alpha: clamp01(numberOr(stop.alpha, 1)),
		}));
	if (stops.length === 0) {
		return [];
	}
	// fabric 要求至少两个色标，缺了就补一个同色的
	return stops.length === 1 ? [stops[0], { ...stops[0], offset: 1 }] : stops;
}

/**
 * 把旧渐变坐标（percentage 单位，0~1）还原成角度。
 * 旧版本只支持三个方向，这里统一换算成角度，后面的面板就不用再关心坐标了。
 */
function angleFromCoords(coords: unknown): number {
	if (!isRecord(coords)) {
		return 0;
	}
	const dx = numberOr(coords.x2, 1) - numberOr(coords.x1, 0);
	const dy = numberOr(coords.y2, 0) - numberOr(coords.y1, 0);
	if (dx === 0 && dy === 0) {
		return 0;
	}
	return Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
}

/**
 * 把任意来源的值还原成 FillSpec：新格式、纯色字符串、旧版渐变对象。
 * 认不出来就返回 undefined（当没有填充处理），不要抛错 —— 文件是外部输入。
 */
export function normalizeFill(raw: unknown): FillSpec | undefined {
	// 纯色：老格式直接就是颜色字符串
	if (typeof raw === "string") {
		return raw.trim() ? { kind: "solid", color: raw } : undefined;
	}
	if (!isRecord(raw)) {
		return undefined;
	}

	// 新格式
	if (raw.kind === "solid") {
		return typeof raw.color === "string" ? { kind: "solid", color: raw.color } : undefined;
	}
	if (raw.kind === "gradient") {
		const stops = parseStops(raw.stops);
		if (stops.length === 0) {
			return undefined;
		}
		return {
			kind: "gradient",
			type: raw.type === "radial" ? "radial" : "linear",
			angle: numberOr(raw.angle, 0),
			stops,
		};
	}
	if (raw.kind === "image") {
		if (typeof raw.source !== "string" || !raw.source) {
			return undefined;
		}
		const fit = raw.fit;
		const crop = parseCrop(raw.crop);
		return {
			kind: "image",
			source: raw.source,
			fit:
				fit === "cover" || fit === "contain" || fit === "tile" || fit === "center"
					? fit
					: "original",
			...(crop ? { crop } : {}),
		};
	}

	// 旧版渐变：{ type, coords, colorStops, gradientUnits }
	if (Array.isArray(raw.colorStops)) {
		const stops = parseStops(raw.colorStops);
		if (stops.length === 0) {
			return undefined;
		}
		return {
			kind: "gradient",
			type: raw.type === "radial" ? "radial" : "linear",
			angle: angleFromCoords(raw.coords),
			stops,
		};
	}

	return undefined;
}
