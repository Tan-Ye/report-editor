import type { PageInfo } from "./page";

/** 一张页面缩略图。page 是画它时用的那份页面数据，用来判断是否过期 */
export interface PageThumbnail {
	/** data URL（image/jpeg），直接喂给 <img src> */
	url: string;
	/** 画这张图时的页面对象引用 */
	page: PageInfo;
}

export interface ThumbnailState {
	/** pageId → 缩略图 */
	images: Map<string, PageThumbnail>;
}

/**
 * 页面缩略图。
 *
 * 纯内存、不落盘：离屏渲染一页很便宜，存盘反而要额外处理缓存失效，
 * 而且缩略图本来就不是文档内容的一部分。
 *
 * 过期判断用「画它时的页面对象引用」：pageStore 是不可变更新，
 * 页面没动过引用就不会变 —— 元素改动、背景改动、撤销/重做都只会换掉真变了的那几页。
 * （早先比的是 elements 数组引用，背景色改动时 elements 不变，会漏判。）
 */
class ThumbnailStore {
	private state: ThumbnailState = { images: new Map<string, PageThumbnail>() };
	private listeners = new Set<() => void>();

	/** 引用稳定的订阅函数，可直接交给 useSyncExternalStore */
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = () => this.state;

	get(pageId: string) {
		return this.state.images.get(pageId);
	}

	/** 这页现有的缩略图是不是还能用。空页本来就不该有图（白框就是它的样子） */
	isFresh(pageId: string, page: PageInfo) {
		if (page.elements.length === 0 && !page.style?.fill) {
			return !this.state.images.has(pageId);
		}
		return this.state.images.get(pageId)?.page === page;
	}

	set(pageId: string, url: string, page: PageInfo) {
		const images = new Map(this.state.images);
		images.set(pageId, { url, page });
		this.update(images);
	}

	delete(pageId: string) {
		if (!this.state.images.has(pageId)) {
			return;
		}
		const images = new Map(this.state.images);
		images.delete(pageId);
		this.update(images);
	}

	/** 换一遍 Map 而不是原地改：useSyncExternalStore 靠引用判断有没有变 */
	private update(images: Map<string, PageThumbnail>) {
		this.state = { images };
		this.listeners.forEach((listener) => {
			listener();
		});
	}
}

export const thumbnailStore = new ThumbnailStore();
