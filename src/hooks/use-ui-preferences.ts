import { useEffect } from "react";
import { loadUiPreferences } from "@/lib/ui-preferences";

/**
 * 启动时把本地 UI 偏好（最近使用色等）读进 store。
 * 只跑一次：读失败按空处理，不打扰用户。
 */
export function useUiPreferences() {
	useEffect(() => {
		void loadUiPreferences();
	}, []);
}
