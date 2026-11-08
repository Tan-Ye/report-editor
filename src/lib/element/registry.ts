import * as fabric from "fabric";
import {
	elementObjectMap,
	normalizeFill,
	pageStore,
	type ElementAttrs,
	type ElementInfo,
	type ElementShadow,
	type ElementType,
} from "@/store";
import {
	ELEMENT_DEFINITIONS,
	type DragBox,
	type ElementDefinition,
	type ElementGeometry,
} from "./definitions";
import type { ElementGeometryPatch, ElementStylePatch } from "../emitter";
import { applyAlpha, toFabricPaint } from "./fill";
import { RichTextBox } from "./rich-object";

export { toFabricPaint } from "./fill";

export type { DragBox, ElementDefinition, ElementGeometry };

const definitions = new Map<ElementType, ElementDefinition>();

export function registerElement(definition: ElementDefinition): void {
	definitions.set(definition.type, definition);
}

export function getElementDefinition(type: ElementType): ElementDefinition | undefined {
	return definitions.get(type);
}

/** 元素类型的几何模式；未注册的类型返回 undefined */
export function getElementGeometry(type: ElementType): ElementGeometry | undefined {
	return definitions.get(type)?.geometry;
}

/** 属性面板显示的几何值：宽高按元素的几何模式换算成实际尺寸 */
export interface ElementGeometryValues {
	left: number;
	top: number;
	angle: number;
	/** 线条没有宽高（用长度描述），这里是 0 */
	width: number;
	height: number;
	/** 线条的长度；其它元素是 0 */
	length: number;
}

/** 0 或负数会让对象坐标退化，之后就再也选不中也拖不动 */
const MIN_SIZE = 1;

const numberOr = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

/**
 * 从 attrs 读出面板要显示的几何值。
 * 和 geometryPatchToProps 是配对关系：这边怎么换算，那边就怎么反算，
 * 否则面板显示的数字和填进去的结果会对不上。
 */
export function readGeometryValues(
	geometry: ElementGeometry,
	attrs: ElementAttrs,
): ElementGeometryValues {
	const left = numberOr(attrs.left, 0);
	const top = numberOr(attrs.top, 0);
	const angle = numberOr(attrs.angle, 0);

	if (geometry === "segment") {
		return { left, top, angle, width: 0, height: 0, length: numberOr(attrs.length, 0) };
	}
	return {
		left,
		top,
		angle,
		width: numberOr(attrs.width, 0),
		height: numberOr(attrs.height, 0),
		length: 0,
	};
}

/** 尺寸与位置的一次写入里，角度要最后处理 —— 它要以「最终尺寸下的中心」为支点 */
function applyAngleAroundCenter(object: fabric.FabricObject, angle: number): void {
	// 旋转前记下中心，改完 angle 再把中心摆回原位。
	// fabric 拖旋转手柄走的就是这套（centeredRotation 默认 true + wrapWithFixedAnchor），
	// 面板里填角度必须跟它一致，否则「拖手柄正常、填数字却绕左上角甩出去」。
	const center = object.getPositionByOrigin("center", "center");
	object.set({ angle });
	object.setPositionByOrigin(center, "center", "center");
	object.setCoords();
}

/**
 * 把属性面板输入的几何值落到画布对象上。
 *
 * 尺寸有两种写法：能直接写 width/height 的元素就写属性（矩形、文本），
 * 几何写死在路径数据里的（形状、线条）只能整体缩放 ——
 * 缩放会在 dumpElementAttrs 里折算回宽高，所以文件里始终只有宽高。
 *
 * 角度统一绕**中心**转，和拖旋转手柄的行为保持一致。
 */
