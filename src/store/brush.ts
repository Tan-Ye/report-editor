/**
 * 画笔设置：纯 UI 状态，不进报告 JSON ——
 * 画出来的每一笔是文档内容（各自带着颜色和粗细），画笔本身只是"下一次用多少"。
 */

/** 笔头形状：圆头 / 方头 */
export type BrushCap = "round" | "butt";

export interface BrushState {
	color: string;
	/** 线宽（场景单位） */
	width: number;
	cap: BrushCap;
}

const INITIAL: BrushState = {
	color: "#1e293b",
	width: 6,
	cap: "round",
};

class BrushStore {
	private state: BrushState = INITIAL;
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

	setColor(color: string) {
		this.commit({ ...this.state, color });
	}

	setWidth(width: number) {
		this.commit({ ...this.state, width: Math.min(Math.max(width, 1), 200) });
	}

	setCap(cap: BrushCap) {
		this.commit({ ...this.state, cap });
	}

	private commit(next: BrushState) {
		if (
			next.color === this.state.color &&
			next.width === this.state.width &&
			next.cap === this.state.cap
		) {
			return;
		}
		this.state = next;
		this.listeners.forEach((listener) => {
			listener();
		});
	}
}

export const brushStore = new BrushStore();
