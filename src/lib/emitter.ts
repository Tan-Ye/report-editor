import type { AlignDirection } from "./align";

// 订阅事件常量集
export const PAGE_MODAL_UPDATE = "pageModalUpdate";
export const REPORT_MODAL_UPDATE = "reportModalUpdate";
export const ELEMENT_UPDATE = "elementUpdate";
/** 顶栏发给画布的元素命令（对齐等） */
export const ELEMENT_COMMAND = "elementCommand";

export const EmitterNameEnum = {
	PAGE_MODAL_UPDATE,
	REPORT_MODAL_UPDATE,
	ELEMENT_UPDATE,
	ELEMENT_COMMAND,
} as const;

type EmitterNames = (typeof EmitterNameEnum)[keyof typeof EmitterNameEnum];

/** 元素命令载荷：目前只有对齐 */
export interface ElementCommandPayload {
	type: "align";
	direction: AlignDirection;
}

type AnyListener = (args: unknown) => void;

/**
 * 轻量事件总线，用于顶栏 → 画布这类跨组件命令。
 * 同一事件支持挂多个监听（原来直接存单个回调，后注册的会把先注册的覆盖掉）。
 */
class EventEmitter {
	private events = new Map<EmitterNames, Set<AnyListener>>();

	/**
	 * 注册事件
	 * @returns 取消注册的函数
	 */
	on<T = unknown>(eventName: EmitterNames, callback: (args: T) => void) {
		const listeners = this.events.get(eventName) ?? new Set<AnyListener>();
		listeners.add(callback as AnyListener);
		this.events.set(eventName, listeners);
		return () => {
			this.off(eventName, callback);
		};
	}

	/** 单次监听 */
	once<T = unknown>(eventName: EmitterNames, callback: (args: T) => void) {
		const wrapper = (args: unknown) => {
			this.off(eventName, wrapper);
			callback(args as T);
		};
		this.on(eventName, wrapper);
	}

	/**
	 * 移除事件
	 * @param callback 不传则移除该事件的全部监听
	 */
	off<T = unknown>(eventName: EmitterNames, callback?: (args: T) => void) {
		if (!callback) {
			this.events.delete(eventName);
			return;
		}
		this.events.get(eventName)?.delete(callback as AnyListener);
	}

	/** 触发事件 */
	emit<T = unknown>(eventName: EmitterNames, args: T) {
		this.events.get(eventName)?.forEach((listener) => {
			listener(args);
		});
	}

	/** 移除所有事件 */
	clear() {
		this.events.clear();
	}
}

export const emitter = new EventEmitter();
