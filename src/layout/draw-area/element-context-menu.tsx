import {
	ChevronDown,
	ChevronUp,
	ChevronsDown,
	ChevronsUp,
	ClipboardPaste,
	Copy,
	Crop,
	Lock,
	Trash2,
	Unlock,
} from "lucide-react";
import {
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
} from "@/components/ui/context-menu";

/** 层叠顺序的四个方向 */
export type LayerDirection = "forward" | "backward" | "front" | "back";

/**
 * 菜单状态与操作回调。
 * 回调在画布那侧构造好（它需要 canvas 实例），这里只负责渲染，不碰 fabric。
 *
 * 两种形态：
 * - `element`：右键命中元素。多选时作用于整组，复制/删除都是批量的；
 *   锁定和层级仍然只对单个元素有意义。
 * - `canvas`：右键落在空白处。只给「粘贴」，而且只在剪贴板有内容时才弹。
 */
export type ElementContextMenuState =
	| {
			kind: "element";
			/** 菜单作用的元素 id（多选时是全部选中项，顺序即层叠顺序） */
			ids: string[];
			/** 是否只涉及一个元素 */
			single: boolean;
			locked: boolean;
			canForward: boolean;
			canBackward: boolean;
			/** 剪贴板里有没有内容（决定"粘贴"能不能点） */
			canPaste: boolean;
			/** 单选且是图片元素时才允许裁剪 */
			canCrop: boolean;
			onCopy: () => void;
			onPaste: () => void;
			onCrop: () => void;
			onDelete: () => void;
			onToggleLock: () => void;
			onMove: (direction: LayerDirection) => void;
	  }
	| {
			kind: "canvas";
			canPaste: boolean;
			onPaste: () => void;
	  };

interface ElementContextMenuProps {
	state: ElementContextMenuState | null;
}

/**
 * 元素右键菜单。
 * 空白处：剪贴板有内容时只给「粘贴」；没内容时根组件不会把状态置上，菜单不出现。
 */
export function ElementContextMenu({ state }: ElementContextMenuProps) {
	if (!state) {
		return null;
	}

	if (state.kind === "canvas") {
		return (
			<ContextMenuContent>
				<ContextMenuItem disabled={!state.canPaste} onClick={state.onPaste}>
					<ClipboardPaste />
					粘贴
					<ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
				</ContextMenuItem>
			</ContextMenuContent>
		);
	}

	return (
		<ContextMenuContent>
			<ContextMenuItem onClick={state.onCopy}>
				<Copy />
				复制
				<ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
			</ContextMenuItem>
			<ContextMenuItem disabled={!state.canPaste} onClick={state.onPaste}>
				<ClipboardPaste />
				粘贴
				<ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
			</ContextMenuItem>
			{state.canCrop && (
				<ContextMenuItem onClick={state.onCrop}>
					<Crop />
					裁剪
				</ContextMenuItem>
			)}

			<ContextMenuSeparator />

			<ContextMenuItem variant="destructive" onClick={state.onDelete}>
				<Trash2 />
				删除
				<ContextMenuShortcut>Del</ContextMenuShortcut>
			</ContextMenuItem>

			{/* 锁定与层级只对单个元素有意义，多选时不显示，免得以为能批量改 */}
			{state.single && (
				<>
					<ContextMenuSeparator />

					<ContextMenuItem onClick={state.onToggleLock}>
						{state.locked ? <Unlock /> : <Lock />}
						{state.locked ? "解锁" : "锁定"}
					</ContextMenuItem>

					<ContextMenuSeparator />

					<ContextMenuItem
						disabled={!state.canForward}
						onClick={() => state.onMove("forward")}
					>
						<ChevronUp />
						上一层
					</ContextMenuItem>
					<ContextMenuItem
						disabled={!state.canBackward}
						onClick={() => state.onMove("backward")}
					>
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
				</>
			)}
		</ContextMenuContent>
	);
}
