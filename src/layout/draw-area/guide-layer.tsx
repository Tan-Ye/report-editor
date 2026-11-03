import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { baseHeight, baseWidth } from "@/base";
import { cn } from "@/lib/utils";
import { historyStore, pageStore, snapStore, viewportStore } from "@/store";
import { GUIDE_STEP } from "./ruler";

const subscribePages = (onStoreChange: () => void) => pageStore.subscribe(onStoreChange);
const getPagesSnapshot = () => pageStore.state;
const subscribeSnap = (onStoreChange: () => void) => snapStore.subscribe(onStoreChange);
const getSnapSnapshot = () => snapStore.getSnapshot();
const subscribeViewport = (onStoreChange: () => void) => viewportStore.subscribe(onStoreChange);
const getViewportSnapshot = () => viewportStore.getSnapshot();

interface DragState {
	index: number;
	axis: "x" | "y";
	position: number;
}

/**
 * 参考线 + 吸附提示线。
 *
 * 参考线在场景坐标里存，渲染时换算成屏幕位置；拖动只改本地状态，
 * 松手才写 store 并记一步历史 —— 拖一次只应该产生一步撤销。
 */
export function GuideLayer() {
	const viewport = useSyncExternalStore(subscribeViewport, getViewportSnapshot);
	const pages = useSyncExternalStore(subscribePages, getPagesSnapshot);
	const snap = useSyncExternalStore(subscribeSnap, getSnapSnapshot);
	const guides = pages.pages[pages.current]?.guides ?? [];
	const [drag, setDrag] = useState<DragState | null>(null);
	/** 选中的参考线：只有选中后才能按 Delete 删 */
	const [selected, setSelected] = useState<number | null>(null);
	/** 松手要用最新值，state 在事件回调里可能是旧的 */
	const latestRef = useRef(0);

	/** 增删参考线后序号会错位，直接清掉选中 */
	useEffect(() => {
		setSelected(null);
	}, [guides.length]);

	/** 点别处取消选中（覆盖层本身不吃事件，所以只能挂在 window 上） */
	useEffect(() => {
		if (selected === null) {
			return;
		}
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as HTMLElement | null;
			if (target?.closest("[data-guide]")) {
				return;
			}
			setSelected(null);
		};
		window.addEventListener("pointerdown", handlePointerDown, true);
		return () => {
			window.removeEventListener("pointerdown", handlePointerDown, true);
		};
	}, [selected]);

	/** 选中参考线后按 Delete/Backspace 删除 */
	useEffect(() => {
		if (selected === null) {
			return;
		}
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Delete" && event.key !== "Backspace") {
				return;
			}
			// 正在输入框里打字时不抢删除键
			const active = document.activeElement;
			if (
				active instanceof HTMLInputElement ||
				active instanceof HTMLTextAreaElement ||
				(active instanceof HTMLElement && active.isContentEditable)
			) {
				return;
			}
			event.preventDefault();
			// 捕获阶段拦下，别让画布把选中的元素也一起删了
			event.stopPropagation();
			pageStore.setCurrentPageGuides(guides.filter((_, index) => index !== selected));
			historyStore.commit();
			setSelected(null);
		};
		window.addEventListener("keydown", handleKeyDown, true);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
		};
	}, [selected, guides]);

	const screenOf = (value: number, axis: "x" | "y") =>
		(axis === "x" ? viewport.tx : viewport.ty) + value * viewport.scale;

	const startDrag = (index: number, axis: "x" | "y") => (event: React.PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.stopPropagation();
		setSelected(index);
		const rect = event.currentTarget.parentElement?.getBoundingClientRect();
		if (!rect) {
			return;
		}
		const element = event.currentTarget;
		element.setPointerCapture(event.pointerId);

		const original = guides[index]?.position ?? 0;
		latestRef.current = original;
		setDrag({ index, axis, position: original });

		const move = (moveEvent: PointerEvent) => {
			const scene = viewportStore.toScene(moveEvent.clientX, moveEvent.clientY, rect);
			const raw = axis === "x" ? scene.x : scene.y;
			// 位置一律按 10 取整：参考线随便放会让页面显得歪
			latestRef.current = Math.round(raw / GUIDE_STEP) * GUIDE_STEP;
			setDrag({ index, axis, position: latestRef.current });
		};

		const finish = () => {
			element.removeEventListener("pointermove", move as unknown as EventListener);
			element.removeEventListener("pointerup", finish);
			element.removeEventListener("pointercancel", finish);
			setDrag(null);

			// 只是点了一下没拖动：保留选中，不记一步历史
			if (latestRef.current === original) {
				return;
			}

			const limit = axis === "x" ? baseWidth : baseHeight;
			const moved = latestRef.current >= 0 && latestRef.current <= limit;
			// 原地替换而不是「先过滤再 push」：后者会把被拖的线挪到数组末尾，
			// 序号一变，选中高亮就跑到别的参考线上去了
			const next = moved
				? guides.map((item, i) => (i === index ? { axis, position: latestRef.current } : item))
				: guides.filter((_, i) => i !== index);
			pageStore.setCurrentPageGuides(next);
			historyStore.commit();
		};

		element.addEventListener("pointermove", move as unknown as EventListener);
		element.addEventListener("pointerup", finish);
		element.addEventListener("pointercancel", finish);
	};

	return (
		<div className="pointer-events-none absolute inset-0">
			{guides.map((guide, index) => {
				const dragging = drag?.index === index;
				const isSelected = selected === index;
				const position = screenOf(dragging ? drag.position : guide.position, guide.axis);
				const vertical = guide.axis === "x";
				return (
					<div
						// 参考线没有 id，用方向 + 序号当 key；删除时列表会重排，但没有跨项状态
						key={`${guide.axis}-${index}`}
						role="presentation"
						// 点别处取消选中时靠它判断"点的是不是参考线"
						data-guide={index}
						aria-label="参考线（选中后按 Delete 删除）"
						onPointerDown={startDrag(index, guide.axis)}
						className="pointer-events-auto absolute"
						style={
							vertical
								? { left: position - 3, top: 0, bottom: 0, width: 7, cursor: "col-resize" }
								: { top: position - 3, left: 0, right: 0, height: 7, cursor: "row-resize" }
						}
					>
						<div
							className={
								vertical
									? cn(
											"absolute inset-y-0 left-1/2 w-px -translate-x-1/2",
											isSelected ? "w-0.5 bg-primary" : "bg-primary/60",
										)
									: cn(
											"absolute inset-x-0 top-1/2 h-px -translate-y-1/2",
											isSelected ? "h-0.5 bg-primary" : "bg-primary/60",
										)
							}
						/>
					</div>
				);
			})}

			{snap.x !== null && (
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-y-0 w-px border-l border-dashed border-destructive/70"
					// 动态值：吸附位置，随视口变化
					style={{ left: screenOf(snap.x, "x") }}
				/>
			)}
			{snap.y !== null && (
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-x-0 h-px border-t border-dashed border-destructive/70"
					style={{ top: screenOf(snap.y, "y") }}
				/>
			)}
		</div>
	);
}
