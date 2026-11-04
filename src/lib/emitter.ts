import type { ElementShadow, FillSpec } from "@/store";
import type { AlignDirection } from "./element/align";

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

/** 属性面板可以改的几何字段。没有对应维度的元素不传（例如线条没有 width） */
export interface ElementGeometryPatch {
	left?: number;
	top?: number;
	width?: number;
	height?: number;
	length?: number;
	angle?: number;
}

/** 属性面板可以改的外观字段。元素没有对应白名单字段时会被忽略 */
export interface ElementStylePatch {
	/** 填充：纯色 / 渐变 / 图片（文本里它就是字色） */
	fill?: FillSpec;
	stroke?: string;
	strokeWidth?: number;
	fontSize?: number;
	fontWeight?: string | number;
	fontFamily?: string;
	textAlign?: string;
	lineHeight?: number;
	/** 阴影；null 表示移除 */
	shadow?: ElementShadow | null;
}

/** 元素命令载荷：对齐、按属性面板改几何 / 改外观 / 改页面背景 */
export type ElementCommandPayload =
	| { type: "align"; direction: AlignDirection }
	| {
			type: "update-geometry";
			id: string;
			patch: ElementGeometryPatch;
			/** 是否记一步历史：拖动圆盘时先置 false，松手后再提交 */
			commit?: boolean;
	  }
	| {
			type: "update-style";
			id: string;
			patch: ElementStylePatch;
			/** 是否记一步历史：拖动取色器时先置 false，松手后再统一提交 */
			commit?: boolean;
	  }
	| { type: "update-page-background"; paint: FillSpec | undefined; commit?: boolean }
	/** 插入图片元素：fill 里已经带着导入好的图片路径，width/height 是原始像素尺寸 */
	| { type: "insert-image"; fill: FillSpec; width: number; height: number };

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