export function applyGeometryPatch(
	object: fabric.FabricObject,
	definition: ElementDefinition,
	patch: ElementGeometryPatch,
): void {
	const props: Record<string, unknown> = {};
	if (typeof patch.left === "number") {
		props.left = patch.left;
	}
	if (typeof patch.top === "number") {
		props.top = patch.top;
	}

	if (definition.geometry === "segment") {
		if (typeof patch.length === "number") {
			const baseLength = numberOr((object as unknown as Record<string, unknown>).length, 0);
			const target = Math.max(patch.length, MIN_SIZE);
			// 线条的几何是按长度造死的，改长度只能按比例缩放；dump 时会再乘回去
			props.scaleX = baseLength > 0 ? target / baseLength : 1;
			props.scaleY = 1;
		}
		assignProps(object, props);
		// 线条的 origin 在起点上，直接写 angle 会绕起点转，这里改成一并绕中心
		if (typeof patch.angle === "number") {
			applyAngleAroundCenter(object, patch.angle);
		}
		return;
	}

	const width = typeof patch.width === "number" ? Math.max(patch.width, MIN_SIZE) : null;
	const height = typeof patch.height === "number" ? Math.max(patch.height, MIN_SIZE) : null;

	if (definition.sizeMode === "scale") {
		if (width !== null) {
			props.scaleX = width / Math.max(object.width, MIN_SIZE);
		}
		if (height !== null) {
			props.scaleY = height / Math.max(object.height, MIN_SIZE);
		}
	} else {
		if (width !== null) {
			props.width = width;
			props.scaleX = 1;
		}
		if (height !== null) {
			props.height = height;
			props.scaleY = 1;
		}
	}

	// 尺寸与 left/top 先落，角度最后以「最终几何的中心」为支点
	assignProps(object, props);
	// 富文本：宽度变了要重新断行（高度由内容决定）
	if (object instanceof RichTextBox) {
		object.relayout();
	}
	if (typeof patch.angle === "number") {
		applyAngleAroundCenter(object, patch.angle);
	}
}

/**
 * 把属性面板输入的外观值落到画布对象上，并返回**该写进 store 的字段**。
 *
 * 返回值很重要：样式以 store 为准，不能改完再从对象上读回来
 * （对象上的 fill 是 Gradient 实例，re 读会丢掉 FillSpec 里的角度/图片适应方式）。
 * 元素白名单里没有的字段直接忽略 —— 比如线条没有 fill、文本没有 strokeWidth。
 */
export function applyStylePatch(
	object: fabric.FabricObject,
	definition: ElementDefinition,
	patch: ElementStylePatch,
): ElementAttrs {
	const supported = new Set(definition.props);
	const stored: ElementAttrs = {};
	const props: Record<string, unknown> = {};

	if (patch.fill !== undefined && supported.has("fill")) {
		stored.fill = patch.fill;
		props.fill = toFabricPaint(patch.fill, { width: object.width, height: object.height });
	}
	if (patch.stroke !== undefined && supported.has("stroke")) {
		stored.stroke = patch.stroke;
		props.stroke = patch.stroke;
	}
	if (typeof patch.strokeWidth === "number" && supported.has("strokeWidth")) {
		stored.strokeWidth = Math.max(patch.strokeWidth, 0);
		props.strokeWidth = stored.strokeWidth;
	}
	if (typeof patch.fontSize === "number" && supported.has("fontSize")) {
		stored.fontSize = Math.max(patch.fontSize, 1);
		props.fontSize = stored.fontSize;
	}
	if (typeof patch.lineHeight === "number" && supported.has("lineHeight")) {
		stored.lineHeight = Math.max(patch.lineHeight, 0.5);
		props.lineHeight = stored.lineHeight;
	}
	if (patch.fontWeight !== undefined && supported.has("fontWeight")) {
		stored.fontWeight = patch.fontWeight;
		props.fontWeight = patch.fontWeight;
	}
	if (patch.fontFamily !== undefined && supported.has("fontFamily")) {
		stored.fontFamily = patch.fontFamily;
		props.fontFamily = patch.fontFamily;
	}
	if (patch.textAlign !== undefined && supported.has("textAlign")) {
		stored.textAlign = patch.textAlign;
		props.textAlign = patch.textAlign;
	}
	// 阴影对任何元素都适用，不走 props 白名单（它和锁定一样是元素级样式）
	if (patch.shadow !== undefined) {
		if (patch.shadow) {
			stored.shadow = patch.shadow;
			props.shadow = toFabricShadow(patch.shadow);
		} else {
			// null 表示移除阴影；赋 null 才能真清掉，赋 undefined 不会
			props.shadow = null;
		}
	}

	// 字号/字体都在 fabric 的排版属性里，set 会自己触发重排，不用手动 initDimensions
	assignProps(object, props);
	// 富文本是自绘的：元素级样式变了要按新参数重排一次
	if (object instanceof RichTextBox) {
		object.applyBasicStyle({
			fontSize: typeof stored.fontSize === "number" ? stored.fontSize : undefined,
			fontFamily: typeof stored.fontFamily === "string" ? stored.fontFamily : undefined,
			fontWeight:
				typeof stored.fontWeight === "string" || typeof stored.fontWeight === "number"
					? stored.fontWeight
					: undefined,
			lineHeight: typeof stored.lineHeight === "number" ? stored.lineHeight : undefined,
			textAlign:
				stored.textAlign === "center" || stored.textAlign === "right"
					? stored.textAlign
					: stored.textAlign === "left"
						? "left"
						: undefined,
			color: patch.fill?.kind === "solid" ? patch.fill.color : undefined,
		});
	}
	return stored;
}

