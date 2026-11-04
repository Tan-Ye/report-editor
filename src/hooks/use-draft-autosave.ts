import { useEffect, useRef } from "react";
import { saveDraft } from "@/lib/report/service";
import { saveStateStore } from "@/store";

/** 检查间隔：只要还有新改动，最多等这么久就落一次盘 */
const DRAFT_INTERVAL = 2000;

/**
 * 草稿自动保存。
 *
 * 曾经的写法是「每次改动重置一个 1.5s 定时器」，问题很致命：
 * 拖拽、打字、画一笔都会 commit，revision 一直在变，定时器就一直被重置 ——
 * **只要用户不连续停手 1.5 秒，草稿就永远不写**。编辑得越投入，丢得越多。
 *
 * 现在改成固定间隔轮询 + 版本号去重：
 * 每 2 秒检查一次，有未落盘的新改动就写。连续编辑时也保证每 2 秒有一次快照。
 */
export function useDraftAutosave() {
	/** 上次写进草稿的 revision，没变就不重复写 */
	const lastSavedRevision = useRef(-1);

	useEffect(() => {
		const flush = () => {
			const state = saveStateStore.getState();
			if (state.saving || !saveStateStore.isDirty()) {
				return;
			}
			if (state.revision === lastSavedRevision.current) {
				return;
			}
			lastSavedRevision.current = state.revision;
			void saveDraft();
		};

		const timer = window.setInterval(flush, DRAFT_INTERVAL);

		// 切走窗口/最小化时立刻补一次：系统休眠、强制关机前这是最后的机会
		const handleHidden = () => {
			if (document.visibilityState === "hidden") {
				flush();
			}
		};
		document.addEventListener("visibilitychange", handleHidden);

		return () => {
			window.clearInterval(timer);
			document.removeEventListener("visibilitychange", handleHidden);
		};
	}, []);
}
