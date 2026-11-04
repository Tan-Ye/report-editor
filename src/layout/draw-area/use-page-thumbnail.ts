import { useEffect } from "react";
import type * as fabric from "fabric";
import { collectImageSources, ensureMediaImages } from "@/lib/media";
import { captureCurrentPageThumbnail } from "@/lib/report/page-thumbnail";
import { historyStore, pageStore, thumbnailStore, type PageInfo } from "@/store";

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

		function findPage(pageId: string | null): PageInfo | undefined {
			if (!pageId) {
				return undefined;
			}
			return pageStore.getPages().find((item) => item.pageId === pageId);
		}

		/** 空页不生成缩略图：侧栏的白框已经能表达「这页什么都没有」 */
		function isEmptyPage(page: PageInfo): boolean {
			return page.elements.length === 0 && !page.style?.fill;
		}

		/** 立刻抓一张 */
		function captureNow(pageId: string | null) {
			const page = findPage(pageId);
			if (!page) {
				return;
			}
			if (isEmptyPage(page)) {
				thumbnailStore.delete(page.pageId);
				return;
			}
			const url = captureCurrentPageThumbnail(canvas);
			if (url) {
				thumbnailStore.set(page.pageId, url, page);
			}
		}

		/**
		 * 等这一页的图片落地后再抓。
		 *
		 * 图片是异步解码的，页面背景图尤其明显：打开文档时白页对象先铺默认底色，
		 * 图解码完才重新刷上填充。同步抓就会抓到一张没有背景图的缩略图。
		 */
		async function captureAfterImages(pageId: string | null) {
			const page = findPage(pageId);
			if (!page) {
				return;
			}
			if (isEmptyPage(page)) {
				thumbnailStore.delete(page.pageId);
				return;
			}
			await ensureMediaImages(collectImageSources([page]));
			// 「图片就绪」通知是合并到 rAF 的，等一帧让填充真正重新应用
			await new Promise<void>((resolve) => {
				requestAnimationFrame(() => resolve());
			});
			// 等图期间可能换页了，画布上已经不是这一页
			if (canvasPageId !== pageId || pageStore.currentPage.pageId !== pageId) {
				return;
			}
			captureNow(pageId);
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
				void captureAfterImages(canvasPageId);
			}, delay);
		}

		const unsubscribePage = pageStore.subscribe(() => {
			const nextPageId = pageStore.currentPage.pageId;
			if (nextPageId !== canvasPageId) {
				// 换页：画布马上就要重载，来不及等图片，先同步补抓旧页最后的样子
				cancelTimer();
				captureNow(canvasPageId);
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
