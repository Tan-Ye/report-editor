import { pageStore } from "./page";
import type { PageInfo } from "./page";
import { saveStateStore } from "./save-state";

/** 一份文档快照。pages 是引用，依赖 store 的不可变更新来保证它不会被后续修改 */
export interface DocumentSnapshot {
	pages: PageInfo[];
	current: number;
}

export interface HistoryView {
	canUndo: boolean;
	canRedo: boolean;
}

/**
 * 历史上限。
 *
 * 每步真正新增的只有「pages 数组 + 被改动的元素对象」——
 * store 全是不可变更新，未变化的元素和页面对象在快照之间共享引用。
 * 一页 50 个元素时每步约 0.7KB，一万步约 7MB；页面上元素多的时候会线性上升
 * （每页 500 元素时每步约 4KB，一万步约 40MB），到那量级再调这个值。
 */
const HISTORY_LIMIT = 10_000;

/**
 * 撤销/重做。
 *
 * 采用快照栈：栈里每一项是「一次操作之后的文档状态」，
 * index 指向当前所处的位置。撤销就是把 index 往回挪并恢复对应快照。
 */
class HistoryStore {
	private snapshots: DocumentSnapshot[] = [];
	private index = -1;
	private view: HistoryView = { canUndo: false, canRedo: false };
	private listeners = new Set<() => void>();
	/** 文档内容变化的订阅方（缩略图这类「不用跟着状态变、只想知道改过了」的消费者） */
	private changeListeners = new Set<() => void>();

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	/**
	 * 订阅「文档内容变了」。
	 * 和 subscribe 的区别：那个只在可撤销/可重做状态变化时通知，
	 * 而缩略图每次提交都要重画，所以要有一个独立信号。
	 * @returns 取消订阅
	 */
	onDocumentChange(listener: () => void) {
		this.changeListeners.add(listener);
		return () => {
			this.changeListeners.delete(listener);
		};
	}

	/** 返回缓存的视图对象：只有状态真的变了才换新引用，满足 useSyncExternalStore 的要求 */
	getSnapshot = () => this.view;

	/**
	 * 记录一次操作结束后的文档状态。
	 * 内容没变（pages 引用和 current 都没动）就不入栈，避免空操作污染历史。
	 */
	commit() {
		const snapshot = this.capture();
		const currentSnapshot = this.snapshots[this.index];
		if (currentSnapshot && isSameSnapshot(currentSnapshot, snapshot)) {
			return;
		}

		// 在历史中间做了新操作：丢掉后面的重做分支
		this.snapshots = this.snapshots.slice(0, this.index + 1);
		this.snapshots.push(snapshot);
		if (this.snapshots.length > HISTORY_LIMIT) {
			this.snapshots.shift();
		}
		this.index = this.snapshots.length - 1;
		// 每次文档改动都从历史这里过，标记脏状态放在这一处就不会漏
		saveStateStore.markDirty();
		this.updateView();
		this.notifyDocumentChange();
	}

	undo() {
		if (this.index <= 0) {
			return;
		}
		const from = this.snapshots[this.index];
		const to = this.snapshots[this.index - 1];
		this.index -= 1;
		// 数据用「上一个快照」，但当前页用「被撤销的那一步」——
		// 这样撤销会跳回改动发生的那一页，而不是跳回上一次提交时所在的页
		this.restore({ pages: to.pages, current: from.current });
		saveStateStore.markDirty();
		this.updateView();
		this.notifyDocumentChange();
	}

	redo() {
		if (this.index < 0 || this.index >= this.snapshots.length - 1) {
			return;
		}
		const to = this.snapshots[this.index + 1];
		this.index += 1;
		this.restore({ pages: to.pages, current: to.current });
		saveStateStore.markDirty();
		this.updateView();
		this.notifyDocumentChange();
	}

	/** 重置历史（初始化、打开文件之后调用）：清空栈，把当前状态作为新的起点 */
	reset() {
		this.snapshots = [this.capture()];
		this.index = 0;
		this.updateView();
	}

	private capture(): DocumentSnapshot {
		return { pages: pageStore.state.pages, current: pageStore.state.current };
	}

	private restore(snapshot: DocumentSnapshot) {
		// replacePages 会让 revision 自增，画布据此强制重载（而不是把画布内容写回 store）
		pageStore.replacePages(snapshot.pages, snapshot.current);
	}

	private updateView() {
		const canUndo = this.index > 0;
		const canRedo = this.index >= 0 && this.index < this.snapshots.length - 1;
		if (canUndo === this.view.canUndo && canRedo === this.view.canRedo) {
			return;
		}

		this.view = { canUndo, canRedo };
		this.listeners.forEach((listener) => {
			listener();
		});
	}

	/** 文档内容变了：不管能不能撤销，都要通知 */
	private notifyDocumentChange() {
		this.changeListeners.forEach((listener) => {
			// 订阅方抛错不能反噬主流程：commit 是在 fabric 的鼠标事件里同步调的，
			// 这里炸一次，画布就会停在「拖拽没结束」的状态
			try {
				listener();
			} catch (error) {
				console.error("文档变更订阅方出错", error);
			}
		});
	}
}

/**
 * 快照内容是否完全相同。
 * store 每次写入都会换新的 pages 数组，所以引用相等就足够判断「文档没变」。
 */
function isSameSnapshot(a: DocumentSnapshot, b: DocumentSnapshot) {
	return a.pages === b.pages && a.current === b.current;
}

export const historyStore = new HistoryStore();
