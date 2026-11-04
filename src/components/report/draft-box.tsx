import { useState } from "react";
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
import { toast } from "@/components/ui/toast";
import { DeleteConfirmDialog, ReplaceConfirmDialog } from "./confirm-dialogs";
import { discardDraft, type DraftEntry } from "@/lib/report/service/library";
import { openDraft, openDraftInNewWindow } from "@/lib/report/service";
import { currentWindowLabel } from "@/lib/report/service/session";
import { cn, formatRelativeTime } from "@/lib/utils";
import { reportStore, saveStateStore } from "@/store";

/**
 * 草稿箱的两块 UI 放在同一个文件：
 * - `DraftRecoveryDialog`：启动时发现孤儿草稿，问「全部恢复 / 全部丢弃 / 稍后」
 * - `DraftList`：打开抽屉里的「未保存的内容」一节
 *
 * 它们读同一份 `DraftEntry`、做同一类动作，拆成两个文件只会多一次跳转。
 */

/** 启动时的「发现 N 份未保存的内容」 */
interface DraftRecoveryDialogProps {
	drafts: DraftEntry[];
	/** 全部恢复 */
	onRestore: () => void;
	/** 全部丢弃（永久删除） */
	onDiscard: () => void;
	/** 稍后处理：关掉提示，草稿还留在磁盘上 */
	onDismiss: () => void;
}

/**
 * 启动时扫出来的孤儿草稿通常来自崩溃、强制关机或异常退出 ——
 * `data/` 里没有对应的正式报告，不给入口的话只能一直烂在 cache 里。
 *
 * 「全部丢弃」是不可恢复的磁盘删除，所以在同一个对话框里再问一次。
 */
