import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

interface CloseConfirmDialogProps {
	open: boolean;
	/** 保存成功后关闭窗口 */
	onSave: () => void;
	/** 放弃改动直接关闭 */
	onDiscard: () => void;
	/** 留在窗口里继续编辑 */
	onCancel: () => void;
}

/**
 * 关窗前的「有未保存内容」三选一。
 *
 * 用自定义 Dialog 而不是系统弹窗：Tauri 的 dialog 插件只有确认/取消两个按钮，
 * 这里需要「保存 / 不保存 / 取消」三条路。
 */
export function CloseConfirmDialog({
	open,
	onSave,
	onDiscard,
	onCancel,
}: CloseConfirmDialogProps) {
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					onCancel();
				}
			}}
		>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>有未保存的内容</DialogTitle>
					<DialogDescription>关闭窗口前要先保存这份报告吗？</DialogDescription>
				</DialogHeader>

				<DialogFooter>
					<Button type="button" variant="ghost" onClick={onCancel}>
						取消
					</Button>
					<Button type="button" variant="outline" onClick={onDiscard}>
						不保存
					</Button>
					<Button type="button" onClick={onSave}>
						保存并关闭
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
