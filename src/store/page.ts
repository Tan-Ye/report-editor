import type { ElementInfo } from "./element";
import type { FillSpec } from "./fill";
import { createUniqueId } from "@/lib/utils";

/** 页面级样式。单独一层是为了以后还有出血位、网格线之类的属性 */
export interface PageStyle {
	/** 绘制区域的填充（纯色 / 渐变 / 图片） */
	fill?: FillSpec;
}

/**
 * 参考线。
 * 存在页面上而不是报告层：撤销快照只捕获 pages，放这里天然能撤销、能算脏。
 */
export interface PageGuide {
	/** x = 竖直参考线（固定横坐标）；y = 水平参考线（固定纵坐标） */
	axis: "x" | "y";
	/** 场景坐标（页面单位）。创建和拖动时都按 10 取整，避免出现零碎位置 */
	position: number;
}

export interface PageInfo {
	pageId: string;
	pageName: string;
	elements: ElementInfo[];
	/**
	 * 页面背景（绘制区域的填充）。不填就是默认白纸。
	 * 背景不是页面里的元素 —— 它永远铺在最底层，不参与选中/层级/对齐。
	 */
	style?: PageStyle;
	/** 参考线。和元素一样存在页面里，随文件保存 */
	guides?: PageGuide[];
}

export interface PagesState {
	pages: PageInfo[];
	/** 当前页下标。只存在于内存，不写进文件 */
	current: number;
	/**
	 * 整体替换计数（读文件、撤销恢复时自增）。
	 * 画布靠它区分「用户切页」和「外部整体替换」：后者不能把画布内容写回 store。
	 */
	revision: number;
}

/**
 * 新建页面。每次都返回全新对象——
 * 原来的 { ...INIT_PAGE } 是浅拷贝，会把 INIT_PAGE.elements 的数组引用复制给所有页，
 * 导致第 2 页加的元素在第 1 页也能看到。
 */
export function createPage(overrides: Partial<Pick<PageInfo, "pageId" | "pageName">> = {}): PageInfo {
	return {
		pageId: overrides.pageId ?? createUniqueId("page"),
		pageName: overrides.pageName ?? "",
		elements: [],
	};
}

/**
 * 页面信息存储,单例模式
 *
 * currentPage 是从 pages[current] 派生的 getter，不再单独存一份，
 * 结构上就不会出现 currentPage 与 pages[current] 分叉。
 *
 * 只在「页面列表/当前页」这类结构性变化时通知订阅方；
 * 元素内容的增删改不通知，避免拖一下元素就让整个侧栏重渲染。
 *
 * 所有写入都是不可变更新（新数组、新对象），历史快照因此可以只存引用、
 * 靠结构共享省内存。
 */
class PageStore {
	state: PagesState;
	private listeners = new Set<() => void>();

	constructor() {
		this.state = {
			pages: [createPage({ pageName: "页面 1" })],
			current: 0,
			revision: 0,
		};
	}

	/** 引用稳定的订阅函数，可直接交给 useSyncExternalStore */
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	/** 完整快照：只在结构性变化时换新对象 */
	getSnapshot = () => this.state;

	private emit() {
		this.listeners.forEach((listener) => {
			listener();
		});
	}

	/** 当前页面：始终派生自 pages */
	get currentPage(): PageInfo {
		return this.state.pages[this.state.current] ?? this.state.pages[0];
	}

	isValidIndex(index: number) {
		return Number.isInteger(index) && index >= 0 && index < this.state.pages.length;
	}

	/**
	 * 切换页面：只改选中下标，不动页面数据
	 * @param index 目标页下标，越界时忽略
	 */
	setCurrentPage(index: number) {
		if (!this.isValidIndex(index) || this.state.current === index) {
			return;
		}
		this.state = { ...this.state, current: index };
		this.emit();
	}

	/**
	 * 页面数据变动时写回 pages
	 * @param page 更新后的页面信息
	 */
	updateCurrentPage(page: PageInfo) {
		const index = this.state.pages.findIndex((item) => item.pageId === page.pageId);
		const target = index === -1 ? this.state.current : index;
		const pages = [...this.state.pages];
		pages[target] = page;
		this.state = { ...this.state, pages };
	}

