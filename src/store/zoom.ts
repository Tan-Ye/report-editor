/** 缩放上下限：10% ~ 400% */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

/** 放大/缩小一档的倍率（按钮与 Ctrl+滚轮共用） */
export const ZOOM_STEP = 1.1;

export interface ZoomState {
	/** 绝对比例，1 = 100% */
	scale: number;
	/** 是否由用户手动缩放：false 时跟随容器「适应窗口」 */
	manual: boolean;
}

/**
 * 画布缩放状态。
 * 属于纯 UI 状态，不写进报告 JSON；视口变换由画布那侧（use-canvas）负责应用。
 */
class ZoomStore {
	private state: ZoomState = { scale: 1, manual: false };
	/** 当前容器的「适应窗口」比例，由画布在容器尺寸变化时回填 */
	private fitScale = 1;
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

	/**
	 * 回填容器算出的适配比例。
	 * 非手动模式下连 scale 一起更新，状态栏显示的始终是当前真实比例。
	 */
	setFitScale(scale: number) {
		this.fitScale = scale;
		if (this.state.manual) {
			return;
		}
		this.setScaleInternal(scale, false);
	}

	/** 直接设成某个比例：算一次手动缩放，之后不再跟随容器 */
	setScale(scale: number) {
		this.setScaleInternal(scale, true);
	}

	zoomIn() {
		this.setScale(this.state.scale * ZOOM_STEP);
	}

	zoomOut() {
		this.setScale(this.state.scale / ZOOM_STEP);
	}

	/** 回到「适应窗口」：用最近一次算出的适配比例，并交还自动适配 */
	fit() {
		this.setScaleInternal(this.fitScale, false);
	}

	private setScaleInternal(scale: number, manual: boolean) {
		const next = Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
		// 比例和模式都没变就不通知，避免订阅方做无意义的视口重设
		if (next === this.state.scale && manual === this.state.manual) {
			return;
		}
		this.state = { scale: next, manual };
		this.emit();
	}

	private emit() {
		this.listeners.forEach((listener) => {
			listener();
		});
	}
}

export const zoomStore = new ZoomStore();
