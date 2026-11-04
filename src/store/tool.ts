import type { LineStyle, ShapeType } from "@/base/elements";

export type ToolId = "select" | "rect" | "line" | "shape" | "text" | "brush";

export interface ToolState {
	/** 当前工具 */
	activeTool: ToolId;
	/** 线条工具当前选中的样式 */
	lineStyle: LineStyle;
	/** 形状工具当前选中的形状 */
	shapeType: ShapeType;
	/** 是否正在拖拽绘制 */
	drawing: boolean;
	/**
	 * 正在裁剪的元素 id；null = 没在裁剪。
	 * 属于纯 UI 状态（像工具一样），所以放这里而不是元素/页面数据里。
	 */
	croppingId: string | null;
}

/**
 * 工具状态：属于纯 UI 状态。
 * 顶栏要据此高亮当前工具和下拉项，画布要据此决定画哪种元素，
 * 但它不会被序列化进报告 JSON。
 */
class ToolStore {
	private state: ToolState = {
		activeTool: "select",
		lineStyle: "solid",
		shapeType: "ellipse",
		drawing: false,
		croppingId: null,
	};
	private listeners = new Set<() => void>();

	/** 引用稳定的订阅函数，可直接交给 useSyncExternalStore */
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	/** 完整快照：只在 setXxx 时换新对象，方便订阅方比较 */
	getSnapshot = () => this.state;

	/** 只取工具，做 useSyncExternalStore 的 selector 用（返回原始值，引用天然稳定） */
	getActiveTool = () => this.state.activeTool;

	getLineStyle = () => this.state.lineStyle;

	getShapeType = () => this.state.shapeType;

	getDrawing = () => this.state.drawing;

	/** 正在裁剪的元素 id；没在裁剪返回 null */
	getCroppingId = () => this.state.croppingId;

	/** 进入裁剪态：主画布锁住，由裁剪覆盖层接管交互 */
	startCropping(id: string) {
		if (this.state.croppingId === id) {
			return;
		}
		this.state = { ...this.state, croppingId: id };
		this.emit();
	}

	/** 退出裁剪态 */
	stopCropping() {
		if (this.state.croppingId === null) {
			return;
		}
		this.state = { ...this.state, croppingId: null };
		this.emit();
	}

	setTool(tool: ToolId) {
		if (this.state.activeTool === tool) {
			return;
		}
		// 换工具时顺带结束绘制标记，避免残留一个「正在画」的状态
		this.state = { ...this.state, activeTool: tool, drawing: false };
		this.emit();
	}

	setLineStyle(lineStyle: LineStyle) {
		if (this.state.lineStyle === lineStyle) {
			return;
		}
		this.state = { ...this.state, lineStyle };
		this.emit();
	}

	setShapeType(shapeType: ShapeType) {
		if (this.state.shapeType === shapeType) {
			return;
		}
		this.state = { ...this.state, shapeType };
		this.emit();
	}

	setDrawing(drawing: boolean) {
		if (this.state.drawing === drawing) {
			return;
		}
		this.state = { ...this.state, drawing };
		this.emit();
	}

	private emit() {
		this.listeners.forEach((listener) => {
			listener();
		});
	}
}

export const toolStore = new ToolStore();
