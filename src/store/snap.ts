/**
 * 吸附提示线：拖动元素时被吸住的那条位置。
 *
 * 只存在内存里，由覆盖层读出来画一条虚线，松手即清空。
 */
export interface SnapHint {
	/** 竖直提示线的场景 x */
	x: number | null;
	/** 水平提示线的场景 y */
	y: number | null;
}

const EMPTY: SnapHint = { x: null, y: null };

class SnapStore {
	private state: SnapHint = EMPTY;
	private listeners = new Set<() => void>();

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = () => this.state;

	set(next: SnapHint) {
		if (next.x === this.state.x && next.y === this.state.y) {
			return;
		}
		this.state = next;
		this.listeners.forEach((listener) => {
			listener();
		});
	}

	clear() {
		this.set(EMPTY);
	}
}

export const snapStore = new SnapStore();
