import { normalizePath } from "@/lib/utils";

/**
 * 数据目录列表。
 *
 * 每个目录就是"一套报告库"：里面有自己的 `data/`（已保存）和 `cache/`（草稿）。
 * 内置目录（应用数据目录）永远排在第一个、不可删除；用户添加的目录可以删，
 * 其中一个是"默认目录"——新建的报告落在它下面。
 */
export interface DataDir {
	/** 绝对路径 */
	path: string;
	/** 内置目录不可删除 */
	builtin: boolean;
}

export interface DataDirsState {
	dirs: DataDir[];
	/** 默认目录的绝对路径；新建报告存这里 */
	defaultPath: string;
}

const EMPTY: DataDirsState = { dirs: [], defaultPath: "" };

class DataDirsStore {
	private state: DataDirsState = EMPTY;
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

	/** 默认目录；还没初始化时返回空串，调用方回落到内置目录 */
	getDefaultPath(): string {
		return this.state.defaultPath;
	}

	/** 启动时初始化：内置目录永远在第一位 */
	init(builtinPath: string, saved: { dirs?: string[]; defaultPath?: string }): void {
		const dirs: DataDir[] = [{ path: builtinPath, builtin: true }];
		for (const path of saved.dirs ?? []) {
			if (!path || typeof path !== "string") {
				continue;
			}
			if (dirs.some((dir) => normalizePath(dir.path) === normalizePath(path))) {
				continue;
			}
			dirs.push({ path, builtin: false });
		}
		const wanted = saved.defaultPath ?? "";
		const matched = dirs.find((dir) => normalizePath(dir.path) === normalizePath(wanted));
		this.commit({ dirs, defaultPath: matched?.path ?? builtinPath });
	}

	/** 添加一个目录；已存在或就是内置目录时返回 false */
	addDir(path: string): boolean {
		const trimmed = path.trim();
		if (!trimmed) {
			return false;
		}
		if (this.state.dirs.some((dir) => normalizePath(dir.path) === normalizePath(trimmed))) {
			return false;
		}
		this.commit({
			...this.state,
			dirs: [...this.state.dirs, { path: trimmed, builtin: false }],
		});
		return true;
	}

	/** 移除目录（内置目录不可删）；删掉的正好是默认目录时回落到内置目录 */
	removeDir(path: string): boolean {
		const target = this.state.dirs.find(
			(dir) => normalizePath(dir.path) === normalizePath(path),
		);
		if (!target || target.builtin) {
			return false;
		}
		const dirs = this.state.dirs.filter((dir) => dir !== target);
		const defaultPath =
			normalizePath(this.state.defaultPath) === normalizePath(target.path)
				? (dirs[0]?.path ?? "")
				: this.state.defaultPath;
		this.commit({ dirs, defaultPath });
		return true;
	}

	setDefaultDir(path: string): boolean {
		const target = this.state.dirs.find(
			(dir) => normalizePath(dir.path) === normalizePath(path),
		);
		if (!target) {
			return false;
		}
		this.commit({ ...this.state, defaultPath: target.path });
		return true;
	}

	/** 序列化给 UI 偏好文件（内置目录不落盘：它的路径是环境决定的） */
	toJSON(): { dirs: string[]; defaultPath: string } {
		return {
			dirs: this.state.dirs.filter((dir) => !dir.builtin).map((dir) => dir.path),
			defaultPath: this.state.defaultPath,
		};
	}

	private commit(next: DataDirsState) {
		const same =
			next.defaultPath === this.state.defaultPath &&
			next.dirs.length === this.state.dirs.length &&
			next.dirs.every((dir, index) => dir.path === this.state.dirs[index]?.path);
		if (same) {
			return;
		}
		this.state = next;
		this.listeners.forEach((listener) => {
			listener();
		});
	}
}

export const dataDirsStore = new DataDirsStore();
