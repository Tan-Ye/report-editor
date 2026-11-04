/** 线条样式，决定 line-* 元素类型的路径与描边 */
export type LineStyle =
	| "solid"
	| "dashed"
	| "dotted"
	| "double"
	| "arrow"
	| "double-arrow"
	| "dashed-arrow";

/** 形状种类，同时就是该形状的元素类型 */
export type ShapeType =
	| "ellipse"
	| "triangle"
	| "diamond"
	| "parallelogram"
	| "trapezoid"
	| "pentagon"
	| "hexagon"
	| "star"
	| "arrow"
	| "bubble";

/**
 * 形状路径的基准坐标系边长：所有 SHAPE_PATHS 都画在 UNIT_SIZE × UNIT_SIZE 里，
 * 绘制时按目标尺寸重新生成路径。
 * 旧格式把尺寸存成相对它的 scaleX/scaleY，读文件时要用它换算。
 */
export const UNIT_SIZE = 100;

export interface ElementOption<T extends string> {
	value: T;
	label: string;
}

export const LINE_STYLE_OPTIONS: ElementOption<LineStyle>[] = [
	{ value: "solid", label: "实线" },
	{ value: "dashed", label: "虚线" },
	{ value: "dotted", label: "点线" },
	{ value: "double", label: "双线" },
	{ value: "arrow", label: "单箭头" },
	{ value: "double-arrow", label: "双箭头" },
	{ value: "dashed-arrow", label: "虚线箭头" },
];

export const SHAPE_OPTIONS: ElementOption<ShapeType>[] = [
	{ value: "ellipse", label: "椭圆" },
	{ value: "triangle", label: "三角形" },
	{ value: "diamond", label: "菱形" },
	{ value: "parallelogram", label: "平行四边形" },
	{ value: "trapezoid", label: "梯形" },
	{ value: "pentagon", label: "五边形" },
	{ value: "hexagon", label: "六边形" },
	{ value: "star", label: "五角星" },
	{ value: "arrow", label: "箭头" },
	{ value: "bubble", label: "气泡框" },
];

/** 线条样式 → 元素类型 */
export const lineStyleToElementType = (style: LineStyle) => `line-${style}`;

/**
 * 图片元素：整块就是一个图片框。
 * 图片本身存在 `attrs.fill`（kind = "image"）里，和填充共用一套渲染/预载链路，
 * 所以换图、适应方式、缩略图、预载都不用为它单独写一套。
 */
export const IMAGE_ELEMENT_TYPE = "image";
/** 深色背景上的浅色占位，图还没加载出来时能看出这里有个图片框 */
export const IMAGE_PLACEHOLDER_FILL = "rgba(15, 23, 42, 0.06)";

/**
 * 画笔元素：一次落笔 = 一条路径。
 * 路径数据存在 `attrs.path`（fabric.Path 的 path 数组），
 * 渲染时按宽高缩放，所以画笔痕迹也是普通元素，能选中、能移动、能删。
 */
export const BRUSH_ELEMENT_TYPE = "brush";

/** 文本元素的默认排版参数 */
export const TEXT_ELEMENT_TYPE = "text";
/** 默认框宽 */
export const TEXT_BOX_WIDTH = 400;
/** 默认字号 */
export const TEXT_FONT_SIZE = 24;
/** 行高倍数：文本框高度 = 字号 × 行高，也就是"默认一行的高度" */
export const TEXT_LINE_HEIGHT = 1.4;
export const TEXT_FONT_FAMILY =
	"Inter, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif";

/** 属性面板可选字体。值是直接写进 fabric 的 fontFamily，所以要把回退字体一起带上 */
export const TEXT_FONT_OPTIONS: ElementOption<string>[] = [
	{ value: TEXT_FONT_FAMILY, label: "Inter" },
	{ value: "'Microsoft YaHei', 'PingFang SC', sans-serif", label: "雅黑" },
	{ value: "'SimHei', 'Heiti SC', sans-serif", label: "黑体" },
	{ value: "'SimSun', 'Songti SC', serif", label: "宋体" },
	{ value: "Arial, Helvetica, sans-serif", label: "Arial" },
];

/** 字重档位：fabric 的 fontWeight 接受数字或字符串 */
export const TEXT_WEIGHT_OPTIONS = [
	{ value: "400", label: "常规" },
	{ value: "500", label: "中等" },
	{ value: "700", label: "粗体" },
] as const;

