import { useEffect } from "react";
import { ensurePreferencesLoaded } from "@/lib/ui-preferences";

/**
 * 启动时把本地 UI 偏好（最近使用色、数据目录列表）读进 store。
 * 只跑一次：读失败按空处理，不打扰用户；报告 IO 之前也会 await 同一个 Promise。
 */
export function useUiPreferences() {
	useEffect(() => {
		void ensurePreferencesLoaded();
	}, []);
}
