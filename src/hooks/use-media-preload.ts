import { useEffect } from "react";
import { collectImageSources, preloadMediaImages } from "@/lib/media";
import { pageStore } from "@/store";

/**
 * 图片预载。
 *
 * 加载优先级（越高越急）：
 *
 * 1. 当前页的图 —— 主画布构建对象时立即请求，不进队列
 * 2. 新插入的图 —— 插到预载队列的**队头**，下一个空闲帧就加载
 * 3. 侧栏可见页的图 —— 缩略图渲染前 `ensureMediaImages` 立即请求
 * 4. 未展示页的图 —— 打开文档时排进队列**队尾**，空闲帧一张一张来
 *
 * 这里负责 2 和 4：文档刚打开（或切了报告）时全部排到队尾；
 * 文档内新出现的图则插队。
 *
 * 放在 hook 层而不是 report-service 里：media 需要 report-service 提供
 * 当前报告目录，report-service 再反过来触发预载就会互相 import。
 */
export function useMediaPreload() {
	useEffect(() => {
		/** 已经排过队的 source，避免每次 emit 都重扫 */
		let knownSources = new Set<string>();
		/** 上一轮的页面 id：用来判断"换了文档"还是"动了当前文档" */
		let knownPages = new Set<string>();
		let initialized = false;

		const sync = () => {
			const pages = pageStore.getPages();
			const pageIds = new Set(pages.map((page) => page.pageId));
			// 页面 id 一个都不重叠 = 换了另一份报告（打开/新建），不是"插入了新图"
			const switched =
				initialized && pageIds.size > 0 && [...pageIds].every((id) => !knownPages.has(id));
			const isDocumentLoad = !initialized || switched;

			knownPages = pageIds;
			initialized = true;

			const fresh = collectImageSources(pages).filter((source) => !knownSources.has(source));
			if (fresh.length === 0) {
				return;
			}
			knownSources = new Set([...knownSources, ...fresh]);
			// 文档预载排队尾；文档内新增的图插队
			preloadMediaImages(fresh, { inserted: !isDocumentLoad });
		};

		sync();
		return pageStore.subscribe(sync);
	}, []);
}
