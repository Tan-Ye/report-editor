import { useRef } from "react";
import { cn } from "@/lib/utils";

interface AngleDialProps {
	value: number;
	disabled?: boolean;
	/** 拖动中持续回调：只预览，不记历史 */
	onPreview: (angle: number) => void;
	/** 松手时回调一次：提交进历史 */
	onCommit: (angle: number) => void;
}

/** 0° 指向右，顺时针为正 —— 和 fabric 的 angle、渐变的 angle 同一套约定 */
function normalizeAngle(angle: number): number {
	const wrapped = angle % 360;
	return Math.round((wrapped < 0 ? wrapped + 360 : wrapped) * 10) / 10;
}

/**
 * 圆盘角度控件。
 *
 * 拖动过程中只走 onPreview —— 每移动一像素都记一步历史的话，撤销栈会被刷爆；
 * 松手时才 onCommit。指针捕获保证拖出圆盘也能继续调。
 *
 * 对齐要点：指针放在一个铺满圆盘的旋转层里，层内用 flex 居中，
 * 这样「线」的垂直中线和圆心严格重合；旋转发生在整层上，指针不会因为
 * 自身高度（2px）而偏出去半个像素。
 */
export function AngleDial({ value, disabled, onPreview, onCommit }: AngleDialProps) {
	const dialRef = useRef<HTMLDivElement | null>(null);
	const draggingRef = useRef(false);
	const latestRef = useRef(value);

	const angleFromPointer = (clientX: number, clientY: number) => {
		const rect = dialRef.current?.getBoundingClientRect();
		if (!rect) {
			return latestRef.current;
		}
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;
		return normalizeAngle(
			(Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI,
		);
	};

	const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (disabled) {
			return;
		}
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		draggingRef.current = true;
		latestRef.current = angleFromPointer(event.clientX, event.clientY);
		onPreview(latestRef.current);
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!draggingRef.current) {
			return;
		}
		latestRef.current = angleFromPointer(event.clientX, event.clientY);
		onPreview(latestRef.current);
	};

	const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!draggingRef.current) {
			return;
		}
		draggingRef.current = false;
		event.currentTarget.releasePointerCapture(event.pointerId);
		onCommit(latestRef.current);
	};

	return (
		<div
			ref={dialRef}
			role="presentation"
			aria-hidden="true"
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerUp}
			className={cn(
				"relative size-14 shrink-0 touch-none rounded-full border border-border bg-background",
				disabled ? "opacity-50" : "cursor-grab active:cursor-grabbing",
			)}
		>
			{/* 内侧参考圈 */}
			<span className="pointer-events-none absolute inset-1 rounded-full border border-border/50" />

			{/* 旋转层：铺满圆盘，绕自身中心转（就是圆心） */}
			<span
				className="pointer-events-none absolute inset-0"
				style={{ transform: `rotate(${value}deg)` }}
			>
				{/* 从圆心指向边缘：flex 保证线在垂直方向上严格居中 */}
				<span className="absolute left-1/2 top-1/2 flex w-[40%] -translate-y-1/2 items-center">
					<span className="h-px flex-1 bg-primary/60" />
					<span className="size-2 shrink-0 rounded-full bg-primary" />
				</span>
			</span>

			{/* 圆心：压在指针根部，遮住线的起点 */}
			<span className="pointer-events-none absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" />
		</div>
	);
}
