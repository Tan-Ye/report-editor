import { useEffect, useRef, useSyncExternalStore } from "react";
import { saveDraft } from "@/lib/report-service";
import { saveStateStore } from "@/store";

/** 停止编辑后多久写一次草稿 */
const DRAFT_DELAY = 1500;

/**
 * 草稿自动保存。
 * 只保护"从未保存过"的报告 —— 已落盘的报告交给用户手动 Ctrl+S。
 */
export function useDraftAutosave() {
	const view = useSyncExternalStore(saveStateStore.subscribe, saveStateStore.getSnapshot);
	const timer = useRef<number | null>(null);

	useEffect(() => {
		if (!view.dirty || view.persisted) {
			return;
		}

		// revision 变了说明又改了一次，重新计时
		if (timer.current !== null) {
			window.clearTimeout(timer.current);
		}
		timer.current = window.setTimeout(() => {
			timer.current = null;
			void saveDraft();
		}, DRAFT_DELAY);

		return () => {
			if (timer.current !== null) {
				window.clearTimeout(timer.current);
				timer.current = null;
			}
		};
	}, [view.dirty, view.persisted, view.revision]);
}
