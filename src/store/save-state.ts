/**
 * 保存状态。
 *
 * 用「修订号」派生脏状态，而不是自己维护一个 boolean：
 * 保存开始时记下当时的 revision，写盘成功后只有 revision 没再变才敢标干净
 * —— 否则保存过程中用户的改动会被误判成"已保存"。
 */
export interface SaveState {
	/** 文档每变一次 +1 */
	revision: number;
	/** 最近一次成功保存时的 revision */
	savedRevision: number;
	saving: boolean;
	/** 是否已经落盘过：false 表示还是草稿，写在 cache；true 表示在 data */
	persisted: boolean;
	/** 最近一次成功保存的时间戳 */
	savedAt: number | null;
	/** 最近一次失败原因 */
	error: string | null;
}

export interface SaveView {
	dirty: boolean;
	saving: boolean;
	persisted: boolean;
	savedAt: number | null;
	error: string | null;
	/** 文档修订号：订阅方用它感知「又改了一次」，比如草稿自动保存的重置计时 */
	revision: number;
}

const INITIAL_STATE: SaveState = {
	revision: 0,
	savedRevision: 0,
	saving: false,
	persisted: false,
	savedAt: null,
	error: null,
};

class SaveStateStore {
	private state: SaveState = INITIAL_STATE;
	private view: SaveView = toView(INITIAL_STATE);
	private listeners = new Set<() => void>();

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	/** 返回缓存的视图对象，满足 useSyncExternalStore 对稳定引用的要求 */
	getSnapshot = () => this.view;

	getState = () => this.state;

	isDirty() {
		return this.state.revision !== this.state.savedRevision;
	}

	/** 文档发生改动 */
	markDirty() {
		this.update({ ...this.state, revision: this.state.revision + 1 });
	}

	/** 开始写盘：返回本次保存对应的修订号，成功后用它判断期间有没有新改动 */
	beginSave() {
		this.update({ ...this.state, saving: true, error: null });
		return this.state.revision;
	}

	/** 写盘成功 */
	endSave(savedRevision: number) {
		this.update({
			...this.state,
			saving: false,
			// 只有期间没有新改动才算干净，否则保持脏
			savedRevision: savedRevision,
			persisted: true,
			savedAt: Date.now(),
			error: null,
		});
	}

	/** 写盘失败 */
	failSave(message: string) {
		this.update({ ...this.state, saving: false, error: message });
	}

	/** 新建/打开报告后重置 */
	reset(persisted = false) {
		this.state = { ...INITIAL_STATE, persisted };
		this.update(this.state);
	}

	private update(next: SaveState) {
		this.state = next;
		const nextView = toView(next);
		if (isSameView(this.view, nextView)) {
			return;
		}
		this.view = nextView;
		this.listeners.forEach((listener) => {
			listener();
		});
	}
}

function toView(state: SaveState): SaveView {
	return {
		dirty: state.revision !== state.savedRevision,
		saving: state.saving,
		persisted: state.persisted,
		savedAt: state.savedAt,
		error: state.error,
		revision: state.revision,
	};
}

function isSameView(a: SaveView, b: SaveView) {
	return (
		a.dirty === b.dirty &&
		a.saving === b.saving &&
		a.persisted === b.persisted &&
		a.savedAt === b.savedAt &&
		a.error === b.error &&
		a.revision === b.revision
	);
}

export const saveStateStore = new SaveStateStore();