/** 文本对齐 */
export const TEXT_ALIGN_OPTIONS = [
	{ value: "left", label: "左" },
	{ value: "center", label: "中" },
	{ value: "right", label: "右" },
] as const;

/**
 * 所有已注册的元素类型。
 *
 * 故意放在 base（纯数据模块、不 import fabric）：校验报告时要知道
 * "这个类型认不认识"，而校验要能在没有 canvas 的环境里跑（测试、以后的无头校验）。
 *
 * ⚠️ 新增元素类型时这里和 `lib/element/definitions.ts` 的 ELEMENT_DEFINITIONS 都要加。
 */
export const KNOWN_ELEMENT_TYPES: readonly string[] = [
	"rect",
	TEXT_ELEMENT_TYPE,
	IMAGE_ELEMENT_TYPE,
	BRUSH_ELEMENT_TYPE,
	...SHAPE_OPTIONS.map((option) => option.value),
	...LINE_STYLE_OPTIONS.map((option) => lineStyleToElementType(option.value)),
];

/**
 * 五角星路径。
 * 先按圆心/半径生成顶点，再归一化到 100×100 ——
 * 形状路径必须正好铺满基准坐标系，否则绘制时和拖拽框对不上。
 */
function createStarPath(): string {
	const center = 50;
	const outerRadius = 50;
	const innerRadius = 22;
	const points = 5;
	const raw: { x: number; y: number }[] = [];

	for (let index = 0; index < points * 2; index += 1) {
		const radius = index % 2 === 0 ? outerRadius : innerRadius;
		const angle = -Math.PI / 2 + (index * Math.PI) / points;
		raw.push({
			x: center + Math.cos(angle) * radius,
			y: center + Math.sin(angle) * radius,
		});
	}

	const minX = Math.min(...raw.map((point) => point.x));
	const maxX = Math.max(...raw.map((point) => point.x));
	const minY = Math.min(...raw.map((point) => point.y));
	const maxY = Math.max(...raw.map((point) => point.y));
	const scaleX = 100 / (maxX - minX);
	const scaleY = 100 / (maxY - minY);

	const commands = raw.map((point, index) => {
		const x = ((point.x - minX) * scaleX).toFixed(2);
		const y = ((point.y - minY) * scaleY).toFixed(2);
		return `${index === 0 ? "M" : "L"} ${x} ${y}`;
	});

	return `${commands.join(" ")} Z`;
}

/**
 * 形状路径表：全部画在 100×100 的坐标系里，绘制时按拖拽框整体缩放。
 * 下拉菜单的图标直接复用这些路径，保证「图标长什么样，画出来就是什么样」。
 */
export const SHAPE_PATHS: Record<ShapeType, string> = {
	ellipse: "M 50 0 A 50 50 0 1 0 50 100 A 50 50 0 1 0 50 0 Z",
	triangle: "M 50 0 L 100 100 L 0 100 Z",
	diamond: "M 50 0 L 100 50 L 50 100 L 0 50 Z",
	parallelogram: "M 22 0 L 100 0 L 78 100 L 0 100 Z",
	trapezoid: "M 22 0 L 78 0 L 100 100 L 0 100 Z",
	pentagon: "M 50 0 L 100 38 L 81 100 L 19 100 L 0 38 Z",
	hexagon: "M 25 0 L 75 0 L 100 50 L 75 100 L 25 100 L 0 50 Z",
	star: createStarPath(),
	arrow: "M 0 30 L 62 30 L 62 0 L 100 50 L 62 100 L 62 70 L 0 70 Z",
	bubble: "M 10 0 H 90 Q 100 0 100 10 V 68 Q 100 78 90 78 H 46 L 26 100 L 30 78 H 10 Q 0 78 0 68 V 10 Q 0 0 10 0 Z",
};

/** 元素类型 → 中文名，属性面板与提示文案共用 */
export function getElementTypeLabel(type: string): string {
	if (type === TEXT_ELEMENT_TYPE) {
		return "文本";
	}
	if (type === "rect") {
		return "矩形";
	}
	if (type === IMAGE_ELEMENT_TYPE) {
		return "图片";
	}
	if (type === BRUSH_ELEMENT_TYPE) {
		return "画笔";
	}
	const shape = SHAPE_OPTIONS.find((option) => option.value === type);
	if (shape) {
		return shape.label;
	}
	const line = LINE_STYLE_OPTIONS.find((option) => lineStyleToElementType(option.value) === type);
	if (line) {
		return `线条 · ${line.label}`;
	}
	return type;
}
