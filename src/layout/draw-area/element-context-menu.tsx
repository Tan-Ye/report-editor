import {
	ChevronDown,
	ChevronUp,
	ChevronsDown,
	ChevronsUp,
	Lock,
	Trash2,
	Unlock,
} from "lucide-react";
import {
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
} from "@/components/ui/context-menu";
import type { ElementInfo } from "@/store";

/** 层叠顺序的四个方向 */
export type LayerDirection = "forward" | "backward" | "front" | "back";

/**
 * 菜单状态与操作回调。
 * 回调在画布那侧构造好（它需要 canvas 实例），这里只负责渲染，不碰 fabric。
 */
export interface ElementContextMenuState {
	element: ElementInfo;
	locked: boolean;
	canForward: boolean;
	canBackward: boolean;
	onDelete: () => void;
	onToggleLock: () => void;
	onMove: (direction: LayerDirection) => void;
}

interface ElementContextMenuProps {
	state: ElementContextMenuState | null;
}

/**
 * 元素右键菜单。
 * 没有命中元素时直接返回 null —— 右键空白处不会弹任何东西。
 */
export function ElementContextMenu({ state }: ElementContextMenuProps) {
	if (!state) {
		return null;
	}

	return (
		<ContextMenuContent>
			<ContextMenuItem variant="destructive" onClick={state.onDelete}>
				<Trash2 />
				删除
			</ContextMenuItem>

			<ContextMenuSeparator />

			<ContextMenuItem onClick={state.onToggleLock}>
				{state.locked ? <Unlock /> : <Lock />}
				{state.locked ? "解锁" : "锁定"}
			</ContextMenuItem>

			<ContextMenuSeparator />

			<ContextMenuItem disabled={!state.canForward} onClick={() => state.onMove("forward")}>
				<ChevronUp />
				上一层
			</ContextMenuItem>
			<ContextMenuItem disabled={!state.canBackward} onClick={() => state.onMove("backward")}>
				<ChevronDown />
				下一层
			</ContextMenuItem>
			<ContextMenuItem disabled={!state.canForward} onClick={() => state.onMove("front")}>
				<ChevronsUp />
				最顶层
			</ContextMenuItem>
			<ContextMenuItem disabled={!state.canBackward} onClick={() => state.onMove("back")}>
				<ChevronsDown />
				最下层
			</ContextMenuItem>
		</ContextMenuContent>
	);
}
