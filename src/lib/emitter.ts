// 订阅事件常量集
export const PAGE_MODAL_UPDATE = "pageModalUpdate";
export const REPORT_MODAL_UPDATE = "reportModalUpdate";
export const ELEMENT_UPDATE = "elementUpdate";
export const EmitterNameEnum = {
	PAGE_MODAL_UPDATE,
	REPORT_MODAL_UPDATE,
	ELEMENT_UPDATE,
} as const;

type EmitterNames = (typeof EmitterNameEnum)[keyof typeof EmitterNameEnum];
type Events = Record<EmitterNames, (args: any) => void>;

class EventEmitter {
	private events: Events = {} as Events;
	constructor() {
		this.events = {} as Events;
	}
	/**
	 * 注册事件
	 * @param eventName 事件名
	 * @param callback 事件回调
	 */
	on(eventName: EmitterNames, callback: (args: any) => void) {
		this.events[eventName] = callback;
	}

	/**
	 * 触发事件
	 * @param eventName 事件名
	 * @param args 事件参数
	 */
	emit(eventName: EmitterNames, args: any) {
		this.events[eventName]?.(args);
	}

	/**
	 * 移除事件
	 * @param eventName 事件名
	 */
	off(eventName: EmitterNames) {
		delete this.events[eventName];
	}

	/**
	 * 单次监听
	 */
	once(eventName: EmitterNames, callback: (args: any) => void) {
		this.events[eventName] = (args: any) => {
			callback(args);
			this.off(eventName);
		};
	}

	/**
	 * 移除所有事件
	 */
	clear() {
		this.events = {} as Events;
	}
}

export const emitter = new EventEmitter();
