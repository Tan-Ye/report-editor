import { ElementInfo } from "./element";

export type PagesState = {
	currentPage: PageInfo;
	pages: PageInfo[];
	current: number;
};

export type PageInfo = {
	pageName: string;
	pageId: string;
	elements: ElementInfo[];
};

const INIT_PAGE: PageInfo = {
	pageName: "",
	pageId: "",
	elements: [],
};

/**
 * 页面信息存储,单例模式
 * 用于存储当前选中的页面信息，包括页面名称、页面ID和元素列表
 */
class PageStore {
	state: PagesState;
	constructor() {
		this.state = {
			currentPage: { ...INIT_PAGE },
			pages: [{ ...INIT_PAGE }] as PageInfo[],
			current: 0,
		};
	}

	/**
	 *
	 * @param index 切换页面
	 */
	setCurrentPage(index: number) {
		this.state = { ...this.state, current: index, currentPage: this.state.pages[index] };
	}

	/**
	 * 更新当前页面
	 * @param page 更新后的页面信息
	 */
	updateCurrentPage(page: PageInfo) {
		this.state = { ...this.state, currentPage: page };
	}

	/**
	 * 添加页面
	 */
	addPage() {
		this.state.pages.push({ ...INIT_PAGE });
	}

	/**
	 * 删除页面
	 * @param index 页面索引
	 */
	deletePage(index: number) {
		this.state.pages.splice(index, 1);
	}

	/**
	 * 获取所有页面
	 */
	getPages() {
		return this.state.pages;
	}

	/**
	 * 获取当前页面
	 */
	getCurrentPage() {
		return this.state.currentPage;
	}

	/**
	 * 当前页面添加元素
	 */
	addElementToCurrentPage(element: ElementInfo) {
		this.state.currentPage.elements.push(element);
	}

	/**
	 * 批量添加当前页面元素
	 */
	batchAddElementsToCurrentPage(elements: ElementInfo[]) {
		this.state.currentPage.elements.push(...elements);
	}

	/**
	 * 清空当前页面元素
	 */
	clearCurrentPageElements() {
		this.state.currentPage.elements = [];
	}

	/**
	 * 删除当前页面元素
	 */
	deleteElementFromCurrentPage(id: string) {
		const index = this.state.currentPage.elements.findIndex((element) => element.id === id);
		if (index !== -1) {
			this.state.currentPage.elements.splice(index, 1);
		}
	}

	/**
	 * 批量删除当前页面元素
	 */
	batchDeleteElementsFromCurrentPage(ids: string[]) {
		this.state.currentPage.elements = this.state.currentPage.elements.filter(
			(element) => !ids.includes(element.id),
		);
	}

	/**
	 * 更新当前页面元素
	 * @param element 更新后的元素信息
	 */
	updateElementInCurrentPage(element: ElementInfo) {
		const index = this.state.currentPage.elements.findIndex((e) => e.id === element.id);
		if (index !== -1) {
			this.state.currentPage.elements[index] = element;
		}
	}

	/**
	 * 批量更新当前页面元素
	 */
	batchUpdateElementsInCurrentPage(elements: ElementInfo[]) {
		elements.forEach((element) => {
			this.updateElementInCurrentPage(element);
		});
	}
}

export const pageStore = new PageStore();
