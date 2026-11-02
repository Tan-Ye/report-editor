import { useEffect, useRef, useSyncExternalStore } from "react";
import { getCssColor } from "@/lib/theme-tokens";
import { viewportStore } from "@/store";

/** 刻度条厚度（CSS 像素） */
export const RULER_SIZE = 20;

/** 主刻度之间的最小屏幕间距：小于它就换更大的步长 */
const MIN_TICK_GAP = 60;

/** 可选步长（页面单位）。只放「整十整百」，避免出现 25、75 这种刻度 */
const TICK_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000];

/** 参考线的取整单位：位置永远是 10 的倍数 */
export const GUIDE_STEP = 10;

/** 颜色读一次缓存住：每帧 getComputedStyle 太贵 */
let tickColor: string | null = null;
let labelColor: string | null = null;
let borderColor: string | null = null;

const subscribeViewport = (onStoreChange: () => void) => viewportStore.subscribe(onStoreChange);
const getViewportSnapshot = () => viewportStore.getSnapshot();

/** 挑一个让刻度间距不小于阈值的步长 */
function chooseStep(scale: number): number {
	for (const step of TICK_STEPS) {
		if (step * scale >= MIN_TICK_GAP) {
			return step;
		}
	}
	return TICK_STEPS[TICK_STEPS.length - 1];
}

interface RulerProps {
	orientation: "horizontal" | "vertical";
	/** 在刻度条上按下：按 10 取整后回调 */
	onPick: (axis: "x" | "y", position: number) => void;
}

/**
 * 坐标刻度。
 *
 * 零点是绘制区域左上角（页面在场景里就是 0,0），屏幕位置 = tx + 值 × zoom。
 * 用 canvas 画而不是 DOM 节点：平移时每帧要重画几十个刻度，
 * 换成 DOM 会疯狂创建节点。
 */
export function Ruler({ orientation, onPick }: RulerProps) {
	const viewport = useSyncExternalStore(subscribeViewport, getViewportSnapshot);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const horizontal = orientation === "horizontal";

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || viewport.width === 0 || viewport.height === 0) {
			return;
		}

		tickColor ??= getCssColor("--muted-foreground", "#64748b");
		labelColor ??= getCssColor("--muted-foreground", "#64748b");
		borderColor ??= getCssColor("--border", "#e2e8f0");

		// 刻度条本身比画布短一个 RULER_SIZE（左上角让给了方块）
		const length = (horizontal ? viewport.width : viewport.height) - RULER_SIZE;
		if (length <= 0) {
			return;
		}
		const dpr = window.devicePixelRatio || 1;
		if (horizontal) {
			canvas.width = Math.max(1, Math.round(length * dpr));
			canvas.height = Math.max(1, Math.round(RULER_SIZE * dpr));
		} else {
			canvas.width = Math.max(1, Math.round(RULER_SIZE * dpr));
			canvas.height = Math.max(1, Math.round(length * dpr));
		}

		const context = canvas.getContext("2d");
		if (!context) {
			return;
		}
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		context.clearRect(0, 0, length, RULER_SIZE);

		const { scale } = viewport;
		// 场景 0 在刻度条上的位置
		const origin = horizontal ? viewport.tx : viewport.ty;
		// 左/上侧刻度条自身偏移了 RULER_SIZE，转成「轨道内坐标」
		const trackOrigin = origin - RULER_SIZE;
		const step = chooseStep(scale);
		const first = Math.ceil((0 - trackOrigin) / scale / step) * step;

		context.strokeStyle = tickColor ?? "#64748b";
		context.fillStyle = labelColor ?? "#64748b";
		context.lineWidth = 1;
		context.font = "10px ui-sans-serif, system-ui, sans-serif";
		context.textAlign = horizontal ? "left" : "center";
		context.textBaseline = horizontal ? "top" : "middle";

		for (let value = first; ; value += step) {
			const position = trackOrigin + value * scale;
			if (position > length) {
				break;
			}
			context.beginPath();
			if (horizontal) {
				context.moveTo(Math.round(position) + 0.5, RULER_SIZE - 5);
				context.lineTo(Math.round(position) + 0.5, RULER_SIZE);
				context.stroke();
				context.fillText(String(value), Math.round(position) + 3, 2);
			} else {
				context.moveTo(RULER_SIZE - 5, Math.round(position) + 0.5);
				context.lineTo(RULER_SIZE, Math.round(position) + 0.5);
				context.stroke();
				// 竖排刻度：把文字转 90° 画，否则 20px 宽塞不下三位数
				context.save();
				context.translate(10, Math.round(position) + 3);
				context.rotate(-Math.PI / 2);
				context.fillText(String(value), 0, 0);
				context.restore();
			}
		}

		// 刻度条与画布之间画一条分界线
		context.strokeStyle = borderColor ?? "#e2e8f0";
		context.beginPath();
		if (horizontal) {
			context.moveTo(0, RULER_SIZE - 0.5);
			context.lineTo(length, RULER_SIZE - 0.5);
		} else {
			context.moveTo(RULER_SIZE - 0.5, 0);
			context.lineTo(RULER_SIZE - 0.5, length);
		}
		context.stroke();
	}, [viewport, horizontal]);

	return (
		<canvas
			ref={canvasRef}
			role="presentation"
			aria-label={horizontal ? "水平刻度" : "垂直刻度"}
			onPointerDown={(event) => {
				// 用覆盖层（父元素）的矩形换算：刻度条自己往右下偏移了一个 RULER_SIZE
				const rect = event.currentTarget.parentElement?.getBoundingClientRect();
				if (!rect) {
					return;
				}
				const scene = viewportStore.toScene(event.clientX, event.clientY, rect);
				const raw = horizontal ? scene.x : scene.y;
				onPick(horizontal ? "x" : "y", Math.round(raw / GUIDE_STEP) * GUIDE_STEP);
			}}
			className={
				horizontal
					? "pointer-events-auto absolute left-5 right-0 top-0 cursor-row-resize"
					: "pointer-events-auto absolute bottom-0 left-0 top-5 w-5 cursor-col-resize"
			}
			style={
				horizontal
					? { height: RULER_SIZE, width: "calc(100% - 20px)" }
					: { width: RULER_SIZE, height: "calc(100% - 20px)" }
			}
		/>
	);
}
