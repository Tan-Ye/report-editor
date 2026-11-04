import { useEffect, useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { DeleteConfirmDialog, ReplaceConfirmDialog } from "./confirm-dialogs";
import { removeTemplate, type TemplateEntry } from "@/lib/report/service/library";
import { openTemplate, openTemplateInNewWindow } from "@/lib/report/service";
import { formatRelativeTime } from "@/lib/utils";
import { reportStore, saveStateStore } from "@/store";

/**
 * 模板的两块 UI：
 * - `SaveTemplateDialog`：把当前报告存成模板（只问一个名字）
 * - `TemplateList`：打开抽屉里的「模板」一节
 */

/** 「保存为模板」的命名框 */
interface SaveTemplateDialogProps {
	open: boolean;
	/** 默认名称：当前报告名 */
	defaultName: string;
	/** 返回是否保存成功；成功才关对话框 */
	onSave: (name: string) => Promise<boolean>;
	onClose: () => void;
}

/**
 * 路径、id、媒体复制都由 `saveAsTemplate` 处理，这里只要一个名字。
 * 名字只是给人看的标签，重名也不会覆盖旧模板（各自有独立目录）。
 */
export function SaveTemplateDialog({
	open,
	defaultName,
	onSave,
	onClose,
}: SaveTemplateDialogProps) {
	const [name, setName] = useState(defaultName);
	const [saving, setSaving] = useState(false);

	// 每次打开都回到当前报告名：上一次输入的名字不该残留到下一次
	useEffect(() => {
		if (open) {
			setName(defaultName);
			setSaving(false);
		}
	}, [open, defaultName]);

	const handleSave = async () => {
		const trimmed = name.trim();
		if (!trimmed || saving) {
			return;
		}
		setSaving(true);
		try {
			if (await onSave(trimmed)) {
				onClose();
			}
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					onClose();
				}
			}}
		>
			<DialogContent showCloseButton={false} className="w-96">
				<DialogHeader>
					<DialogTitle>保存为模板</DialogTitle>
					<DialogDescription>
						当前报告的内容会存成模板，图片一起复制进模板目录，之后可以反复套用到新报告。
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="template-name">模板名称</Label>
					<Input
						id="template-name"
						value={name}
						placeholder="未命名模板"
						// 打开就能直接改名，不用先点一下输入框
						autoFocus
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								void handleSave();
							}
						}}
					/>
				</div>

				<DialogFooter>
					<Button type="button" variant="ghost" onClick={onClose}>
						取消
					</Button>
					<Button
						type="button"
						disabled={!name.trim() || saving}
						onClick={() => void handleSave()}
					>
						{saving ? "保存中…" : "保存"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** 抽屉里的「模板」列表 */
interface TemplateListProps {
	templates: TemplateEntry[];
	/** 数据目录的显示名 */
	rootLabel: (root: string) => string;
	/** 删除之后让外层重新扫一遍 */
	onChanged: () => void;
	/** 打开之后收起抽屉 */
	onOpen: () => void;
}

/**
 * 模板不是报告：打开它不会打开一份已有文档，而是**用模板内容新建一份报告**
 * （新的 reportId，见 openTemplate）。所以这里没有占用（claim）的概念 ——
 * 同一个模板可以在任意多个窗口里各开一份，互不影响。
 */
export function TemplateList({ templates, rootLabel, onChanged, onOpen }: TemplateListProps) {
	/** 待确认「覆盖当前报告 / 新窗口打开」的目标 */
	const [pendingOpen, setPendingOpen] = useState<TemplateEntry | null>(null);
	/** 待确认删除的目标 */
	const [pendingDelete, setPendingDelete] = useState<TemplateEntry | null>(null);

	const openInCurrent = (template: TemplateEntry) => {
		// 当前窗口有未保存的改动时，覆盖前先问一句
		if (saveStateStore.isDirty()) {
			setPendingOpen(template);
			return;
		}
		void openTemplate(template.root, template.folder).then((ok) => {
			if (ok) {
				onOpen();
			}
		});
	};

	const openInWindow = (template: TemplateEntry) => {
		void openTemplateInNewWindow(template).then((ok) => {
			if (ok) {
				onOpen();
			}
		});
	};

	const confirmOverwrite = () => {
		const template = pendingOpen;
		setPendingOpen(null);
		if (!template) {
			return;
		}
		void openTemplate(template.root, template.folder).then((ok) => {
			if (ok) {
				onOpen();
			}
		});
	};

	const confirmNewWindow = () => {
		const template = pendingOpen;
		setPendingOpen(null);
		if (template) {
			openInWindow(template);
		}
	};

	const confirmDelete = async () => {
		const template = pendingDelete;
		setPendingDelete(null);
		if (!template) {
			return;
		}
		await removeTemplate(template.root, template.folder);
		toast.add({ title: `已删除模板「${template.name}」`, type: "info" });
		onChanged();
	};

	return (
		<>
			{templates.map((template) => (
				<div
					key={`${template.root}-${template.folder}`}
					className="flex items-center gap-1 rounded-lg border border-transparent pr-1 transition-colors hover:border-border hover:bg-accent"
				>
					<button
						type="button"
						title="套用这个模板（会替换当前窗口的内容）"
						onClick={() => openInCurrent(template)}
						className="flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-2 text-left"
					>
						<span className="truncate text-sm font-medium text-foreground">{template.name}</span>
						<span className="truncate text-xs text-muted-foreground">
							{formatRelativeTime(template.updatedAt)} · {rootLabel(template.root)}
						</span>
					</button>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label="在新窗口新建"
						title="在新窗口新建"
						onClick={() => openInWindow(template)}
						className="shrink-0 text-muted-foreground hover:text-foreground"
					>
						<ExternalLink className="size-3" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label="删除模板"
						title="删除这个模板"
						onClick={() => setPendingDelete(template)}
						className="shrink-0 text-muted-foreground hover:text-destructive"
					>
						<Trash2 className="size-3" />
					</Button>
				</div>
			))}

			<ReplaceConfirmDialog
				open={pendingOpen !== null}
				title="套用模板"
				description={
					<>
						「{pendingOpen?.name || "未命名模板"}」会把当前窗口的报告「
						{reportStore.state.reportName || "未命名报告"}
						」换成一份新报告。当前报告还有未保存的改动，替换后会丢失。
					</>
				}
				onOverwrite={confirmOverwrite}
				onNewWindow={confirmNewWindow}
				onCancel={() => setPendingOpen(null)}
			/>

			<DeleteConfirmDialog
				open={pendingDelete !== null}
				title="删除这个模板？"
				description={
					<>
						「{pendingDelete?.name || "未命名模板"}」连同它的图片会从磁盘删除，无法恢复。
						用它套用出来的报告不受影响。
					</>
				}
				onConfirm={() => void confirmDelete()}
				onCancel={() => setPendingDelete(null)}
			/>
		</>
	);
}
