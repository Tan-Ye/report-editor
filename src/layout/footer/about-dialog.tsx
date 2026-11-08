import { useEffect, useState } from "react";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toast";
import { saveReport } from "@/lib/report/service";
import { getIpcStats, getSlowResources, getStartupSpans } from "@/lib/startup-timing";
import {
	checkForUpdate,
	downloadUpdate,
	getAppVersion,
	openReleasePage,
	runInstaller,
	type UpdateCheckResult,
} from "@/lib/update-service";
import { saveStateStore } from "@/store";

function describeResult(result: UpdateCheckResult | null): string {
	if (!result) {
		return "还没检查过";
	}
	if (result.status === "up-to-date") {
		return `已是最新版本（${result.current}）`;
	}
	if (result.status === "available") {
		return `发现新版本 ${result.info.latest}（当前 ${result.info.current}）`;
	}
	return `暂时无法检查更新：${result.reason}`;
}

/**
 * 底部状态栏左侧的版本入口：「关于」+ 检查更新 + 下载安装。
 *
 * 安装流程：下载 NSIS 安装包到临时目录 → 启动安装程序 → Rust 侧退出应用。
 * 安装包不落「下载」目录（装完就是垃圾），下次启动时由 Rust 清掉残留。
 */
export function AboutDialog() {
	const [version, setVersion] = useState("");
	const [checking, setChecking] = useState(false);
	const [installing, setInstalling] = useState(false);
	const [result, setResult] = useState<UpdateCheckResult | null>(null);

	useEffect(() => {
		void getAppVersion().then(setVersion);
	}, []);

	const handleCheck = async () => {
		setChecking(true);
		try {
			setResult(await checkForUpdate());
		} finally {
			setChecking(false);
		}
	};

	const handleInstall = async () => {
		if (result?.status !== "available" || !result.info.downloadUrl) {
			return;
		}
		setInstalling(true);
		try {
			// 装完应用会被关掉：先把未保存的改动写盘，免得白改
			if (saveStateStore.isDirty()) {
				await saveReport();
			}
			const path = await downloadUpdate(result.info);
			toast.add({ title: "下载完成", description: "正在启动安装程序…", type: "info" });
			await runInstaller(path);
		} catch (error) {
			toast.add({
				title: "更新失败",
				description: error instanceof Error ? error.message : String(error),
				type: "error",
			});
			setInstalling(false);
		}
	};

	const handleOpenPage = async () => {
		if (result?.status !== "available" || !result.info.url) {
			return;
		}
		try {
			await openReleasePage(result.info.url);
		} catch (error) {
			toast.add({
				title: "打不开发布页",
				description: error instanceof Error ? error.message : String(error),
				type: "error",
			});
		}
	};

	return (
		<Dialog>
			<DialogTrigger
				className="rounded-md px-1.5 py-1 text-xs tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				title="关于 / 检查更新"
			>
				v{version || "…"}
			</DialogTrigger>

			<DialogContent className="w-80">
				<DialogHeader>
					<DialogTitle>报表编辑器</DialogTitle>
					<DialogDescription>桌面端报告设计工具</DialogDescription>
				</DialogHeader>

				<dl className="flex flex-col gap-1.5 text-xs">
					<div className="flex items-center justify-between">
						<dt className="text-muted-foreground">当前版本</dt>
						<dd className="tabular-nums text-foreground">{version || "…"}</dd>
					</div>
				</dl>

				<Separator />

				<div className="flex flex-col gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={checking || installing}
						onClick={() => void handleCheck()}
					>
						<RefreshCw className={checking ? "animate-spin" : undefined} />
						{checking ? "检查中…" : "检查更新"}
					</Button>
					<p className="text-xs leading-relaxed text-muted-foreground">
						{describeResult(result)}
					</p>

					{result?.status === "available" && result.info.notes && (
						<p className="max-h-32 overflow-y-auto rounded-md border border-border/70 bg-background p-2 text-xs leading-relaxed text-muted-foreground">
							{result.info.notes}
						</p>
					)}

					{result?.status === "available" && (
						<div className="flex flex-col gap-1.5">
							{result.info.downloadUrl ? (
								<Button
									type="button"
									size="sm"
									disabled={installing}
									onClick={() => void handleInstall()}
								>
									<Download />
									{installing ? "下载中…" : "下载并安装"}
								</Button>
							) : (
								<p className="text-xs leading-relaxed text-muted-foreground">
									这个版本没有附带安装包，请到发布页下载。
								</p>
							)}
							{result.info.url && (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={installing}
									onClick={() => void handleOpenPage()}
								>
									<ExternalLink />
									打开发布页
								</Button>
							)}
						</div>
					)}
				</div>

				{/* 调试用：启动各阶段耗时（最近一次），排查"打开很慢"时看这里 */}
				<StartupTimingSection />
			</DialogContent>
		</Dialog>
	);
}

function StartupTimingSection() {
	const spans = getStartupSpans();
	const ipc = getIpcStats();
	const resources = getSlowResources();
	if (spans.length === 0) {
		return null;
	}
	const total = ipc.reduce((sum, item) => sum + item.count, 0);
	return (
		<details className="text-xs">
			<summary className="cursor-pointer text-muted-foreground hover:text-foreground">
				启动耗时（最近一次）
			</summary>
			<div className="mt-1 max-h-44 overflow-auto rounded-md border border-border/70 bg-background">
				<table className="w-full text-left text-xs tabular-nums">
					<thead className="sticky top-0 bg-muted/80 text-muted-foreground">
						<tr>
							<th className="px-1.5 py-1 font-normal">阶段</th>
							<th className="px-1.5 py-1 text-right font-normal">开始</th>
							<th className="px-1.5 py-1 text-right font-normal">耗时</th>
						</tr>
					</thead>
					<tbody>
						{spans.map((span, index) => (
							<tr key={`${span.name}-${index}`} className="border-t border-border/50">
								<td className="px-1.5 py-0.5" title={span.detail ?? ""}>
									{span.name}
								</td>
								<td className="px-1.5 py-0.5 text-right text-muted-foreground">
									{span.start.toFixed(0)}ms
								</td>
								<td className="px-1.5 py-0.5 text-right">
									{span.duration > 0 ? `${span.duration.toFixed(0)}ms` : "—"}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<p className="mt-1 text-xs text-muted-foreground">
				IPC {total} 次
				{ipc[0] ? `，最多的是 ${ipc[0].command}（${ipc[0].count} 次 / ${ipc[0].total.toFixed(0)}ms）` : ""}
			</p>
			{resources.length > 0 && (
				<div className="mt-1 max-h-28 overflow-auto rounded-md border border-border/70 bg-background">
					<table className="w-full text-left text-xs tabular-nums">
						<thead className="sticky top-0 bg-muted/80 text-muted-foreground">
							<tr>
								<th className="px-1.5 py-1 font-normal">资源</th>
								<th className="px-1.5 py-1 text-right font-normal">耗时</th>
								<th className="px-1.5 py-1 text-right font-normal">大小</th>
							</tr>
						</thead>
						<tbody>
							{resources.map((resource) => (
								<tr key={resource.name} className="border-t border-border/50">
									<td className="max-w-40 truncate px-1.5 py-0.5" title={resource.name}>
										{resource.name}
									</td>
									<td className="px-1.5 py-0.5 text-right text-muted-foreground">
										{resource.duration.toFixed(0)}ms
									</td>
									<td className="px-1.5 py-0.5 text-right text-muted-foreground">
										{resource.size > 0 ? `${Math.round(resource.size / 1024)}KB` : "—"}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</details>
	);
}