	/**
	 * 添加页面
	 * @returns 新页面的下标（是否切过去由调用方决定）
	 */
	addPage(page: PageInfo = createPage({ pageName: `页面 ${this.state.pages.length + 1}` })) {
		const pages = [...this.state.pages, page];
		this.state = { ...this.state, pages };
		this.emit();
		return pages.length - 1;
	}

	/**
	 * 删除页面。至少保留一页，并修正 current 的指向
	 * @param index 页面索引
	 */
	deletePage(index: number) {
		if (!this.isValidIndex(index) || this.state.pages.length <= 1) {
			return;
		}
		const pages = this.state.pages.filter((_, itemIndex) => itemIndex !== index);
		const current = this.state.current;
		// 删的是当前页前面的页，当前页下标要跟着前移；删的是当前页，落在原来的位置上
		const nextCurrent = index < current ? current - 1 : Math.min(current, pages.length - 1);
		this.state = { ...this.state, pages, current: nextCurrent };
		this.emit();
	}

	/** 获取所有页面 */
	getPages() {
		return this.state.pages;
	}

	/** 获取当前页面 */
	getCurrentPage() {
		return this.currentPage;
	}

	/**
	 * 用外部数据整体替换页面列表（读文件、撤销恢复）。
	 * revision 自增，画布据此强制重载，且不会把旧画布内容写回 store。
	 */
	replacePages(pages: PageInfo[], current = 0) {
		const nextPages = pages.length > 0 ? pages : [createPage({ pageName: "页面 1" })];
		const nextCurrent =
			Number.isInteger(current) && current >= 0 && current < nextPages.length ? current : 0;
		this.state = {
			pages: nextPages,
			current: nextCurrent,
			revision: this.state.revision + 1,
		};
		this.emit();
	}

	/** 当前页面添加元素 */
	addElementToCurrentPage(element: ElementInfo) {
		this.setElementsOfCurrentPage([...this.currentPage.elements, element]);
	}

	/** 批量添加当前页面元素 */
	batchAddElementsToCurrentPage(elements: ElementInfo[]) {
		this.setElementsOfCurrentPage([...this.currentPage.elements, ...elements]);
	}

	/** 清空当前页面元素 */
	clearCurrentPageElements() {
		this.setElementsOfCurrentPage([]);
	}

	/** 删除当前页面元素 */
	deleteElementFromCurrentPage(id: string) {
		this.setElementsOfCurrentPage(
			this.currentPage.elements.filter((element) => element.id !== id),
		);
	}

	/** 批量删除当前页面元素 */
	batchDeleteElementsFromCurrentPage(ids: string[]) {
		const removed = new Set(ids);
		this.setElementsOfCurrentPage(
			this.currentPage.elements.filter((element) => !removed.has(element.id)),
		);
	}

	/**
	 * 更新当前页面元素
	 * @param element 更新后的元素信息
	 */
	updateElementInCurrentPage(element: ElementInfo) {
		this.setElementsOfCurrentPage(
			this.currentPage.elements.map((item) => (item.id === element.id ? element : item)),
		);
	}

	/** 批量更新当前页面元素 */
	batchUpdateElementsInCurrentPage(elements: ElementInfo[]) {
		const byId = new Map<string, ElementInfo>();
		for (const element of elements) {
			byId.set(element.id, element);
		}
		this.setElementsOfCurrentPage(this.currentPage.elements.map((item) => byId.get(item.id) ?? item));
	}

	/**
	 * 更新当前页的样式（目前只有背景填充）。
	 * 这里要通知订阅方：属性面板得把新的色值显示出来。
	 * 不会触发画布重载 —— revision 没变，use-page 的 syncPage 会直接返回。
	 */
	updateCurrentPageStyle(style: PageStyle) {
		this.updateCurrentPage({ ...this.currentPage, style });
		this.emit();
	}

	/** 元素集合的唯一写入口：统一改成不可变更新，避免多处直接改数组 */
	private setElementsOfCurrentPage(elements: ElementInfo[]) {
		this.updateCurrentPage({ ...this.currentPage, elements });
	}

	/** 参考线变了要通知订阅方（覆盖层要重画），但不触发画布重载 */
	setCurrentPageGuides(guides: PageGuide[]) {
		this.updateCurrentPage({ ...this.currentPage, guides });
		this.emit();
	}
}

export const pageStore = new PageStore();
