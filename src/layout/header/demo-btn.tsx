import { Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startDemo, stopDemo } from "@/lib/demo/runner";
import { useDemoState } from "@/store";

/**
 * 「示例」按钮：常显。
 *
 * 演示进行中它变成「停止」——期间画布是锁着的，用户唯一的操作入口就是这里，
 * 所以按钮必须一直在显眼位置。
 */
export function DemoBtn() {
	const demo = useDemoState();

	if (demo.running) {
		return (
			<Button
				type="button"
				variant="secondary"
				size="sm"
				className="gap-1.5 text-primary"
				title="停止演示（已画的部分会保留，可撤销）"
				onClick={stopDemo}
			>
				<Square className="size-3.5" />
				停止示例
			</Button>
		);
	}

	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			className="gap-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
			title="一步一步生成一页示例，看看能做出什么效果"
			onClick={() => void startDemo()}
		>
			<Sparkles className="size-4" />
			示例
		</Button>
	);
}