// 内置元素在模块加载时就注册好，外部只需要 import 这个模块
ELEMENT_DEFINITIONS.forEach(registerElement);
/**
 * 给画布对象批量设置属性。
 * 走 fabric 的 set：它会正确给渲染缓存打脏标记，直接写属性则不会
 * （预览对象每帧都在变，漏掉脏标记就会「不跟着动」）。
 * set 有 (key, value) 和 (props) 两个重载、各版本签名不一致，这里统一用 props 形式。
 */
export function assignProps(object: fabric.FabricObject, props: Record<string, unknown>): void {
	object.set(props as unknown as never);
	object.setCoords();
}

/**
 * 把 attrs 覆盖到画布对象上。
 *
 * 顺序有讲究：几何先落，填充后落 —— 渐变的坐标是按对象当前尺寸算的，
 * 尺寸还没设好就填色会算到旧尺寸上。
 */
export function applyElementAttrs(
	object: fabric.FabricObject,
	attrs: ElementAttrs,
	definition?: ElementDefinition,
): void {
	const { fill, shadow, ...rest } = attrs;
	// 几何写死在路径里的元素（画笔）：尺寸靠 scale 还原，
	// 不能再把存下来的宽高盖到对象上，否则 fabric 会按「宽 × scale」算出双重缩放的包围盒
	if (definition?.sizeMode === "scale") {
		delete rest.width;
		delete rest.height;
	}
	assignProps(object, rest);
	refreshFill(object, fill);
	applyShadow(object, shadow);
	// 富文本：文档/字号/字体/对齐变了都要重排；fill 在这里只当文字颜色用
	if (object instanceof RichTextBox) {
		object.applyAttrs(attrs);
	}
}

/**
 * 把阴影规格变成 fabric.Shadow。
 *
 * 存的是意图（颜色/透明度/模糊/偏移），fabric 的实例只存在于对象上，**永不回读**成数据 ——
 * 和填充、描边同一个原则，否则 JSON 里会混进 fabric 的内部结构。
 */
function toFabricShadow(spec: ElementShadow | undefined): fabric.Shadow | null {
	if (!spec) {
		return null;
	}
	return new fabric.Shadow({
		color: applyAlpha(spec.color, spec.opacity),
		blur: spec.blur,
		offsetX: spec.offsetX,
		offsetY: spec.offsetY,
	});
}

export function applyShadow(object: fabric.FabricObject, spec: ElementShadow | undefined): void {
	assignProps(object, { shadow: toFabricShadow(spec) });
}

