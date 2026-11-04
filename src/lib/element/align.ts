/**
 * 对齐计算。
 * 全部是纯函数：只做包围盒运算，不碰 fabric，也不碰 UI。
 */

export type AlignDirection = "left" | "center-x" | "right" | "top" | "center-y" | "bottom";

export interface Bounds {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** 多个包围盒的并集；空数组返回 null */
export function unionBounds(bounds: Bounds[]): Bounds | null {
	if (bounds.length === 0) {
		return null;
	}

	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;

	for (const box of bounds) {
		left = Math.min(left, box.left);
		top = Math.min(top, box.top);
		right = Math.max(right, box.left + box.width);
		bottom = Math.max(bottom, box.top + box.height);
	}

	return { left, top, width: right - left, height: bottom - top };
}

/**
 * 把 box 对齐到 target 需要的位移。
 * 水平方向的对齐只返回 dx，垂直方向只返回 dy，没涉及的轴一律是 0。
 */
export function getAlignOffset(
	box: Bounds,
	target: Bounds,
	direction: AlignDirection,
): { dx: number; dy: number } {
	switch (direction) {
		case "left":
			return { dx: target.left - box.left, dy: 0 };
		case "center-x":
			return {
				dx: target.left + target.width / 2 - (box.left + box.width / 2),
				dy: 0,
			};
		case "right":
			return { dx: target.left + target.width - (box.left + box.width), dy: 0 };
		case "top":
			return { dx: 0, dy: target.top - box.top };
		case "center-y":
			return {
				dx: 0,
				dy: target.top + target.height / 2 - (box.top + box.height / 2),
			};
		case "bottom":
			return { dx: 0, dy: target.top + target.height - (box.top + box.height) };
	}

	return { dx: 0, dy: 0 };
}
