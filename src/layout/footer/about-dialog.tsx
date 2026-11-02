import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
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
import { checkForUpdate, getAppVersion, type UpdateCheckResult } from "@/lib/update-service";

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
 * 底部状态栏左侧的版本入口：「关于」+ 检查更新。
 * 没有真实更新源时点检查只会给出「未配置」的说明，不会假装成功。
 */
export function AboutDialog() {
	const [version, setVersion] = useState("");
	const [checking, setChecking] = useState(false);
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
						disabled={checking}
						onClick={() => void handleCheck()}
					>
						<RefreshCw className={checking ? "animate-spin" : undefined} />
						{checking ? "检查中…" : "检查更新"}
					</Button>
					<p className="text-xs leading-relaxed text-muted-foreground">
						{describeResult(result)}
					</p>

					{result?.status === "available" && result.info.notes && (
						<p className="rounded-md border border-border/70 bg-background p-2 text-xs leading-relaxed text-muted-foreground">
							{result.info.notes}
						</p>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
