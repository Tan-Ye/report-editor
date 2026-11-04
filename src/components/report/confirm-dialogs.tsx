import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

interface ReplaceConfirmDialogProps {
	open: boolean;
	title: string;
	/** 写清楚"要打开什么、会替换掉什么" */
	description: ReactNode;
	/** 覆盖当前窗口的内容 */
	onOverwrite: () => void;
	/** 另开窗口（当前窗口不动） */
	onNewWindow: () => void;
	onCancel: () => void;
}

/**
 * 「打开新内容要替换当前文档」的三选一。
 *
 * 草稿箱和模板列表共用：两者都是"打开一份内容"，而当前窗口可能正好有没保存的改动，
 * 也可能已经有别的窗口在看同一份东西 —— 所以给"覆盖当前 / 新窗口 / 取消"三条路，
 * 而不是替用户决定。
 */
export function ReplaceConfirmDialog({
	open,
	title,
	description,
	onOverwrite,
	onNewWindow,
	onCancel,
}: ReplaceConfirmDialogProps) {
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					onCancel();
				}
			}}
		>
			<DialogContent className="w-96">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				<DialogFooter>
					<Button type="button" variant="ghost" onClick={onCancel}>
						取消
					</Button>
					<Button type="button" variant="outline" onClick={onNewWindow}>
						在新窗口打开
					</Button>
					<Button type="button" onClick={onOverwrite}>
						覆盖当前报告
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

interface DeleteConfirmDialogProps {
	open: boolean;
	title: string;
	description: ReactNode;
	/** 确认按钮的文案，默认「删除」 */
	confirmLabel?: string;
	onConfirm: () => void;
	onCancel: () => void;
}

/** 不可恢复的磁盘删除前再问一次（草稿、模板共用） */
export function DeleteConfirmDialog({
	open,
	title,
	description,
	confirmLabel = "删除",
	onConfirm,
	onCancel,
}: DeleteConfirmDialogProps) {
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					onCancel();
				}
			}}
		>
			<DialogContent className="w-96">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				<DialogFooter>
					<Button type="button" variant="ghost" onClick={onCancel}>
						取消
					</Button>
					<Button type="button" variant="destructive" onClick={onConfirm}>
						{confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
