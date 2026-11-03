import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { baseHeight, baseWidth } from "@/base";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toast";
import {
	countVideoElements,
	describeExportResult,
	exportReport,
	videoLimitationText,
	type ExportFormat,
	type ExportRange,
} from "@/lib/report-export";
import { cn } from "@/lib/utils";

interface FormatOption {
	value: ExportFormat;
	label: string;
	hint: string;
	/** 这种格式默认导全部页 */
	allPages: boolean;
}

const FORMAT_OPTIONS: FormatOption[] = [
	{ value: "pdf", label: "PDF", hint: "多页文档，一页一张，按画布尺寸", allPages: true },
	{ value: "png", label: "PNG", hint: "无损图片，单页一张", allPages: false },
	{ value: "jpeg", label: "JPEG", hint: "体积更小，适合分享", allPages: false },
	{ value: "long-image", label: "长图", hint: "所有页竖着拼成一张", allPages: true },
	{ value: "html", label: "网页", hint: "自包含的 HTML 包，浏览器里翻页/全屏", allPages: true },
];

const SCALE_OPTIONS = [1, 2, 3];

/**
 * 导出面板。
 *
 * 所有格式都走离屏渲染，和缩略图同一条链路；保存路径由系统对话框决定，
 * 写文件交给 Rust（用户选的目录不在 fs 插件 scope 里）。
 */
export function ExportBtn() {
	const [open, setOpen] = useState(false);
	const [format, setFormat] = useState<ExportFormat>("pdf");
	const [range, setRange] = useState<ExportRange>("all");
	// 默认 3×：1920 → 5760px，按 20 英寸页宽算约 288 DPI，打印足够清晰
	const [scale, setScale] = useState(3);
	const [exporting, setExporting] = useState(false);

	const option = FORMAT_OPTIONS.find((item) => item.value === format) ?? FORMAT_OPTIONS[0];
	const videoCount = countVideoElements();
	const limitation = videoLimitationText(format);

	// 切格式时把范围调成这种格式的常用值
	useEffect(() => {
		setRange(option.allPages ? "all" : "current");
	}, [option.allPages]);

	const handleExport = async () => {
		if (exporting) {
			return;
		}
		setExporting(true);
		try {
			const result = await exportReport({ format, range, scale, quality: 0.92 });
			if (result) {
				toast.add({
					title: "导出完成",
					description: describeExportResult(result),
					type: "success",
				});
				setOpen(false);
			}
		} catch (error) {
			toast.add({
				title: "导出失败",
				description: error instanceof Error ? error.message : String(error),
				type: "error",
			});
		} finally {
			setExporting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="text-muted-foreground hover:bg-accent hover:text-foreground"
					/>
				}
			>
				<Download className="size-4" />
				导出
			</DialogTrigger>

			<DialogContent className="w-[26rem]">
				<DialogHeader>
					<DialogTitle>导出报告</DialogTitle>
					<DialogDescription>{option.hint}</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1.5">
						<span className="text-xs font-medium text-muted-foreground">格式</span>
						<div className="grid grid-cols-5 gap-1">
							{FORMAT_OPTIONS.map((item) => (
								<Button
									key={item.value}
									type="button"
									variant={item.value === format ? "secondary" : "ghost"}
									size="sm"
									onClick={() => setFormat(item.value)}
									className={cn(
										"justify-center",
										item.value === format && "text-primary",
									)}
								>
									{item.label}
								</Button>
							))}
						</div>
					</div>

					<div className="flex items-center justify-between gap-3">
						<span className="text-xs font-medium text-muted-foreground">范围</span>
						<div className="flex gap-1">
							<Button
								type="button"
								variant={range === "current" ? "secondary" : "ghost"}
								size="sm"
								onClick={() => setRange("current")}
							>
								当前页
							</Button>
							<Button
								type="button"
								variant={range === "all" ? "secondary" : "ghost"}
								size="sm"
								onClick={() => setRange("all")}
							>
								全部页
							</Button>
						</div>
					</div>

					<div className="flex items-center justify-between gap-3">
						<span className="text-xs font-medium text-muted-foreground">清晰度</span>
						<div className="flex gap-1">
							{SCALE_OPTIONS.map((value) => (
								<Button
									key={value}
									type="button"
									variant={value === scale ? "secondary" : "ghost"}
									size="sm"
									onClick={() => setScale(value)}
									title={`${baseWidth * value} × ${baseHeight * value}`}
								>
									{value}×
								</Button>
							))}
						</div>
					</div>

					<p className="rounded-md border border-border/70 bg-muted/40 p-2 text-xs leading-relaxed text-muted-foreground">
						输出尺寸 {baseWidth * scale} × {baseHeight * scale}
						{videoCount > 0 && (
							<>
								<br />
								当前报告有 {videoCount} 个视频元素。
							</>
						)}
						<br />
						{limitation}
					</p>
				</div>

				<Separator />

				<DialogFooter>
					<Button type="button" variant="ghost" onClick={() => setOpen(false)}>
						取消
					</Button>
					<Button type="button" disabled={exporting} onClick={() => void handleExport()}>
						{exporting ? "导出中…" : "导出"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
