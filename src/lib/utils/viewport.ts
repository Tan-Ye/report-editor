interface ComputeViewportFitArgs {
	containerRect: DOMRect;
	/** 页面基准尺寸，页面在场景中的左上角是 (0, 0) */
	pageWidth: number;
	pageHeight: number;
	/** 单值表示四边等距；数组按 [上, 右, 下, 左] 顺序 */
	padding?: number | number[];
}

export interface ViewportFit {
	/** 视口缩放比例 */
	zoom: number;
	/** 页面左上角映射到的画布坐标 */
	offsetX: number;
	offsetY: number;
}

const normalizePadding = (padding: number | number[]): [number, number, number, number] => {
	if (Array.isArray(padding)) {
		const [top = 0, right = 0, bottom = 0, left = 0] = padding;
		return [top, right, bottom, left];
	}
	return [padding, padding, padding, padding];
};

/**
 * 计算「让页面适配画布」的视口变换。
 *
 * 缩放只作用在视口上，页面对象本身保持原始尺寸 ——
 * 这样元素坐标（场景坐标）与窗口大小完全无关，缩放、改窗口都不会让元素和白页错位。
 * 画布尺寸等于可视区，所以场景里的页面是居中摆放的，留出的边距就是可以放页面外元素的区域。
 */
export function computeViewportFit({
	containerRect,
	pageWidth,
	pageHeight,
	padding = 48,
}: ComputeViewportFitArgs): ViewportFit {
	const [paddingTop, paddingRight, paddingBottom, paddingLeft] = normalizePadding(padding);
	const availableWidth = Math.max(containerRect.width - paddingLeft - paddingRight, 1);
	const availableHeight = Math.max(containerRect.height - paddingTop - paddingBottom, 1);

	// 页面比可视区大就缩小，比可视区小就放大；给个下限避免容器塌成 0 时缩放算出 0
	const zoom = Math.max(Math.min(availableWidth / pageWidth, availableHeight / pageHeight), 0.05);

	return {
		zoom,
		offsetX: (containerRect.width - pageWidth * zoom) / 2,
		offsetY: (containerRect.height - pageHeight * zoom) / 2,
	};
}
