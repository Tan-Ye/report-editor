import * as fabric from "fabric";
import {
	SHAPE_OPTIONS,
	SHAPE_PATHS,
	TEXT_BOX_WIDTH,
	TEXT_ELEMENT_TYPE,
	TEXT_FONT_FAMILY,
	TEXT_FONT_SIZE,
	TEXT_LINE_HEIGHT,
	UNIT_SIZE,
	lineStyleToElementType,
	LINE_STYLE_OPTIONS,
	type LineStyle,
	type ShapeType,
} from "@/base/elements";
import { getReportPalette } from "@/lib/theme-tokens";
import type { ElementType } from "@/store";

/**
 * 元素几何类型：
 * - size：有独立宽高的元素（矩形、形状、文本）
 * - segment：线条，用「起点 + 角度 + 长度」描述
 *
 * 元素身上不存缩放：形状与线条这类几何写死在数据里的元素，
 * 会话中手动拉伸时 fabric 内部会用 scale，`dumpElementAttrs` 会把 scale 折算回宽高再落盘。
 */
export type ElementGeometry = "size" | "segment";

/** 一次拖拽产生的范围，同时给出矩形框和线段两套坐标 */
export interface DragBox {
	left: number;
	top: number;
	width: number;
	height: number;
	startX: number;
	startY: number;
	endX: number;
	endY: number;
}

export interface ElementDefinition {
	/** 元素类型标识，写进文件后就是格式的一部分，改名必须配套做迁移 */
	type: ElementType;
	geometry: ElementGeometry;
	/**
	 * 改尺寸的方式：
	 * - props（默认）：直接写 width/height，fabric 会按新尺寸重画（矩形、文本）
	 * - scale：几何写死在路径数据里，只能整体缩放（形状、线条）。
	 *   缩放会被 `dumpElementAttrs` 折算回宽高，读文件时再按宽高重新生成几何。
	 */
	sizeMode?: "props" | "scale";
	/**
	 * 从拖拽范围直接造一个对象。
	 * 预览每帧都重建：如果改用「基准形状 + scaleX 拉伸」，虚线间距和箭头大小会跟着被拉伸变形。
	 */
	build: (box: DragBox) => fabric.FabricObject;
	/** 持久化白名单，属性面板可编辑的字段也应来自这里 */
	props: readonly string[];
}

const SHAPE_STROKE_WIDTH = 1;

const LINE_STROKE_WIDTH = 2;
/** 双线之间的单侧间距 */
const LINE_GAP = 4;
const ARROW_HEAD_LENGTH = 16;
const ARROW_HEAD_WIDTH = 12;

const RECT_PROPS = [
	"left",
	"top",
	"width",
	"height",
	"angle",
	"opacity",
	"fill",
	"stroke",
	"strokeWidth",
] as const;

const SHAPE_PROPS = [
	"left",
	"top",
	"width",
	"height",
	"angle",
	"opacity",
	"fill",
	"stroke",
	"strokeWidth",
] as const;

const LINE_PROPS = [
	"left",
	"top",
	"angle",
	// length 是自定义字段：斜线的包围盒宽高无法还原真实长度
	"length",
	"opacity",
	"stroke",
	"strokeWidth",
	"strokeDashArray",
] as const;

const TEXT_PROPS = [
	"left",
	"top",
	"width",
	"angle",
	"opacity",
	"fill",
	"fontSize",
	"fontFamily",
	"fontWeight",
	"textAlign",
	"lineHeight",
	// 文本内容：不存这一项等于什么都没保存
	"text",
] as const;

/**
 * 文本元素用 Textbox：宽度固定、自动换行，高度随内容增长。
 * 空文本时高度正好是「一行」，也就是点击后看到的那条矩形。
 */
function buildText(box: DragBox): fabric.FabricObject {
	const palette = getReportPalette();
	return new fabric.Textbox("", {
		left: box.left,
		top: box.top,
		originX: "left",
		originY: "top",
		width: TEXT_BOX_WIDTH,
		fontSize: TEXT_FONT_SIZE,
		lineHeight: TEXT_LINE_HEIGHT,
		fontFamily: TEXT_FONT_FAMILY,
		fill: palette.textFill,
		// 按字符断行：中文没有空格，按词断行会整段挤成一行放不下
		splitByGrapheme: true,
		objectCaching: false,
	});
}

function buildRect(box: DragBox): fabric.FabricObject {
	const palette = getReportPalette();
	return new fabric.Rect({
		left: box.left,
		top: box.top,
		originX: "left",
		originY: "top",
		width: box.width,
		height: box.height,
		fill: palette.shapeFill,
		stroke: palette.shapeStroke,
		strokeWidth: SHAPE_STROKE_WIDTH,
		objectCaching: false,
	});
}

/** 解析后的路径命令。fabric 的强类型元组在 map 里不好拼，这里用宽松形式处理 */
type PathCommand = [string, ...number[]];

/**
 * 把基准路径按目标尺寸重新生成一份。
 *
 * `makePathSimpler` 会把相对命令、弧线、简写曲线统一展开成绝对坐标，
 * 所以这里只需要处理「成对的 x,y」和单独的 H/V —— A 的 rx/ry 也就自动跟着解决了。
 */
