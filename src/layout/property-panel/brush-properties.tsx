import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { brushStore, type BrushCap } from "@/store";
import { cn } from "@/lib/utils";
import { ColorInput } from "./fill-editor";
import { NumberField } from "./number-field";

const subscribeBrush = (onStoreChange: () => void) => brushStore.subscribe(onStoreChange);
const getBrushSnapshot = () => brushStore.getSnapshot();

const CAP_OPTIONS: { value: BrushCap; label: string }[] = [
	{ value: "round", label: "圆头" },
	{ value: "butt", label: "方头" },
];

/**
 * 画笔设置。
 *
 * 只在画笔工具激活时显示 —— 这里调的是"下一笔用什么"，不是选中的元素属性；
 * 已经画下去的每一笔都各自带着当时的颜色和粗细（存在元素的 attrs 里）。
 */
export function BrushProperties() {
	const brush = useSyncExternalStore(subscribeBrush, getBrushSnapshot);

	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
					画笔
				</span>
				<span className="text-xs text-muted-foreground">按住拖动即可绘制</span>
			</div>

			<div className="flex flex-col gap-2">
				<h3 className="text-xs font-medium text-muted-foreground">颜色</h3>
				<div className="flex items-center gap-2">
					<ColorInput value={brush.color} onCommit={(color) => brushStore.setColor(color)} />
					<span className="text-xs tabular-nums text-muted-foreground">{brush.color}</span>
				</div>
			</div>

			<div className="flex flex-col gap-2">
				<h3 className="text-xs font-medium text-muted-foreground">粗细</h3>
				<div className="flex items-center gap-2">
					<NumberField
						label="线宽"
						value={brush.width}
						// 边敲边生效：改完粗细直接落笔，第一笔就得是新值
						onInput={(width) => brushStore.setWidth(width)}
						onCommit={(width) => brushStore.setWidth(width)}
					/>
					{/* 直观展示笔头粗细，比数字更容易判断 */}
					<span
						aria-hidden="true"
						className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border"
					>
						<span
							className={cn("bg-foreground", brush.cap === "round" ? "rounded-full" : "rounded-none")}
							style={{ width: brush.width, height: brush.width }}
						/>
					</span>
				</div>
			</div>

			<div className="flex flex-col gap-2">
				<h3 className="text-xs font-medium text-muted-foreground">笔头</h3>
				<div className="flex gap-1">
					{CAP_OPTIONS.map((option) => (
						<Button
							key={option.value}
							type="button"
							variant={brush.cap === option.value ? "secondary" : "ghost"}
							size="sm"
							onClick={() => brushStore.setCap(option.value)}
							className={cn(
								"flex-1 justify-center",
								brush.cap === option.value && "text-primary",
							)}
						>
							{option.label}
						</Button>
					))}
				</div>
			</div>
		</section>
	);
}
