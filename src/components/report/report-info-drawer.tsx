import { useEffect, useState, useSyncExternalStore } from "react";
import { FileText, FolderOpen, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { getDataDirPath, revealDataDir, saveReport } from "@/lib/report/service";
import { reportStore, saveStateStore } from "@/store";

/** 保存状态的一句话描述 */
function describeSaveState(dirty: boolean, saving: boolean, savedAt: number | null) {
	if (saving) {
		return "正在写入磁盘…";
	}
	if (dirty) {
		return "有未保存的改动";
	}
	if (savedAt) {
		return `已保存 · ${new Date(savedAt).toLocaleTimeString()}`;
	}
	return "尚未保存";
}

/**
 * 报告信息抽屉：报告名、id、保存状态、数据目录。
 * 从属性面板右下角打开。
 */
export function ReportInfoDrawer() {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [dataDir, setDataDir] = useState("");
	const view = useSyncExternalStore(saveStateStore.subscribe, saveStateStore.getSnapshot);

	// 每次打开时重新取一次：报告名可能已经被「打开报告」换掉了
	useEffect(() => {
		if (!open) {
			return;
		}
		setName(reportStore.state.reportName);
		void getDataDirPath()
			.then(setDataDir)
			.catch(() => setDataDir(""));
	}, [open]);

	const handleNameChange = (value: string) => {
		setName(value);
		reportStore.setReportInfo({ reportName: value });
		// 报告名会写进文件，也算一次文档变更
		saveStateStore.markDirty();
	};

	return (
		<Drawer swipeDirection="right" open={open} onOpenChange={setOpen}>
			<DrawerTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="justify-start text-muted-foreground hover:bg-accent hover:text-foreground"
					/>
				}
			>
				<FileText className="size-4" />
				报告信息
			</DrawerTrigger>

			<DrawerContent>
				<DrawerHeader>
					<DrawerTitle>报告信息</DrawerTitle>
					<DrawerDescription>名称、标识与保存状态</DrawerDescription>
				</DrawerHeader>

				<div className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="report-name">报告名称</Label>
						<Input
							id="report-name"
							value={name}
							placeholder="未命名报告"
							onChange={(event) => handleNameChange(event.target.value)}
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label>报告 ID</Label>
						<p className="truncate text-xs tabular-nums text-muted-foreground">
							{reportStore.state.reportId}
						</p>
					</div>

					<Separator />

					<div className="flex flex-col gap-1.5">
						<Label>保存状态</Label>
						<p className="text-xs text-muted-foreground">
							{describeSaveState(view.dirty, view.saving, view.savedAt)}
						</p>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label>数据目录</Label>
						<p className="break-all text-xs text-muted-foreground">{dataDir || "读取中…"}</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="mt-1 w-fit"
							onClick={() => void revealDataDir()}
						>
							<FolderOpen className="size-4" />
							在文件夹中显示
						</Button>
					</div>
				</div>

				<DrawerFooter>
					<Button
						type="button"
						disabled={view.saving}
						onClick={() => {
							// 点完就收起来：保存是异步的，结果用 toast 反馈
							setOpen(false);
							void saveReport();
						}}
					>
						<Save className="size-4" />
						{view.saving ? "保存中…" : "保存"}
					</Button>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	);
}
