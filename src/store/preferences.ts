import { MAX_RECENT_COLORS } from "@/base/colors";

export interface PreferencesState {
	/** 最近用过的填充色，最新的在前 */
	recentColors: string[];
}

/**
 * 本地 UI 偏好。
 *
 * 这些不是文档内容（不进报告 JSON），而是「这台机器上这个人的习惯」，
 * 落盘在 `<应用数据>/cache/ui-preferences.json`，和报告草稿目录同级。
 */
class PreferenceStore {
	private state: PreferencesState = { recentColors: [] };
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

	/** 启动时从磁盘恢复 */
	replaceRecentColors(colors: string[]) {
		this.commit({ recentColors: colors.slice(0, MAX_RECENT_COLORS) });
	}

	/** 记录一次用色：去重、置顶、限量 */
	addRecentColor(color: string) {
		const normalized = color.trim();
		if (!normalized) {
			return;
		}
		const key = normalized.toLowerCase();
		const rest = this.state.recentColors.filter((item) => item.toLowerCase() !== key);
		this.commit({ recentColors: [normalized, ...rest].slice(0, MAX_RECENT_COLORS) });
	}

	private commit(next: PreferencesState) {
		const same =
			next.recentColors.length === this.state.recentColors.length &&
			next.recentColors.every((color, index) => color === this.state.recentColors[index]);
		if (same) {
			return;
		}
		this.state = next;
		this.listeners.forEach((listener) => {
			listener();
		});
	}
}

export const preferenceStore = new PreferenceStore();
