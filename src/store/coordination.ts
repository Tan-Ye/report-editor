import { ElementInfo, activeElementStore } from "./element";
import { pageStore, PagesState, PageInfo } from "./page";
import { reportStore } from "./report";

/**
 * 协调处理数据变更时，元素与当前page之间的数据层级问题，相关操作都在这里处理
 */
export class Coordination {
	// 页面变更时，活动元素设为null，元素变更时，活动元素设是当前活动元素
	onPageChange(page: PageInfo, index: number) {
		pageStore.setCurrentPage(index);
		activeElementStore.setActiveElement(null);
		activeElementStore.notifyListeners();
	}

	// 选中元素更新时，对应page内的elements也要对应变更
	onElementUpdate(element: ElementInfo | null) {
		activeElementStore.setActiveElement(element);
		activeElementStore.notifyListeners();
		if (element) {
			pageStore.updateElementInCurrentPage(element);
		}
	}

	/**
	 * 添加元素时
	 */
	onElementAdd(element: ElementInfo) {
		activeElementStore.setActiveElement(element);
		activeElementStore.notifyListeners();
		pageStore.addElementToCurrentPage(element);
	}

	/**
	 * 删除元素时
	 */
	onElementDelete(element: ElementInfo) {
		activeElementStore.setActiveElement(null);
		activeElementStore.notifyListeners();
		pageStore.deleteElementFromCurrentPage(element.id);
	}

	/**
	 * 批量删除元素时
	 * @param ids 元素ID列表
	 */
	onElementsDelete(ids: string[]) {
		activeElementStore.setActiveElement(null);
		activeElementStore.notifyListeners();
		pageStore.batchDeleteElementsFromCurrentPage(ids);
	}
}
