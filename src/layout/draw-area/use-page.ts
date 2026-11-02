import { useEffect } from "react";
import * as fabric from "fabric";
import { baseHeight, baseWidth } from "@/base";
import { toast } from "@/components/ui/toast";
import { assignProps, createElementFromInfo, toFabricPaint } from "@/lib/element-registry";
import { getReportPalette } from "@/lib/theme-tokens";
import { elementObjectMap, historyStore, pageStore, type PageInfo } from "@/store";

/**
 * 多页切换：让画布跟上 pageStore。
 * store 是唯一真值，这里只做「读 store → 重画元素层」，不需要回写。
 */
export function usePage(
	canvas: fabric.Canvas | null,
	page: fabric.Rect | null,
	cancelDrag: () => void,
) {
	useEffect(() => {
		if (!canvas || !page) {
			return;
		}
		return setup(canvas, page);
	}, [canvas, page, cancelDrag]);

	/**
	 * 订阅 pageStore 并完成首次装载，返回卸载函数。
	 * 单独写成函数是为了让内层函数声明里的 canvas / page 保持非空类型 ——
	 * TS 不会把参数的类型收窄带进内层函数。
	 */
	function setup(canvas: fabric.Canvas, page: fabric.Rect) {
		/** 画布当前装载的是哪一页；null 表示还没装载过 */
		let loadedPageId: string | null = null;
		/** 画布当前装载的数据版本，用于识别「整体替换」（撤销恢复、打开文件） */
		let loadedRevision = -1;

		/** 清空画布上的元素（白页保留），再按目标页面的数据重建 */
		function loadPage(pageInfo: PageInfo) {
			for (const object of [...canvas.getObjects()]) {
				if (object === page) {
					continue;
				}
				elementObjectMap.deleteByObject(object);
				canvas.remove(object);
			}
			canvas.discardActiveObject();

			// 每页可以有自己的背景，切页/撤销重载时一起换掉
			assignProps(page, {
				fill:
					toFabricPaint(pageInfo.style?.fill, { width: baseWidth, height: baseHeight }) ??
					getReportPalette().pageFill,
			});

			const missingTypes = new Set<string>();
			for (const info of pageInfo.elements) {
				const object = createElementFromInfo(info);
				if (!object) {
					missingTypes.add(info.elementType);
					continue;
				}
				canvas.add(object);
			}
			canvas.requestRenderAll();

			if (missingTypes.size > 0) {
				toast.add({
					title: "部分元素无法还原",
					type: "warning",
					description: `未注册的元素类型：${[...missingTypes].join("、")}`,
				});
			}
		}

		/**
		 * 让画布跟上 pageStore。
		 * store 是唯一真值：所有写操作（创建/变换/删除/锁定/层级/对齐）都即时回写，
		 * 画布不会比 store 新，所以这里只做「读 store → 重画元素层」，不需要回写。
		 */
		function syncPage() {
			// 切页/恢复历史时如果正在拖拽绘制，先取消，避免预览对象悬在半空
			cancelDrag();

			const state = pageStore.state;
			const pageInfo = pageStore.currentPage;
			// 换页
			const pageChanged = pageInfo.pageId !== loadedPageId;
			// 整体替换（撤销恢复、打开文件）：页面 id 可能没变，靠 revision 兜住
			const dataReplaced = state.revision !== loadedRevision;

			if (!pageChanged && !dataReplaced) {
				return;
			}

			loadPage(pageInfo);
			loadedPageId = pageInfo.pageId;
			loadedRevision = state.revision;
		}

		const unsubscribePage = pageStore.subscribe(syncPage);
		// 首次装载：store 里可能已经有数据（比如刚打开过文件）
		syncPage();
		// 以装载完的状态作为撤销栈的起点
		historyStore.reset();

		return () => {
			unsubscribePage();
		};
	}
}