/** 按对象当前尺寸重算填充。尺寸一变就要调一次（渐变坐标、图片 fit 都依赖它） */
export function refreshFill(object: fabric.FabricObject, fill: ElementAttrs["fill"]): void {
	if (fill === undefined) {
		// 没写填充就别动：build 里给的默认色还在，清掉反而变成透明的
		return;
	}
	assignProps(object, {
		fill: toFabricPaint(fill, { width: object.width, height: object.height }),
	});
}

/** 元素是否被锁定。locked 是存在对象上的自定义字段，不属于 fabric 内置属性 */
export function isElementLocked(object: fabric.FabricObject): boolean {
	return (object as unknown as Record<string, unknown>).locked === true;
}

/**
 * 应用锁定状态。
 * 锁定的元素仍然 evented —— 否则右键命中不到，就再也解不了锁；
 * 但不可选中，所以拖不动、也不会响应框选。
 */
export function applyElementLock(object: fabric.FabricObject, locked: boolean): void {
	assignProps(object, { locked, selectable: !locked, evented: true });
}

/**
 * 从 attrs 还原出拖拽范围。
 * 线段类元素靠「起点 + 角度 + 长度」描述，包围盒宽高在斜线情况下还原不出长度。
 */
function boxFromAttrs(geometry: ElementGeometry, attrs: ElementAttrs): DragBox {
	const left = typeof attrs.left === "number" ? attrs.left : 0;
	const top = typeof attrs.top === "number" ? attrs.top : 0;
	const width = typeof attrs.width === "number" ? attrs.width : 240;
	const height = typeof attrs.height === "number" ? attrs.height : 160;

	if (geometry === "segment") {
		const angle = typeof attrs.angle === "number" ? attrs.angle : 0;
		const length = typeof attrs.length === "number" ? attrs.length : width;
		const radians = (angle * Math.PI) / 180;
		return {
			left,
			top,
			width,
			height,
			startX: left,
			startY: top,
			endX: left + Math.cos(radians) * length,
			endY: top + Math.sin(radians) * length,
		};
	}

	return {
		left,
		top,
		width,
		height,
		startX: left,
		startY: top,
		endX: left + width,
		endY: top + height,
	};
}

/**
 * 按 ElementInfo 重建画布对象，**不登记**到运行时映射。
 *
 * 离屏渲染（缩略图）必须用这个：一旦登记，「id → 对象」就被换成不在主画布上的幽灵对象，
 * 右键菜单、属性面板、对齐命令全会拿到它去改，改完画布上看不到效果。
 */
export function buildElementObject(info: ElementInfo): fabric.FabricObject | null {
	const definition = getElementDefinition(info.elementType);
	if (!definition) {
		return null;
	}
	const object = definition.build(boxFromAttrs(definition.geometry, info.attrs), info.attrs);
	applyElementAttrs(object, info.attrs, definition);
	// 锁定状态要还原成「不可选中」，只把 locked 写回去是不够的
	applyElementLock(object, info.attrs.locked === true);
	return object;
}

/**
 * 按 ElementInfo 重建画布对象并登记到运行时映射。
 * 类型未注册时返回 null —— 调用方必须把原始数据留在 store 里，
 * 否则用旧版本文件打开一次再保存，那个类型的元素就永久丢了。
 */
export function createElementFromInfo(info: ElementInfo): fabric.FabricObject | null {
	const object = buildElementObject(info);
	if (!object) {
		return null;
	}
	elementObjectMap.attach({ id: info.id, elementType: info.elementType }, object);
	return object;
}

/**
 * 尺寸字段要乘以缩放。
 * 手动拉伸、以及几何写死在路径里的元素（形状、线条）都只改 scale，
 * 落盘必须是折算后的实际大小 —— 元素身上不留缩放是这一层的约定。
 */
