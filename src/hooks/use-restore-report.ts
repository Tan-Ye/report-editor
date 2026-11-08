import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "@/components/ui/toast";
import { discardDraft, listDraftsInAllDirs, orphanDrafts, type DraftEntry } from "@/lib/report/service/library";
import { parseOpenTarget } from "@/lib/report/service/window";
import {
	createNewReport,
	openDraft,
	openDraftInNewWindow,
	openTemplate,
	restoreLastReport,
} from "@/lib/report/service";
import { releaseAllOnUnload } from "@/lib/report/service/session";
import { runWhenIdle } from "@/lib/utils";
import { startSpan } from "@/lib/startup-timing";
import { saveStateStore } from "@/store";

/** 启动时发现的未保存内容：交给界面弹「全部恢复 / 全部丢弃 / 稍后」 */
export interface DraftPrompt {
	drafts: DraftEntry[];
	/** 全部恢复；当前窗口是干净的就把最新一份接过来，其余开新窗口 */
	restoreAll: () => Promise<void>;
	/** 全部丢弃 */
	discardAll: () => Promise<void>;
	/** 稍后处理：草稿留着，还能从「打开」抽屉里找到 */
	dismiss: () => void;
}

export interface RestoreReportResult {
	/** null = 不提示（没扫到孤儿草稿，或这个窗口本来就不是"恢复上次报告"的窗口） */
	draftPrompt: DraftPrompt | null;
}

/**
 * 启动时恢复上一次的报告。
 *
 * 三种启动来源，优先级从高到低：
 * 1. `?open=draft&folder=…&root=…` / `?open=template&…`：被「打开未保存的内容 / 模板」
 *    叫起来的新窗口，只打开这一份（模板会以它为内容新建报告）
 * 2. `?new=1`：新建报告开出来的窗口，必须是一份空白文档 ——
 *    否则新窗口会恢复同一个报告，两个窗口编辑同一份内容、互相覆盖
 * 3. 什么都没有：正常启动，恢复所有数据目录里最近修改的一份报告
 *
 * 恢复完之后再扫一遍孤儿草稿（`cache/` 里没有对应正式报告的那些），
 * 有就提示用户找回 —— 它们通常是崩溃或异常退出留下的。
 *
 * 同时负责在窗口关闭时释放报告占用（Rust 侧的登记表），
 * 否则那个报告会被当成"永远被占用"，别的窗口打不开。
 */
export function useRestoreReport(): RestoreReportResult {
	const [drafts, setDrafts] = useState<DraftEntry[]>([]);

	useEffect(() => {
		const handleUnload = () => {
			void releaseAllOnUnload();
		};
		window.addEventListener("beforeunload", handleUnload);

		const search = window.location.search;
		const target = parseOpenTarget(search);
		if (target) {
			// 这个窗口就是来打开这份内容（草稿 / 模板）的：
			// 不要再去恢复上次报告，会先闪一下别的文档
			const opening =
				target.area === "template"
					? openTemplate(target.root, target.folder)
					: openDraft(target.root, target.folder);
			void opening.then((ok) => {
				// 打不开（被删了/被别的窗口占了）也得让窗口能用，不能空着
				if (!ok) {
					createNewReport({ silent: true });
				}
			});
		} else if (new URLSearchParams(search).get("new") !== "1") {
			void (async () => {
				await restoreLastReport();
				// 草稿列表不阻塞首屏：等浏览器空闲再扫。
				// 有孤儿草稿也只是晚一点弹提示，不影响正在恢复的报告
				runWhenIdle(() => {
					const span = startSpan("draft-scan-idle");
					void (async () => {
						try {
							setDrafts(orphanDrafts(await listDraftsInAllDirs()));
						} catch {
							setDrafts([]);
						}
						span.end();
					})();
				});
			})();
		}

		return () => {
			window.removeEventListener("beforeunload", handleUnload);
			void releaseAllOnUnload();
		};
	}, []);

	const restoreAll = useCallback(async () => {
		if (drafts.length === 0) {
			return;
		}
		const queue = [...drafts];
		setDrafts([]);

		// 当前窗口是干净的才就地打开：有未保存内容时宁可开新窗口，
		// 恢复草稿不能把用户正在编辑的东西顶掉
		let restoredInPlace = 0;
		if (!saveStateStore.isDirty()) {
			const first = queue.shift();
			if (first && (await openDraft(first.root, first.folder, { silent: true }))) {
				restoredInPlace = 1;
			}
		}

		let openedInWindow = 0;
		for (const entry of queue) {
			if (await openDraftInNewWindow(entry)) {
				openedInWindow += 1;
			}
		}

		const total = restoredInPlace + openedInWindow;
		if (total === 0) {
			toast.add({
				title: "没有恢复任何内容",
				description: "草稿可能已被其它窗口打开，或者内容已经损坏",
				type: "warning",
			});
			return;
		}
		toast.add({
			title: `已恢复 ${total} 份未保存的内容`,
			description: openedInWindow > 0 ? `其中 ${openedInWindow} 份在新窗口打开` : undefined,
			type: "success",
		});
	}, [drafts]);

	const discardAll = useCallback(async () => {
		const queue = drafts;
		setDrafts([]);
		await Promise.all(queue.map((entry) => discardDraft(entry.root, entry.folder)));
		if (queue.length > 0) {
			toast.add({ title: `已丢弃 ${queue.length} 份未保存的内容`, type: "info" });
		}
	}, [drafts]);

	const dismiss = useCallback(() => setDrafts([]), []);

	const draftPrompt = useMemo<DraftPrompt | null>(
		() => (drafts.length > 0 ? { drafts, restoreAll, discardAll, dismiss } : null),
		[drafts, restoreAll, discardAll, dismiss],
	);

	return { draftPrompt };
}
