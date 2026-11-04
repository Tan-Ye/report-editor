import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { baseHeight, baseWidth } from "@/base";
import { pageStore, reportStore, toReportFile, type PageInfo } from "@/store";
import { buildHtmlDocument } from "./html-package";
import { collectImageSources, ensureMediaImages } from "../media";
import { dataUrlToBase64, loadImage, renderPageImage, stitchPagesVertically } from "./page-image";
import { sanitizeFolderName } from "./path";

/**
 * 导出的格式。
 * - 长图：所有页竖着拼成一张
 * - html：一个可以直接双击打开的网页包，也是唯一能播视频的格式
 */
export type ExportFormat = "pdf" | "png" | "jpeg" | "long-image" | "html";

/** 导出范围：当前页 / 全部页 */
export type ExportRange = "current" | "all";

export interface ExportOptions {
	format: ExportFormat;
	range: ExportRange;
	/** 输出倍率：1 = 1920×1080，2 = 3840×2160 */
	scale: number;
	/** JPEG 质量 0~1 */
	quality: number;
}

export interface ExportResult {
	/** 写出去的文件数 */
	files: number;
	/** 用户实际选中的位置（文件或目录） */
	path: string;
}

/**
 * 1 个画布像素等于多少 PDF 点。
 * 按 96 DPI 换算：1920px → 1440pt（20 英寸宽），打印时按纸张缩放即可。
 */
const PDF_POINTS_PER_PIXEL = 0.75;

const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
	pdf: "pdf",
	png: "png",
	jpeg: "jpg",
	"long-image": "png",
	html: "html",
};

/** 导出文件名（不带扩展名） */
function exportBaseName(): string {
	const name = sanitizeFolderName(reportStore.state.reportName || "未命名报告");
	return name || "报告";
}

/** 让出一帧，避免多页导出时界面完全卡死（"导出中…"能画出来） */
function yieldToBrowser(): Promise<void> {
	return new Promise((resolve) => {
		window.setTimeout(resolve, 0);
	});
}

/**
 * 导出报告。
 *
 * 统一走离屏渲染（`renderPageImage`），**不抓主画布** ——
 * 主画布上有选中框和控件，导出的图会带上这些。
 *
 * 返回 null 表示用户在保存对话框里取消了。
 */
export async function exportReport(options: ExportOptions): Promise<ExportResult | null> {
	const pages = options.range === "all" ? pageStore.getPages() : [pageStore.currentPage];
	if (pages.length === 0) {
		throw new Error("没有可导出的页面");
	}

	// 图片是异步解码的，离屏渲染是同步的：不先等它们落地，导出图里会缺图
	await ensureMediaImages(collectImageSources(pages));

	const baseName = exportBaseName();
	if (options.format === "pdf") {
		return exportPdf(pages, options, baseName);
	}
	if (options.format === "long-image") {
		return exportLongImage(pages, options, baseName);
	}
	if (options.format === "html") {
		return exportHtmlPackage(pages, options, baseName);
	}
	return exportImages(pages, options, baseName);
}

async function exportPdf(
	pages: PageInfo[],
	options: ExportOptions,
	baseName: string,
): Promise<ExportResult | null> {
	const path = await saveDialog({
		defaultPath: `${baseName}.pdf`,
		filters: [{ name: "PDF", extensions: ["pdf"] }],
	});
	if (!path) {
		return null;
	}

	const payload: { data: string; width: number; height: number }[] = [];
	for (const page of pages) {
		const url = renderPageImage(page, {
			scale: options.scale,
			format: "jpeg",
			quality: options.quality,
		});
		if (!url) {
			throw new Error("页面渲染失败");
		}
		payload.push({
			data: dataUrlToBase64(url),
			width: Math.round(baseWidth * options.scale),
			height: Math.round(baseHeight * options.scale),
		});
		await yieldToBrowser();
	}

	await invoke("export_pdf", {
		path,
		pages: payload,
		width: baseWidth * PDF_POINTS_PER_PIXEL,
		height: baseHeight * PDF_POINTS_PER_PIXEL,
		// 把源文件作为附件一起塞进 PDF：栅格 PDF 本身没有结构，
		// 挂上 report.json 之后这份 PDF 就同时是"成品"和"源文件"，
		// 以后做「从 PDF 解析回 JSON」直接读附件即可，无损
		reportJson: JSON.stringify(toReportFile(), null, 2),
	});
	return { files: 1, path };
}

/**
 * 导出 HTML 包：选一个目录，里面生成
 *
 * ```
 * <报告名>/
 * ├── index.html     翻页 / 全屏 / 键盘操作
 * ├── pages/01.jpg … 每页一张底图
 * └── report.json    源文件，方便以后回读
 * ```
 *
 * 这是唯一能播视频的格式：底图里视频是封面帧，等视频元素落地后
 * 在 index.html 里按元素坐标叠 `<video>` 即可。
 */
