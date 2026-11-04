import { useSyncExternalStore } from "react";

/**
 * 示例演示的运行状态。
 *
 * 单独放一个 store 而不是组件内部 state：顶栏按钮（启动/停止）和画布区域的
 * 提示都要读它，跨组件共享。
 */
export interface DemoState {
	running: boolean;
	/** 当前这一步在做什么，显示在按钮旁边 */
	step: string;
}

class DemoStore {
	private state: DemoState = { running: false, step: "" };
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

	set(next: Partial<DemoState>) {
		this.state = { ...this.state, ...next };
		this.listeners.forEach((listener) => listener());
	}

	isRunning() {
		return this.state.running;
	}
}

export const demoStore = new DemoStore();

/** 组件里订阅演示状态 */
export function useDemoState(): DemoState {
	return useSyncExternalStore(demoStore.subscribe, demoStore.getSnapshot);
}
