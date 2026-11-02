import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@/components/ui/drawer";
import { listSavedReports, openReport, type ReportSummary } from "@/lib/report-service";

function formatTime(updatedAt: number | null) {
	if (!updatedAt) {
		return "";
	}
	return new Date(updatedAt).toLocaleString();
}

/**
 * 打开报告抽屉：扫描数据目录下的 report.json。
 * 不维护索引文件 —— 目录本身就是数据源，删了文件列表自然就少了。
 */
export function OpenReportDrawer() {
	const [open, setOpen] = useState(false);
	const [reports, setReports] = useState<ReportSummary[]>([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!open) {
			return;
		}
		let cancelled = false;
		setLoading(true);
		void listSavedReports()
			.then((list) => {
				if (!cancelled) {
					setReports(list);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setReports([]);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [open]);

	const handleOpen = (folder: string) => {
		setOpen(false);
		void openReport(folder);
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
					<DrawerDescription>数据目录里已保存的报告</DrawerDescription>
				</DrawerHeader>

				<div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
					{loading && <p className="text-xs text-muted-foreground">正在读取…</p>}

					{!loading && reports.length === 0 && (
						<p className="text-xs text-muted-foreground">还没有保存过任何报告</p>
					)}

					<div className="flex flex-col gap-1">
						{reports.map((report) => (
							<button
								key={report.reportId}
								type="button"
								onClick={() => handleOpen(report.folder)}
								className="flex w-full flex-col gap-0.5 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-accent"
							>
								<span className="truncate text-sm font-medium text-foreground">
									{report.reportName || "未命名报告"}
								</span>
								<span className="truncate text-xs text-muted-foreground">
									{formatTime(report.updatedAt)}
								</span>
							</button>
						))}
					</div>
				</div>
			</DrawerContent>
		</Drawer>
	);
}
