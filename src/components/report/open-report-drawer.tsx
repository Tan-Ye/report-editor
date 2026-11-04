import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { FolderOpen, Plus, Star, Trash2 } from "lucide-react";
import { getIdentifier } from "@tauri-apps/api/app";
import { DraftList } from "./draft-box";
import { SaveTemplateDialog, TemplateList } from "./templates";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import {
	listDraftsInAllDirs,
	listTemplatesInAllDirs,
	type DraftEntry,
	type TemplateEntry,
} from "@/lib/report/service/library";
import {
	addDataDir,
	listReportsInAllDirs,
	moveCurrentReportTo,
	openReport,
	pickDataDirectory,
	removeDataDir,
	saveAsTemplate,
	setDefaultDataDir,
	type ReportSummary,
} from "@/lib/report/service";
import { currentWindowLabel, listClaims } from "@/lib/report/service/session";
import { isSamePath } from "@/lib/utils";
import { dataDirsStore, reportStore, saveStateStore } from "@/store";

const subscribeDirs = (onStoreChange: () => void) => dataDirsStore.subscribe(onStoreChange);
const getDirsSnapshot = () => dataDirsStore.getSnapshot();

function formatTime(updatedAt: number | null) {
	if (!updatedAt) {
		return "";
	}
	return new Date(updatedAt).toLocaleString();
}

/**
 * 目录的显示名：内置目录给个中文名，其它取最后一段路径。
 * 自定义目录的末段是应用标识目录（添加时自动套的那层），所以再往上取一级，
 * 不然几个目录会显示成同一个名字。
 */
function dirLabel(path: string, builtin: boolean, identifier: string): string {
	if (builtin) {
		return "应用数据目录";
	}
	const parts = path.split(/[\\/]/).filter(Boolean);
	const last = parts.pop() ?? path;
	if (identifier && last.toLowerCase() === identifier.toLowerCase() && parts.length > 0) {
		return parts[parts.length - 1] ?? last;
	}
	return last;
}

/**
 * 打开报告抽屉：扫描**所有数据目录**下的 report.json。
 * 不维护索引文件 —— 目录本身就是数据源，删了文件列表自然就少了。
 */
