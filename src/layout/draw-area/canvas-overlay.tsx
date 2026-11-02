import { baseHeight, baseWidth } from "@/base";
import { historyStore, pageStore, type PageGuide } from "@/store";
import { GuideLayer } from "./guide-layer";
import { GUIDE_STEP, Ruler } from "./ruler";

/**
 * 画布覆盖层：坐标刻度 + 参考线 + 吸附提示线。
 *
 * 整层 `pointer-events: none`，只有刻度条和参考线的热区吃事件，
 * 这样画布本身的选中/拖拽完全不受影响。
 */
export function CanvasOverlay() {
	const addGuide = (axis: "x" | "y", position: number) => {
		const limit = axis === "x" ? baseWidth : baseHeight;
		const clamped = Math.min(Math.max(position, 0), limit);
		const current: PageGuide[] = pageStore.currentPage.guides ?? [];

		// 同一位置同方向已经有参考线就不重复加
		if (current.some((guide) => guide.axis === axis && guide.position === clamped)) {
			return;
		}
		pageStore.setCurrentPageGuides([
			...current,
			{ axis, position: Math.round(clamped / GUIDE_STEP) * GUIDE_STEP },
		]);
		historyStore.commit();
	};

	return (
		<div className="pointer-events-none absolute inset-0 z-10">
			<GuideLayer />
			<Ruler orientation="horizontal" onPick={addGuide} />
			<Ruler orientation="vertical" onPick={addGuide} />
			{/* 左上角方块：两条刻度条的交接处，盖住它们的起点 */}
			<div className="pointer-events-auto absolute left-0 top-0 h-5 w-5 border-b border-r border-border bg-chrome" />
		</div>
	);
}
