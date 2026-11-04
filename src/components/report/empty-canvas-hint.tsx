import { useState, useSyncExternalStore } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startDemo } from "@/lib/demo/runner";
import { pageStore, useDemoState } from "@/store";

const subscribe = (listener: () => void) => pageStore.subscribe(listener);
const getSnapshot = () => pageStore.currentPage;

/**
 * 空画布提示。
 *
 * 只在"当前页一个元素都没有"时出现，所以不需要额外记状态：
 * 用户放第一个元素（或跑一次示例）它自己就消失。
 * 关闭只在本会话内有效 —— 不做持久化，避免在首选项里再加一个字段。
 */
export function EmptyCanvasHint() {
	const page = useSyncExternalStore(subscribe, getSnapshot);
	const demo = useDemoState();
	const [dismissed, setDismissed] = useState(false);

	// 演示期间不显示：示例第一步会新开一页（此时必然是空的），
	// 提示卡会盖在正在生成的画面上
	if (dismissed || demo.running || !page || page.elements.length > 0) {
		return null;
	}

	return (
		<div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
			<div className="pointer-events-auto flex w-[320px] flex-col gap-3 rounded-xl border border-border bg-background/95 p-5 shadow-lg backdrop-blur">
				<div className="flex flex-col gap-1">
					<p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
						<Sparkles className="size-4 text-primary" />
						这一页还是空的
					</p>
					<p className="text-xs leading-relaxed text-muted-foreground">
						从左侧工具栏拖元素进来，或者先看一份做好的示例。
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button
						type="button"
						size="sm"
						onClick={() => void startDemo()}
						className="flex-1"
					>
						看看示例
					</Button>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						onClick={() => setDismissed(true)}
						className="text-muted-foreground"
					>
						我会用
					</Button>
				</div>
				<p className="text-xs text-muted-foreground/80">
					示例会新开一页，不会覆盖当前页的内容
				</p>
			</div>
		</div>
	);
}
