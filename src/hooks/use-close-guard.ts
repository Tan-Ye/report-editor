import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { discardCurrentDraft, saveReport } from "@/lib/report/service";
import { saveStateStore } from "@/store";

export interface CloseGuard {
	/** 是否正在问用户「要不要保存」 */
	asking: boolean;
	/** 保存后关闭；保存失败就留在窗口里 */
	closeAfterSave: () => Promise<void>;
	/** 不保存直接关 */
	closeWithoutSaving: () => Promise<void>;
	/** 取消：留在窗口里 */
	cancelClose: () => void;
}

/**
 * 关窗拦截。
 *
 * Tauri 的窗口关闭事件可以被阻止：文档脏的时候 preventDefault，弹一个
 * 「不保存 / 取消 / 保存」的三选一；选完之后用 `destroy()` 关窗 —— 不能再用 `close()`，
 * 否则又会触发一次 onCloseRequested，绕回自己。
 */
export function useCloseGuard(): CloseGuard {
	const [asking, setAsking] = useState(false);

	useEffect(() => {
		const currentWindow = getCurrentWindow();
		let unlisten: (() => void) | undefined;
		let disposed = false;

		void currentWindow
			.onCloseRequested((event) => {
				if (!saveStateStore.isDirty()) {
					// 没有未保存内容：放行，走默认关闭流程
					return;
				}
				event.preventDefault();
				setAsking(true);
			})
			.then((stop) => {
				if (disposed) {
					stop();
					return;
				}
				unlisten = stop;
			});

		return () => {
			disposed = true;
			unlisten?.();
		};
	}, []);

	const closeNow = useCallback(async () => {
		await getCurrentWindow().destroy();
	}, []);

	const closeAfterSave = useCallback(async () => {
		await saveReport();
		// 保存失败（或保存期间又改了）就别关，把窗口留给用户
		if (saveStateStore.isDirty()) {
			setAsking(false);
			return;
		}
		await closeNow();
	}, [closeNow]);

	const closeWithoutSaving = useCallback(async () => {
		// 「不保存」就是不要这些改动了：草稿也得删掉。
		// 留着的话下次打开同一份报告会把它当成崩溃残留恢复回来，
		// 用户会看到自己刚丢掉的内容又冒出来。
		await discardCurrentDraft();
		await closeNow();
	}, [closeNow]);

	const cancelClose = useCallback(() => {
		setAsking(false);
	}, []);

	return { asking, closeAfterSave, closeWithoutSaving, cancelClose };
}
