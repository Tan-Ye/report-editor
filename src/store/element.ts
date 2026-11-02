import type { FabricObject } from "fabric";

/**
 * 元素属性：既是文件里的内容，也是 store 里存的内容。
 *
 * 不再持有 FabricObject，原因有两个：
 * 1. 活对象写不进 JSON —— obj.canvas 与 canvas 的对象列表互相引用会形成环；
 * 2. 一个 FabricObject 只能属于一个 canvas，多页切换时对象生命周期会乱。
 *
 * 属性名与 fabric 的构造参数保持一致，重建时直接覆盖到对象上即可。
 */
export type ElementAttrs = {
	left?: number;
	top?: number;
	width?: number;
	height?: number;
	scaleX?: number;
	scaleY?: number;
	angle?: number;
	opacity?: number;
	fill?: string;
	stroke?: string;
	strokeWidth?: number;
	/** 业务扩展字段（数据绑定等），fabric 不认识也没关系 */
	[key: string]: unknown;
};

/** 元素业务类型，与元素注册表（lib/element-registry）的键一一对应 */
export type ElementType = string;

export interface ElementInfo {
	/** 业务类型，决定用注册表里的哪条定义来重建 */
	elementType: ElementType;
	/** 页面内唯一 id */
	id: string;
	/** 纯数据属性，可直接 JSON.stringify */
	attrs: ElementAttrs;
}

/** 画布对象的身份信息，由运行时映射表维护，不进入 attrs */
export interface ElementRef {
	id: string;
	elementType: ElementType;
}

/**
 * 元素 id ↔ 画布对象 的运行时映射，只存在内存里。
 * 文件里只有数据，画布对象在需要时按注册表重建，重建时在这里登记。
 */
class ElementObjectMap {
	private byId = new Map<string, FabricObject>();
	private byObject = new WeakMap<FabricObject, ElementRef>();

	/** 建立元素与画布对象的双向关联 */
	attach(element: ElementRef, object: FabricObject) {
		this.byId.set(element.id, object);
		this.byObject.set(object, { id: element.id, elementType: element.elementType });
	}

	/** id → 画布对象 */
	getObject(id: string) {
		return this.byId.get(id);
	}

	/** 画布对象 → 身份信息；不是受管元素（例如页面背景）时返回 undefined */
	getRef(object: FabricObject) {
		return this.byObject.get(object);
	}

	/** 按 id 解除双向关联 */
	delete(id: string) {
		const object = this.byId.get(id);
		if (!object) {
			return;
		}
		this.byObject.delete(object);
		this.byId.delete(id);
	}

	/** 从对象一侧解除双向关联（对象被从画布移除时用） */
	deleteByObject(object: FabricObject) {
		const ref = this.byObject.get(object);
		if (!ref) {
			return;
		}
		this.byId.delete(ref.id);
		this.byObject.delete(object);
	}
}

export const elementObjectMap = new ElementObjectMap();

export interface SelectionState {
	/** 当前选中的元素 id，顺序即画布层叠顺序 */
	ids: string[];
	/** 只选中一个时才有值。多选时为 null（批量编辑后续再做） */
	primary: ElementInfo | null;
}

export const EMPTY_SELECTION: SelectionState = { ids: [], primary: null };

/**
 * 选中状态。
 * 画布侧负责把 canvas 的选中结果翻译成它，属性面板和顶栏订阅它。
 */
class SelectionStore {
	private state: SelectionState = EMPTY_SELECTION;
	private listeners = new Set<() => void>();

	/** 引用稳定的订阅函数，可直接交给 useSyncExternalStore */
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = () => this.state;

	getIds = () => this.state.ids;

	getPrimary = () => this.state.primary;

	setSelection(next: SelectionState) {
		const current = this.state;
		const same =
			next.primary === current.primary &&
			next.ids.length === current.ids.length &&
			next.ids.every((id, index) => id === current.ids[index]);
		if (same) {
			return;
		}

		this.state = next;
		this.listeners.forEach((listener) => {
			listener();
		});
	}

	clear() {
		this.setSelection(EMPTY_SELECTION);
	}
}

export const selectionStore = new SelectionStore();

