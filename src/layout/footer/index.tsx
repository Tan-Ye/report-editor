import { useSyncExternalStore } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_SCALE, MIN_SCALE, zoomStore } from "@/store";
import { AboutDialog } from "./about-dialog";

/**
 * 底部状态栏：右侧是画布缩放控制。
 * 比例直接读 zoomStore —— 适配比例由画布那侧算好回填，这里只负责显示与操作。
 */
export function Footer() {
	const { scale } = useSyncExternalStore(zoomStore.subscribe, zoomStore.getSnapshot);
	// store 里的比例可能有 0.30000000000000004 这种浮点尾巴，显示前取整
	const percent = Math.round(scale * 100);

	return (
		<footer className="flex h-8 shrink-0 items-center justify-end gap-0.5 border-t border-border bg-chrome px-3 text-xs text-muted-foreground">
			<div className="mr-auto flex items-center">
				<AboutDialog />
			</div>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				title="缩小"
				aria-label="缩小"
				disabled={scale <= MIN_SCALE}
				onClick={() => zoomStore.zoomOut()}
				className="text-muted-foreground hover:bg-accent hover:text-foreground"
			>
				<Minus />
			</Button>
			<button
				type="button"
				title="适应窗口"
				aria-label="适应窗口"
				onClick={() => zoomStore.fit()}
				className="min-w-14 rounded-md px-2 py-1 text-center tabular-nums transition-colors hover:bg-accent hover:text-foreground"
			>
				{percent}%
			</button>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				title="放大"
				aria-label="放大"
				disabled={scale >= MAX_SCALE}
				onClick={() => zoomStore.zoomIn()}
				className="text-muted-foreground hover:bg-accent hover:text-foreground"
			>
				<Plus />
			</Button>
		</footer>
	);
}
