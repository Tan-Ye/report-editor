import { useEffect } from "react";
import * as fabric from "fabric";
import { baseHeight, baseWidth } from "@/base";
import { elementObjectMap, pageStore, snapStore } from "@/store";

/**
 * 吸附阈值 = max(5 个场景单位, 8 个屏幕像素换算成的场景距离)。
 *
 * 只按场景单位算的话，在「适应窗口」（约 40%）下 5 个单位只有 2 个屏幕像素，
 * 鼠标根本放不进去，看起来就是「吸附没生效」。屏幕上给个下限才是手感正确的那一半：
 * 阈值本来就是「手能瞄多准」，跟缩放有关系；而吸附目标（顶点、参考线）仍然是场景坐标，
 * 不会因为缩放而漂移。
 */
const SNAP_UNITS = 5;
const MIN_SNAP_PIXELS = 8;

function snapTolerance(scale: number): number {
	return Math.max(SNAP_UNITS, MIN_SNAP_PIXELS / Math.max(scale, 0.01));
}

/**
 * 在候选坐标里找最近的一个。
 * 单个轴只取「最近的一个候选」——多个候选同时在范围内时也只跟一个走，
 * 不会左右横跳。
 */
function nearestDelta(
	values: number[],
	candidates: number[],
	threshold: number,
): { delta: number; target: number } | null {
	let best: { delta: number; target: number } | null = null;
	for (const value of values) {
		for (const candidate of candidates) {
			const delta = candidate - value;
			const distance = Math.abs(delta);
			if (distance > threshold) {
				continue;
			}
			if (!best || distance < Math.abs(best.delta)) {
				best = { delta, target: candidate };
			}
		}
	}
	return best;
}

/**
 * 顶点吸附。
 *
 * **不抖的关键**：每次都从「指针算出来的原始位置」求增量，再把增量加到 left/top 上。
 * fabric 每帧都会按指针重算 left/top，所以不存在「基于已吸附位置再吸附」的累积误差 ——
 * 那才是元素弹来弹去的根因。
 */
export function useSnapping(canvas: fabric.Canvas | null) {
	useEffect(() => {
		if (!canvas) {
			return;
		}
		return setup(canvas);
	}, [canvas]);

	function setup(canvas: fabric.Canvas) {
		/** 拖动开始时算一次候选，拖动过程中不再重算 */
		let candidatesX: number[] = [];
		let candidatesY: number[] = [];
		let dragged: fabric.FabricObject | null = null;

		function collect(target: fabric.FabricObject) {
			const xs = [0, baseWidth];
			const ys = [0, baseHeight];
			for (const object of canvas.getObjects()) {
				if (object === target || !elementObjectMap.getRef(object)) {
					continue;
				}
				for (const point of object.getCoords()) {
					xs.push(point.x);
					ys.push(point.y);
				}
			}
			for (const guide of pageStore.currentPage.guides ?? []) {
				if (guide.axis === "x") {
					xs.push(guide.position);
				} else {
					ys.push(guide.position);
				}
			}
			candidatesX = xs;
			candidatesY = ys;
		}

		function handleBeforeTransform(event: { transform?: fabric.Transform }) {
			snapStore.clear();
			// 多选时 left/top 是相对选区的，吸附语义不同，直接不启用
			dragged = canvas.getActiveObjects().length === 1 ? (event.transform?.target ?? null) : null;
			if (dragged) {
				collect(dragged);
			}
		}

		function handleMoving(event: { target?: fabric.FabricObject }) {
			const target = event.target;
			if (!target || target !== dragged) {
				return;
			}

			// ⚠️ fabric 是在 fire(MOVING) 之后才调 setCoords 的，所以这里直接读 getCoords()
			// 拿到的是上一帧的坐标（还带着上一次的吸附偏移）。不先自己重算一次，
			// 吸附就会基于「已吸附的位置」再算增量 —— 正反馈，元素在参考线附近来回弹。
			target.setCoords();
			const corners = target.getCoords();
			// 阈值跟着缩放走：缩得越小，屏幕上留出的吸附窗口越大（场景单位）
			const tolerance = snapTolerance(canvas.getZoom());
			const deltaX = nearestDelta(
				corners.map((point) => point.x),
				candidatesX,
				tolerance,
			);
			const deltaY = nearestDelta(
				corners.map((point) => point.y),
				candidatesY,
				tolerance,
			);

			if (deltaX) {
				target.left += deltaX.delta;
			}
			if (deltaY) {
				target.top += deltaY.delta;
			}
			if (deltaX || deltaY) {
				target.setCoords();
			}
			snapStore.set({ x: deltaX?.target ?? null, y: deltaY?.target ?? null });
		}

		function handleReleased() {
			dragged = null;
			snapStore.clear();
		}

		canvas.on("before:transform", handleBeforeTransform);
		canvas.on("object:moving", handleMoving);
		canvas.on("mouse:up", handleReleased);
		canvas.on("object:modified", handleReleased);

		return () => {
			canvas.off("before:transform", handleBeforeTransform);
			canvas.off("object:moving", handleMoving);
			canvas.off("mouse:up", handleReleased);
			canvas.off("object:modified", handleReleased);
			snapStore.clear();
		};
	}
}
