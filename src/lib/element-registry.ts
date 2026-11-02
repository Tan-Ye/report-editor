import * as fabric from "fabric";
import {
	elementObjectMap,
	type ElementAttrs,
	type ElementInfo,
	type ElementType,
} from "@/store";
import {
	ELEMENT_DEFINITIONS,
	type DragBox,
	type ElementDefinition,
	type ElementGeometry,
} from "./element-definitions";

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

/** 把 attrs 覆盖到画布对象上 */
export function applyElementAttrs(object: fabric.FabricObject, attrs: ElementAttrs): void {
	assignProps(object, attrs);
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
 * 按 ElementInfo 重建画布对象并登记到运行时映射。
 * 类型未注册时返回 null —— 调用方必须把原始数据留在 store 里，
 * 否则用旧版本文件打开一次再保存，那个类型的元素就永久丢了。
 */
export function createElementFromInfo(info: ElementInfo): fabric.FabricObject | null {
	const definition = getElementDefinition(info.elementType);
	if (!definition) {
		return null;
	}
	const object = definition.build(boxFromAttrs(definition.geometry, info.attrs));
	applyElementAttrs(object, info.attrs);
	// 锁定状态要还原成「不可选中」，只把 locked 写回去是不够的
	applyElementLock(object, info.attrs.locked === true);
	elementObjectMap.attach({ id: info.id, elementType: info.elementType }, object);
	return object;
}

/** 按白名单从画布对象上取属性，得到可落盘的 attrs */
export function dumpElementAttrs(
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
		attrs[key] = value;
	}
	return attrs;
}

/** 从画布对象反查 ElementInfo；不是受管元素（例如页面背景）时返回 null */
export function dumpElementFromObject(object: fabric.FabricObject): ElementInfo | null {
	const ref = elementObjectMap.getRef(object);
	if (!ref) {
		return null;
	}
	const definition = getElementDefinition(ref.elementType);
	if (!definition) {
		return null;
	}
	const attrs = dumpElementAttrs(object, definition);
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

/** 收集画布上的受管元素，顺序即 z-order（自底向上） */
export function collectElementsFromCanvas(canvas: fabric.Canvas): ElementInfo[] {
	const elements: ElementInfo[] = [];
	for (const object of canvas.getObjects()) {
		const info = dumpElementFromObject(object);
		if (info) {
			elements.push(info);
		}
	}
	return elements;
}