export function DraftRecoveryDialog({
	drafts,
	onRestore,
	onDiscard,
	onDismiss,
}: DraftRecoveryDialogProps) {
	/** 点过「全部丢弃」之后切成确认文案 */
	const [confirmingDiscard, setConfirmingDiscard] = useState(false);

	return (
		<Dialog
			open
			onOpenChange={(next) => {
				if (!next) {
					onDismiss();
				}
			}}
		>
			<DialogContent showCloseButton={false} className="w-[28rem]">
				<DialogHeader>
					<DialogTitle>发现 {drafts.length} 份未保存的内容</DialogTitle>
					<DialogDescription>
						上次编辑这些内容后没有保存就退出了。可以恢复出来继续编辑，也可以直接丢弃。
					</DialogDescription>
				</DialogHeader>

				<ul className="thin-scrollbar max-h-60 overflow-y-auto rounded-lg border border-border/70">
					{drafts.map((draft) => (
						<li
							key={`${draft.root}-${draft.folder}`}
							className="flex flex-col gap-0.5 border-b border-border/60 px-2.5 py-2 last:border-b-0"
						>
							<span className="truncate text-sm font-medium text-foreground">
								{draft.reportName || "未命名报告"}
							</span>
							<span className="truncate text-xs text-muted-foreground">
								{formatRelativeTime(draft.updatedAt)}
								{draft.hasSavedCopy ? " · 有已保存版本" : ""}
							</span>
						</li>
					))}
				</ul>

				{confirmingDiscard && (
					<p className="text-xs text-destructive">
						确定要丢弃这 {drafts.length} 份内容吗？文件会从磁盘删除，无法撤销。
					</p>
				)}

				<DialogFooter>
					{confirmingDiscard ? (
						<>
							<Button type="button" variant="ghost" onClick={() => setConfirmingDiscard(false)}>
								取消
							</Button>
							<Button type="button" variant="destructive" onClick={onDiscard}>
								确定丢弃
							</Button>
						</>
					) : (
						<>
							<Button type="button" variant="ghost" onClick={onDismiss}>
								稍后
							</Button>
							<Button
								type="button"
								variant="outline"
								onClick={() => setConfirmingDiscard(true)}
							>
								全部丢弃
							</Button>
							<Button type="button" onClick={onRestore}>
								全部恢复
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** 打开抽屉里的「未保存的内容」一节 */
interface DraftListProps {
	drafts: DraftEntry[];
	/** reportId → 占用它的窗口标签（listClaims 的结果） */
	claims: Record<string, string>;
	/** 当前窗口正在编辑的报告 id：同一份不让从这里再打开一次 */
	currentReportId: string;
	/** 数据目录的显示名 */
	rootLabel: (root: string) => string;
	/** 丢弃之后让外层重新扫一遍 */
	onChanged: () => void;
	/** 打开之后收起抽屉 */
	onOpen: () => void;
}

interface EntryState {
	disabled: boolean;
	/** 行内小标签：当前窗口 / 已在其它窗口打开 / 有已保存版本 */
	badge: string;
	/** 标签的样式：占用类的用主色，纯说明的用弱化色 */
	tone: "primary" | "muted";
	/** 禁用的原因，挂在行上做 tooltip */
	reason: string;
}

function describeEntry(
	draft: DraftEntry,
	claims: Record<string, string>,
	currentReportId: string,
): EntryState {
	if (draft.reportId === currentReportId) {
		return {
			disabled: true,
			badge: "当前窗口",
			tone: "primary",
			reason: "就是当前窗口正在编辑的内容",
		};
	}
	const owner = claims[draft.reportId];
	if (owner && owner !== currentWindowLabel()) {
		return {
			disabled: true,
			badge: "已在其它窗口打开",
			tone: "primary",
			reason: "这份内容已在另一个窗口打开",
		};
	}
	if (draft.hasSavedCopy) {
		return { disabled: false, badge: "有已保存版本", tone: "muted", reason: "" };
	}
	return { disabled: false, badge: "", tone: "muted", reason: "" };
}

/**
 * 每一项是一个草稿目录（`cache/<报告名>-<id>`）。打开 = 把草稿内容读进当前窗口，
 * 它和正式报告是同一份文档（同一个 reportId），差别只在还没落进 `data/`。
 *
 * 已经被别的窗口占着的内容不能点：同一份草稿被两个窗口同时编辑，
 * 谁后保存谁覆盖。占用登记在 Rust 侧（report-session），这里只负责显示。
 */
export function DraftList({
	drafts,
	claims,
	currentReportId,
	rootLabel,
	onChanged,
	onOpen,
}: DraftListProps) {
	/** 待确认「覆盖当前报告 / 新窗口打开」的目标 */
	const [pendingOpen, setPendingOpen] = useState<DraftEntry | null>(null);
	/** 待确认删除的目标 */
	const [pendingDiscard, setPendingDiscard] = useState<DraftEntry | null>(null);

	const openInCurrent = (draft: DraftEntry) => {
		// 有未保存的改动时不敢直接覆盖，先给三条路选
		if (saveStateStore.isDirty()) {
			setPendingOpen(draft);
			return;
		}
		void openDraft(draft.root, draft.folder).then((ok) => {
			if (ok) {
				onOpen();
			}
		});
	};

	const openInWindow = (draft: DraftEntry) => {
		void openDraftInNewWindow(draft).then((ok) => {
			if (ok) {
				onOpen();
			}
		});
	};

	const confirmOverwrite = () => {
		const draft = pendingOpen;
		setPendingOpen(null);
		if (!draft) {
			return;
		}
		void openDraft(draft.root, draft.folder).then((ok) => {
			if (ok) {
				onOpen();
			}
		});
	};

	const confirmNewWindow = () => {
		const draft = pendingOpen;
		setPendingOpen(null);
		if (draft) {
			openInWindow(draft);
		}
	};

	const confirmDiscard = async () => {
		const draft = pendingDiscard;
		setPendingDiscard(null);
		if (!draft) {
			return;
		}
		await discardDraft(draft.root, draft.folder);
		toast.add({ title: `已丢弃「${draft.reportName || "未命名报告"}」`, type: "info" });
		onChanged();
	};

	return (
		<>
			{drafts.map((draft) => {
				const state = describeEntry(draft, claims, currentReportId);
				return (
					<div
						key={`${draft.root}-${draft.folder}`}
						title={state.disabled ? state.reason : undefined}
						className="flex items-center gap-1 rounded-lg border border-transparent pr-1 transition-colors hover:border-border hover:bg-accent"
					>
						<button
							type="button"
							disabled={state.disabled}
							title={state.disabled ? undefined : "打开并替换当前窗口的内容"}
							onClick={() => openInCurrent(draft)}
							className="flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
						>
							<span className="flex min-w-0 items-center gap-1.5">
								<span className="truncate text-sm font-medium text-foreground">
									{draft.reportName || "未命名报告"}
								</span>
								{state.badge && (
									<span
										className={cn(
											"shrink-0 rounded px-1 py-0.5 text-xs",
											state.tone === "primary"
												? "bg-primary/10 text-primary"
												: "bg-muted text-muted-foreground",
										)}
									>
										{state.badge}
									</span>
								)}
							</span>
							<span className="truncate text-xs text-muted-foreground">
								{formatRelativeTime(draft.updatedAt)} · {rootLabel(draft.root)}
							</span>
						</button>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label="在新窗口打开"
							title="在新窗口打开"
							disabled={state.disabled}
							onClick={() => openInWindow(draft)}
							className="shrink-0 text-muted-foreground hover:text-foreground"
						>
							<ExternalLink className="size-3" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label="丢弃"
							title="丢弃这份未保存的内容"
							disabled={state.disabled}
							onClick={() => setPendingDiscard(draft)}
							className="shrink-0 text-muted-foreground hover:text-destructive"
						>
							<Trash2 className="size-3" />
						</Button>
					</div>
				);
			})}

			<ReplaceConfirmDialog
				open={pendingOpen !== null}
				title="打开未保存的内容"
				description={
					<>
						「{pendingOpen?.reportName || "未命名报告"}」会替换当前报告「
						{reportStore.state.reportName || "未命名报告"}
						」。当前报告还有未保存的改动，替换后会丢失。
					</>
				}
				onOverwrite={confirmOverwrite}
				onNewWindow={confirmNewWindow}
				onCancel={() => setPendingOpen(null)}
			/>

			<DeleteConfirmDialog
				open={pendingDiscard !== null}
				title="丢弃这份未保存的内容？"
				description={
					<>
						「{pendingDiscard?.reportName || "未命名报告"}」的草稿会从磁盘删除，无法恢复。
						{pendingDiscard?.hasSavedCopy
							? "它已经保存过的版本不受影响。"
							: "这份内容还没有保存过正式版本。"}
					</>
				}
				confirmLabel="丢弃"
				onConfirm={() => void confirmDiscard()}
				onCancel={() => setPendingDiscard(null)}
			/>
		</>
	);
}