function scaleShapePath(path: string, scaleX: number, scaleY: number): string {
	if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
		return path;
	}
	if (scaleX === 1 && scaleY === 1) {
		return path;
	}

	const parsed = fabric.util.parsePath(path) as unknown as PathCommand[];
	const simplified = fabric.util.makePathSimpler(
		parsed as unknown as Parameters<typeof fabric.util.makePathSimpler>[0],
	) as unknown as PathCommand[];

	const scaled = simplified.map(([command, ...args]): PathCommand => {
		if (command === "Z") {
			return [command];
		}
		if (command === "H") {
			return [command, args[0] * scaleX];
		}
		if (command === "V") {
			return [command, args[0] * scaleY];
		}
		const points = [...args];
		for (let index = 0; index + 1 < points.length; index += 2) {
			points[index] *= scaleX;
			points[index + 1] *= scaleY;
		}
		return [command, ...points];
	});

	return fabric.util.joinPath(
		scaled as unknown as Parameters<typeof fabric.util.joinPath>[0],
	);
}

function buildShape(type: ShapeType, box: DragBox): fabric.FabricObject {
	const palette = getReportPalette();
	// 路径直接按目标尺寸生成，不靠 scale 撑开：元素身上不留缩放，
	// 拖拽框多大形状就多大，不会出现「100×100 的形状配一个 scale」这种两套尺寸
	const path = scaleShapePath(SHAPE_PATHS[type], box.width / UNIT_SIZE, box.height / UNIT_SIZE);
	return new fabric.Path(path, {
		left: box.left,
		top: box.top,
		originX: "left",
		originY: "top",
		fill: palette.shapeFill,
		stroke: palette.shapeStroke,
		strokeWidth: SHAPE_STROKE_WIDTH,
		// 手动拉伸的当下还是走 scale，靠它把描边粗细钉住，直到松手折算成宽高
		strokeUniform: true,
		objectCaching: false,
	});
}

interface StrokeStyle {
	strokeDashArray?: number[];
	strokeLineCap?: "butt" | "round" | "square";
}

function makeLine(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	style: StrokeStyle = {},
): fabric.Line {
	return new fabric.Line([x1, y1, x2, y2], {
		stroke: getReportPalette().lineStroke,
		strokeWidth: LINE_STROKE_WIDTH,
		objectCaching: false,
		strokeDashArray: style.strokeDashArray,
		strokeLineCap: style.strokeLineCap,
	});
}

/** 箭头两条倒刺，方向沿 +x */
function makeArrowHead(length: number, atEnd: boolean): fabric.Line[] {
	const headLength = Math.min(ARROW_HEAD_LENGTH, length * 0.6);
	const halfWidth = ARROW_HEAD_WIDTH / 2;
	const tipX = atEnd ? length : 0;
	const backX = atEnd ? length - headLength : headLength;

	return [
		makeLine(tipX, 0, backX, -halfWidth),
		makeLine(tipX, 0, backX, halfWidth),
	];
}

/** 造一条沿 +x 方向、长度已经确定的线（局部坐标），后续靠 angle 摆到实际方向 */
function buildHorizontalLine(style: LineStyle, length: number): fabric.FabricObject {
	switch (style) {
		case "dashed":
			return makeLine(0, 0, length, 0, { strokeDashArray: [12, 8] });
		case "dotted":
			return makeLine(0, 0, length, 0, { strokeDashArray: [1, 8], strokeLineCap: "round" });
		case "double":
			return new fabric.Group(
				[makeLine(0, -LINE_GAP, length, -LINE_GAP), makeLine(0, LINE_GAP, length, LINE_GAP)],
				{ objectCaching: false },
			);
		case "arrow":
			return new fabric.Group([makeLine(0, 0, length, 0), ...makeArrowHead(length, true)], {
				objectCaching: false,
			});
		case "double-arrow":
			return new fabric.Group(
				[
					makeLine(0, 0, length, 0),
					...makeArrowHead(length, true),
					...makeArrowHead(length, false),
				],
				{ objectCaching: false },
			);
		case "dashed-arrow":
			return new fabric.Group(
				[makeLine(0, 0, length, 0, { strokeDashArray: [12, 8] }), ...makeArrowHead(length, true)],
				{ objectCaching: false },
			);
		default:
			return makeLine(0, 0, length, 0);
	}
}

function buildLine(style: LineStyle, box: DragBox): fabric.FabricObject {
	const deltaX = box.endX - box.startX;
	const deltaY = box.endY - box.startY;
	const length = Math.max(Math.hypot(deltaX, deltaY), 1);
	const object = buildHorizontalLine(style, length);

	// 用「起点 + 角度」定位：以左上角为原点、纵向居中，绕起点旋转到拖拽方向。
	// 形状本身保持 1:1，虚线间距和箭头大小都不会被拉变形。
	object.set({
		left: box.startX,
		top: box.startY,
		originX: "left",
		originY: "center",
		angle: (Math.atan2(deltaY, deltaX) * 180) / Math.PI,
		scaleX: 1,
		scaleY: 1,
		length,
	} as unknown as never);
	object.setCoords();

	return object;
}

/** 内置元素：矩形走原生 Rect，其余形状统一走路径，线条按样式各注册一个类型 */
export const ELEMENT_DEFINITIONS: ElementDefinition[] = [
	{
		type: TEXT_ELEMENT_TYPE,
		geometry: "size",
		build: buildText,
		props: TEXT_PROPS,
	},
	{
		type: "rect",
		geometry: "size",
		build: buildRect,
		props: RECT_PROPS,
	},
	...SHAPE_OPTIONS.map(({ value }) => ({
		type: value,
		geometry: "size" as const,
		sizeMode: "scale" as const,
		build: (box: DragBox) => buildShape(value, box),
		props: SHAPE_PROPS,
	})),
	...LINE_STYLE_OPTIONS.map(({ value }) => ({
		type: lineStyleToElementType(value),
		geometry: "segment" as const,
		build: (box: DragBox) => buildLine(value, box),
		props: LINE_PROPS,
	})),
];
