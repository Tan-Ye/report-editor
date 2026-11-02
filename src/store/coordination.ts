import { selectionStore } from "./element";
import type { ElementInfo, SelectionState } from "./element";
import { pageStore } from "./page";
import type { PageInfo } from "./page";

/**
 * 协调处理数据变更时，元素与当前page之间的数据层级问题，相关操作都在这里处理。
 *
 * 选中状态的写入统一走这里；属性回写由画布侧负责（它才知道 fabric 对象的最新几何）。
 */
export class Coordination {
	/** 页面变更时清空选中；页面数据由 pageStore 自己按 index 取 */
	onPageChange(_page: PageInfo, index: number) {
		pageStore.setCurrentPage(index);
		selectionStore.clear();
	}

	/** 选中变化（含取消选中、多选） */
	onSelectionChange(state: SelectionState) {
		selectionStore.setSelection(state);
	}

	/** 添加元素时：新元素立即成为唯一选中项 */
	onElementAdd(element: ElementInfo) {
		selectionStore.setSelection({ ids: [element.id], primary: element, page: false });
		pageStore.addElementToCurrentPage(element);
	}

	/** 删除元素时 */
	onElementDelete(element: ElementInfo) {
		selectionStore.clear();
		pageStore.deleteElementFromCurrentPage(element.id);
	}

	/** 批量删除元素时 */
	onElementsDelete(ids: string[]) {
		selectionStore.clear();
		pageStore.batchDeleteElementsFromCurrentPage(ids);
	}
}

export const coordination = new Coordination();