async function exportHtmlPackage(
	pages: PageInfo[],
	options: ExportOptions,
	baseName: string,
): Promise<ExportResult | null> {
	const directory = await openDialog({ directory: true, multiple: false });
	if (typeof directory !== "string") {
		return null;
	}
	const root = `${directory}/${baseName}`;
	const width = Math.round(baseWidth * options.scale);
	const height = Math.round(baseHeight * options.scale);
	const pageFiles: { image: string }[] = [];

	for (const [index, page] of pages.entries()) {
		const url = renderPageImage(page, {
			scale: options.scale,
			format: "jpeg",
			quality: options.quality,
		});
		if (!url) {
			throw new Error("页面渲染失败");
		}
		const image = `pages/${String(index + 1).padStart(2, "0")}.jpg`;
		await invoke("write_file_base64", {
			path: `${root}/${image}`,
			data: dataUrlToBase64(url),
		});
		pageFiles.push({ image });
		await yieldToBrowser();
	}

	const html = buildHtmlDocument({
		title: reportStore.state.reportName || "未命名报告",
		pages: pageFiles,
		width,
		height,
	});
	await invoke("write_text_file", { path: `${root}/index.html`, content: html });
	// 源文件一起带上：整个包既是成品，也能以后导回编辑器
	await invoke("write_text_file", {
		path: `${root}/report.json`,
		content: JSON.stringify(toReportFile(), null, 2),
	});
	return { files: pageFiles.length + 2, path: root };
}

async function exportImages(
	pages: PageInfo[],
	options: ExportOptions,
	baseName: string,
): Promise<ExportResult | null> {
	const format = options.format === "jpeg" ? "jpeg" : "png";
	const extension = FORMAT_EXTENSIONS[options.format];

	// 单页：直接给文件名；多页：选目录，每页一个文件
	let directory: string | null = null;
	let filePath: string | null = null;
	if (pages.length === 1) {
		filePath = await saveDialog({
			defaultPath: `${baseName}.${extension}`,
			filters: [{ name: format.toUpperCase(), extensions: [extension] }],
		});
		if (!filePath) {
			return null;
		}
	} else {
		directory = await openDialog({ directory: true, multiple: false });
		if (typeof directory !== "string") {
			return null;
		}
	}

	for (const [index, page] of pages.entries()) {
		const url = renderPageImage(page, {
			scale: options.scale,
			format,
			quality: options.quality,
		});
		if (!url) {
			throw new Error("页面渲染失败");
		}
		const target =
			filePath ?? `${directory}/${baseName}-${String(index + 1).padStart(2, "0")}.${extension}`;
		await invoke("write_file_base64", { path: target, data: dataUrlToBase64(url) });
		await yieldToBrowser();
	}

	return { files: pages.length, path: filePath ?? (directory as string) };
}

async function exportLongImage(
	pages: PageInfo[],
	options: ExportOptions,
	baseName: string,
): Promise<ExportResult | null> {
	const path = await saveDialog({
		defaultPath: `${baseName}-长图.png`,
		filters: [{ name: "PNG", extensions: ["png"] }],
	});
	if (!path) {
		return null;
	}

	/**
	 * 浏览器 canvas 高度有上限（Chrome 约 16384px），页数一多长图会超。
	 * 超了就自动降倍率，保证能导出来 —— 报错比图糊更糟。
	 */
	const MAX_CANVAS_HEIGHT = 16000;
	const maxScale = MAX_CANVAS_HEIGHT / (pages.length * baseHeight);
	const scale = Math.min(options.scale, maxScale);
	if (scale <= 0) {
		throw new Error("页数太多，无法合成一张长图");
	}

	const images: HTMLImageElement[] = [];
	for (const page of pages) {
		const url = renderPageImage(page, { scale, format: "png" });
		if (!url) {
			throw new Error("页面渲染失败");
		}
		images.push(await loadImage(url));
		await yieldToBrowser();
	}

	const stitched = stitchPagesVertically(images, scale, "png");
	if (!stitched) {
		throw new Error("长图合成失败");
	}
	await invoke("write_file_base64", { path, data: dataUrlToBase64(stitched) });
	return { files: 1, path };
}

/**
 * 导出前提示各格式对视频的局限。
 * PDF 和图片都是静态格式，视频只能导出成封面帧；只有 HTML 包能真播。
 */
export function videoLimitationText(format: ExportFormat): string | null {
	if (format === "html") {
		return "HTML 包可翻页、可全屏，视频元素上线后能在这里播放。";
	}
	if (format === "pdf") {
		return "PDF 不能播放视频：视频元素会导出成封面帧。要能播放请用 HTML 包。";
	}
	return "图片是静态格式：视频元素只会是封面帧。要能播放请用 HTML 包。";
}

/** 报告里有多少个视频元素（视频元素还没做，先按类型名判断，方便以后接上） */
export function countVideoElements(): number {
	const videoTypes = new Set(["video"]);
	return pageStore
		.getPages()
		.flatMap((page) => page.elements)
		.filter((element) => videoTypes.has(element.elementType)).length;
}

/** 导出结果提示文案 */
export function describeExportResult(result: ExportResult): string {
	return result.files === 1 ? `已导出到 ${result.path}` : `已导出 ${result.files} 个文件到 ${result.path}`;
}