export function OpenReportDrawer() {
	const [open, setOpen] = useState(false);
	const [reports, setReports] = useState<ReportSummary[]>([]);
	/** 未保存的内容（cache 里的草稿），和正式报告一起列出来 */
	const [drafts, setDrafts] = useState<DraftEntry[]>([]);
	/** 模板：打开它等于用它的内容新建报告 */
	const [templates, setTemplates] = useState<TemplateEntry[]>([]);
	/** 「保存当前报告为模板」的命名框 */
	const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
	/** reportId → 占用它的窗口：已被打开的条目要标灰 */
	const [claims, setClaims] = useState<Record<string, string>>({});
	const [loading, setLoading] = useState(false);
	/** 待确认的"设为默认"目标目录：有值就弹迁移确认 */
	const [pendingDefault, setPendingDefault] = useState<string | null>(null);
	/** 应用标识（com.xxx.yyy）：显示目录名时要跳过这层 */
	const [identifier, setIdentifier] = useState("");
	const dirs = useSyncExternalStore(subscribeDirs, getDirsSnapshot);

	useEffect(() => {
		void getIdentifier().then(setIdentifier).catch(() => setIdentifier(""));
	}, []);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			// 几张表一起取：草稿、模板和正式报告要能对照着看，占用状态决定哪些条目能点
			const [nextReports, nextDrafts, nextTemplates, nextClaims] = await Promise.all([
				listReportsInAllDirs().catch(() => [] as ReportSummary[]),
				listDraftsInAllDirs().catch(() => [] as DraftEntry[]),
				listTemplatesInAllDirs().catch(() => [] as TemplateEntry[]),
				listClaims(),
			]);
			setReports(nextReports);
			setDrafts(nextDrafts);
			setTemplates(nextTemplates);
			setClaims(nextClaims);
		} finally {
			setLoading(false);
		}
	}, []);

	// 打开抽屉时、以及目录列表变化后都重新扫一遍
	useEffect(() => {
		if (!open) {
			return;
		}
		void refresh();
	}, [open, dirs, refresh]);

	const handleOpen = (folder: string, root: string) => {
		setOpen(false);
		void openReport(folder, { root });
	};

	/** 数据目录的显示名：草稿和报告列表共用 */
	const rootLabel = (root: string) => {
		const dir = dirs.dirs.find((item) => item.path === root);
		return dirLabel(root, dir?.builtin ?? false, identifier);
	};

	const selfLabel = currentWindowLabel();

	const handleAddDir = async () => {
		const selected = await pickDataDirectory();
		if (selected) {
			await addDataDir(selected);
		}
	};

	/**
	 * 设为默认。
	 * 当前报告已经保存过、且不在目标目录里时，先问一句要不要一起迁移 ——
	 * 不迁移也可以，之后保存仍然写回它原来那个目录。
	 */
	const handleSetDefault = (path: string) => {
		const persisted = saveStateStore.getState().persisted;
		const currentRoot = reportStore.rootPath;
		if (!persisted || !currentRoot || isSamePath(currentRoot, path)) {
			void setDefaultDataDir(path);
			return;
		}
		setPendingDefault(path);
	};

	const finishSetDefault = async (migrate: boolean) => {
		const target = pendingDefault;
		setPendingDefault(null);
		if (!target) {
			return;
		}
		if (migrate) {
			await moveCurrentReportTo(target);
		}
		await setDefaultDataDir(target);
	};

	return (
		<Drawer swipeDirection="right" open={open} onOpenChange={setOpen}>
			<DrawerTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="text-muted-foreground hover:bg-accent hover:text-foreground"
					/>
				}
			>
				<FolderOpen className="size-4" />
				打开
			</DrawerTrigger>

			<DrawerContent>
				<DrawerHeader>
					<DrawerTitle>打开报告</DrawerTitle>
					<DrawerDescription>所有数据目录里的报告、未保存的内容与模板</DrawerDescription>
				</DrawerHeader>

				<div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
					{loading && <p className="text-xs text-muted-foreground">正在读取…</p>}

					{!loading && (
						<>
							<div className="flex items-center gap-1.5">
								<h3 className="text-xs font-medium text-muted-foreground">未保存的内容</h3>
								{/* 数量给个角标：这一节默认是空的，有东西时得让用户先看见 */}
								{drafts.length > 0 && (
									<span className="rounded bg-primary/10 px-1 text-xs text-primary">
										{drafts.length}
									</span>
								)}
							</div>

							{drafts.length === 0 ? (
								<p className="mt-1 text-xs text-muted-foreground">没有未保存的内容</p>
							) : (
								<div className="mt-1 flex flex-col gap-1">
									<DraftList
										drafts={drafts}
										claims={claims}
										currentReportId={reportStore.state.reportId}
										rootLabel={rootLabel}
										onChanged={() => void refresh()}
										onOpen={() => setOpen(false)}
									/>
								</div>
							)}

							<Separator className="my-4" />

							<div className="flex items-center justify-between gap-2">
								<div className="flex items-center gap-1.5">
									<h3 className="text-xs font-medium text-muted-foreground">模板</h3>
									{templates.length > 0 && (
										<span className="rounded bg-primary/10 px-1 text-xs text-primary">
											{templates.length}
										</span>
									)}
								</div>
								{/* 模板没有"另存为"，只能从当前报告存出来 —— 入口就放在列表头上 */}
								<Button
									type="button"
									variant="ghost"
									size="xs"
									onClick={() => setTemplateDialogOpen(true)}
									title="把当前报告的内容存成模板"
									className="text-muted-foreground hover:text-foreground"
								>
									<Plus className="size-3" />
									保存为模板
								</Button>
							</div>

							{templates.length === 0 ? (
								<p className="mt-1 text-xs text-muted-foreground">
									还没有模板（把当前报告存成模板，下次直接套用）
								</p>
							) : (
								<div className="mt-1 flex flex-col gap-1">
									<TemplateList
										templates={templates}
										rootLabel={rootLabel}
										onChanged={() => void refresh()}
										onOpen={() => setOpen(false)}
									/>
								</div>
							)}

							<Separator className="my-4" />

							<div className="flex items-center gap-1.5">
								<h3 className="text-xs font-medium text-muted-foreground">已保存的报告</h3>
							</div>

							{reports.length === 0 ? (
								<p className="mt-1 text-xs text-muted-foreground">还没有保存过任何报告</p>
							) : (
								<div className="mt-1 flex flex-col gap-1">
									{reports.map((report) => {
										const owner = claims[report.reportId];
										const openedHere = owner === selfLabel;
										return (
											<button
												key={`${report.root}-${report.reportId}`}
												type="button"
												// 已被某个窗口打开的报告不能再开：两个窗口编辑同一份会互相覆盖
												disabled={Boolean(owner)}
												title={
													owner
														? openedHere
															? "已在这个窗口打开"
															: "已在另一个窗口打开"
														: undefined
												}
												onClick={() => handleOpen(report.folder, report.root)}
												className="flex w-full flex-col gap-0.5 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
											>
												<span className="flex items-center gap-1.5">
													<span className="truncate text-sm font-medium text-foreground">
														{report.reportName || "未命名报告"}
													</span>
													{owner && (
														<span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-xs text-primary">
															{openedHere ? "当前窗口" : "已在其它窗口打开"}
														</span>
													)}
													{!owner && report.root === dirs.defaultPath && (
														<span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-xs text-primary">
															默认目录
														</span>
													)}
												</span>
												<span className="truncate text-xs text-muted-foreground">
													{rootLabel(report.root)} · {formatTime(report.updatedAt)}
												</span>
											</button>
										);
									})}
								</div>
							)}
						</>
					)}

					<Separator className="my-4" />

					<div className="flex items-center justify-between">
						<h3 className="text-xs font-medium text-muted-foreground">数据目录</h3>
						<Button
							type="button"
							variant="ghost"
							size="xs"
							onClick={() => void handleAddDir()}
							title="会在这个文件夹下创建应用专属子目录"
							className="text-muted-foreground hover:text-foreground"
						>
							<Plus className="size-3" />
							添加目录
						</Button>
					</div>

					<div className="mt-2 flex flex-col gap-1">
						{dirs.dirs.map((dir) => {
							const isDefault = dir.path === dirs.defaultPath;
							return (
								<div
									key={dir.path}
									className="flex items-center gap-2 rounded-lg border border-border/70 px-2.5 py-1.5"
								>
									<div className="flex min-w-0 flex-1 flex-col">
										<span className="flex items-center gap-1.5">
											<span className="truncate text-xs font-medium text-foreground">
												{dirLabel(dir.path, dir.builtin, identifier)}
											</span>
											{isDefault && <Star className="size-3 shrink-0 text-primary" />}
										</span>
										<span
											className="truncate text-xs text-muted-foreground"
											title={dir.path}
										>
											{dir.path}
										</span>
									</div>

									{!isDefault && (
										<Button
											type="button"
											variant="ghost"
											size="xs"
											onClick={() => handleSetDefault(dir.path)}
											className="shrink-0 text-muted-foreground hover:text-foreground"
										>
											设为默认
										</Button>
									)}
									{!dir.builtin && (
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											aria-label="移除目录"
											title="从列表移除（磁盘文件不动）"
											onClick={() => void removeDataDir(dir.path)}
											className="shrink-0 text-muted-foreground hover:text-destructive"
										>
											<Trash2 className="size-3" />
										</Button>
									)}
								</div>
							);
						})}
					</div>
				</div>

				{/* 保存为模板：命名框放在抽屉内容里，才能保证它在抽屉关掉时一起卸载 */}
				<SaveTemplateDialog
					open={templateDialogOpen}
					defaultName={reportStore.state.reportName}
					onSave={async (name) => {
						const saved = await saveAsTemplate(name);
						if (saved) {
							await refresh();
						}
						return saved;
					}}
					onClose={() => setTemplateDialogOpen(false)}
				/>
			</DrawerContent>

			{/* 切换默认目录时的迁移确认：不迁移也允许，报告继续留在原目录 */}
			<Dialog
				open={pendingDefault !== null}
				onOpenChange={(next) => {
					if (!next) {
						setPendingDefault(null);
					}
				}}
			>
				<DialogContent className="w-96">
					<DialogHeader>
						<DialogTitle>迁移当前报告？</DialogTitle>
						<DialogDescription>
							当前报告保存在「
							{dirLabel(reportStore.rootPath ?? "", false, identifier)}
							」，要把它一起迁到新的默认目录「
							{pendingDefault ? dirLabel(pendingDefault, false, identifier) : ""}
							」吗？
						</DialogDescription>
					</DialogHeader>

					<DialogFooter>
						<Button type="button" variant="ghost" onClick={() => setPendingDefault(null)}>
							取消
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() => void finishSetDefault(false)}
						>
							不迁移，仍在当前目录保存
						</Button>
						<Button type="button" onClick={() => void finishSetDefault(true)}>
							迁移过去
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Drawer>
	);
}
