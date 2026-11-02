import { useEffect } from "react";
import type * as fabric from "fabric";
import { captureCurrentPageThumbnail } from "@/lib/page-thumbnail";
import { historyStore, pageStore, thumbnailStore } from "@/store";

/** 操作停下来多久再抓：拖拽、输入都结束了才值得画一张 */
const CAPTURE_DELAY = 300;

/**
 * 当前页缩略图。
 *
 * 只做「当前页」这一件事：直接从主画布抓图（所见即所得，不用重建对象）。
 * 其它页交给侧栏的懒加载队列离屏渲染，两边写的是同一个 thumbnailStore。
 *
 * **必须在 usePage 之前调用**：pageStore 按注册顺序通知订阅方，
 * 这个顺序保证换页时先轮到我们 —— 那一刻画布还停在旧页，正好补抓它最后的状态，
 * 之后再轮到 usePage 重载新页。
 */
export function usePageThumbnail(canvas: fabric.Canvas | null) {
	useEffect(() => {
		if (!canvas) {
			return;
		}
		return setup(canvas);
	}, [canvas]);

	function setup(canvas: fabric.Canvas) {
		let timer: number | null = null;
		/** 画布上现在装的是哪一页。换页时它比 pageStore 慢一步，要单独记 */
		let canvasPageId: string | null = pageStore.currentPage.pageId;

		function capturePage(pageId: string | null) {
			if (!pageId) {
				return;
			}
			const page = pageStore.getPages().find((item) => item.pageId === pageId);
			if (!page) {
				return;
			}
			// 既没元素也没背景：把旧图撤掉，白框就是空页应该有的样子
			if (page.elements.length === 0 && !page.style?.fill) {
				thumbnailStore.delete(page.pageId);
				return;
			}
			const url = captureCurrentPageThumbnail(canvas);
			if (url) {
				thumbnailStore.set(page.pageId, url, page);
			}
		}

		function cancelTimer() {
			if (timer !== null) {
				window.clearTimeout(timer);
				timer = null;
			}
		}

		/** 延后抓图：换页/撤销要等画布重载完（0ms），文档改动要等操作停下（300ms） */
		function schedule(delay: number) {
			cancelTimer();
			timer = window.setTimeout(() => {
				timer = null;
				capturePage(canvasPageId);
			}, delay);
		}

		const unsubscribePage = pageStore.subscribe(() => {
			const nextPageId = pageStore.currentPage.pageId;
			if (nextPageId !== canvasPageId) {
				// 换页：画布还没重载，先把欠着的那次抓图补上，否则最后一笔编辑会丢
				cancelTimer();
				capturePage(canvasPageId);
				canvasPageId = nextPageId;
			}
			// 等 use-page 重载完再抓新一页
			schedule(0);
		});

		// 文档改动（拖动/绘制/对齐/属性面板…）：等操作停下来再抓，别跟着每一帧走
		const unsubscribeHistory = historyStore.onDocumentChange(() => schedule(CAPTURE_DELAY));

		// 首次装载：use-page 会在本 hook 的 effect 之后同步装好元素，所以延后一拍
		schedule(0);

		return () => {
			cancelTimer();
			unsubscribePage();
			unsubscribeHistory();
		};
	}
}
