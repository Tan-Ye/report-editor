/**
 * 视口状态（只读镜像）。
 *
 * 真正的变换由 fabric 的 viewportTransform 持有，这里只是把它镜像一份给
 * React 层用 —— 刻度、参考线、吸附提示线都要跟着平移/缩放走，
 * 而它们都是 DOM 覆盖层，读不到画布内部的闭包。
 *
 * 每次 applyViewport / panBy / 容器 resize 之后由 use-canvas 写入。
 */
export interface ViewportState {
	/** 缩放比例 */
	scale: number;
	/** 场景原点（页面左上角）在画布容器里的位置 */
	tx: number;
	ty: number;
	/** 画布可视区尺寸（CSS 像素） */
	width: number;
	height: number;
}

const EMPTY: ViewportState = { scale: 1, tx: 0, ty: 0, width: 0, height: 0 };

class ViewportStore {
	private state: ViewportState = EMPTY;
	private listeners = new Set<() => void>();

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = () => this.state;

	getState() {
		return this.state;
	}

	set(next: ViewportState) {
		const current = this.state;
		if (
			current.scale === next.scale &&
			current.tx === next.tx &&
			current.ty === next.ty &&
			current.width === next.width &&
			current.height === next.height
		) {
			return;
		}
		this.state = next;
		this.listeners.forEach((listener) => {
			listener();
		});
	}

	/** 屏幕坐标 → 场景坐标（页面单位） */
	toScene(clientX: number, clientY: number, rect: DOMRect) {
		const { scale, tx, ty } = this.state;
		return {
			x: (clientX - rect.left - tx) / scale,
			y: (clientY - rect.top - ty) / scale,
		};
	}
}

export const viewportStore = new ViewportStore();