function foldScale(key: string, value: unknown, object: fabric.FabricObject): unknown {
	if (typeof value !== "number") {
		return value;
	}
	if (key === "width" || key === "length") {
		return value * object.scaleX;
	}
	if (key === "height") {
		return value * object.scaleY;
	}
	return value;
}

/**
 * 这些字段的真值在 fabric 对象上 —— 拖拽、缩放、双击编辑只有对象知道最新值。
 * 其余字段（填充、描边、字号、字体…）一律以 store / JSON 为准，**不从这里读**。
 */
const OBJECT_TRUTH_PROPS = ["left", "top", "angle", "width", "height", "length", "text"] as const;

/** 从对象上取「对象为准」的那部分属性 */
export function dumpObjectTruth(
	object: fabric.FabricObject,
	definition: ElementDefinition,
): ElementAttrs {
	const source = object as unknown as Record<string, unknown>;
	const attrs: ElementAttrs = {};
	for (const key of OBJECT_TRUTH_PROPS) {
		if (!definition.props.includes(key)) {
			continue;
		}
		const value = source[key];
		if (value === undefined) {
			continue;
		}
		(attrs as Record<string, unknown>)[key] = foldScale(key, value, object);
	}
	return attrs;
}

/**
 * 新建元素时用：按白名单把对象上的字段全量取出来。
 * 只有新建这一次需要「对象说了算」—— 此时默认样式（页面调色板里的填充/描边）
 * 只存在于对象上，store 里还没有这条记录。
 */
export function snapshotElementAttrs(
	object: fabric.FabricObject,
	definition: ElementDefinition,
): ElementAttrs {
	const source = object as unknown as Record<string, unknown>;
	const attrs: ElementAttrs = {};
	for (const key of definition.props) {
		const value = source[key];
		if (value === undefined) {
			continue;
		}
		if (key === "fill") {
			// 新对象的填充是颜色字符串，统一成 FillSpec 再进 store
			const fill = normalizeFill(value);
			if (fill) {
				attrs.fill = fill;
			}
			continue;
		}
		attrs[key] = foldScale(key, value, object);
	}
	return attrs;
}

/**
 * 从画布对象读出完整的 ElementInfo：几何取对象，样式取 store。
 * 不是受管元素（例如页面背景）时返回 null。
 */
export function readElementInfo(object: fabric.FabricObject): ElementInfo | null {
	const ref = elementObjectMap.getRef(object);
	if (!ref) {
		return null;
	}
	const definition = getElementDefinition(ref.elementType);
	if (!definition) {
		return null;
	}
	const stored = pageStore.currentPage.elements.find((element) => element.id === ref.id);
	const attrs: ElementAttrs = {
		...(stored?.attrs ?? {}),
		...dumpObjectTruth(object, definition),
	};
	// 锁定是元素级状态，不在各类型的白名单里，统一在这里补上
	if (isElementLocked(object)) {
		attrs.locked = true;
	}
	return {
		elementType: ref.elementType,
		id: ref.id,
		attrs,
	};
}

/** 新建元素时用：把对象当前的完整状态（含默认样式）封装成 ElementInfo */
export function snapshotElementInfo(object: fabric.FabricObject): ElementInfo | null {
	const ref = elementObjectMap.getRef(object);
	if (!ref) {
		return null;
	}
	const definition = getElementDefinition(ref.elementType);
	if (!definition) {
		return null;
	}
	const attrs = snapshotElementAttrs(object, definition);
	if (isElementLocked(object)) {
		attrs.locked = true;
	}
	return { elementType: ref.elementType, id: ref.id, attrs };
}

/** 收集画布上的受管元素，顺序即 z-order（自底向上） */
export function collectElementsFromCanvas(canvas: fabric.Canvas): ElementInfo[] {
	const elements: ElementInfo[] = [];
	for (const object of canvas.getObjects()) {
		const info = readElementInfo(object);
		if (info) {
			elements.push(info);
		}
	}
	return elements;
}
