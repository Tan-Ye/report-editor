import { FabricObject } from "fabric";

export class BaseStore<T> {
	public state: T | null = null;
	public listeners: Set<() => void> = new Set();

	// 构造函数,初始化基础存储类
	constructor(initialState: T | null = null) {
		this.state = initialState;
	}

	// 添加监听器
	public addListener(listener: () => void) {
		this.listeners.add(listener);
		return () => {
			this.removeListener(listener);
		};
	}
	// 移除监听器
	public removeListener(listener: () => void) {
		this.listeners.delete(listener);
	}

	// 通知所有监听器
	public notifyListeners() {
		this.listeners.forEach((listener) => {
			listener();
		});
	}

	// 数据更新
	public setState(newState: T | null) {
		this.state = newState;
		this.notifyListeners();
	}
}

export interface ElementInfo {
	elementType: string;
	id: string;
	attrs: FabricObject;
}

class ActiveElementStore extends BaseStore<ElementInfo | null> {
	// 构造函数,初始化活动元素存储类
	constructor(activeElement: ElementInfo | null = null) {
		super(activeElement);
	}

	setActiveElement(element: ElementInfo | null) {
		this.setState(element);
	}
}

export const activeElementStore = new ActiveElementStore();
