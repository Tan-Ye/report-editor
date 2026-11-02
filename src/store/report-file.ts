import { baseHeight, baseWidth } from "@/base";
import { TEXT_ELEMENT_TYPE } from "@/base/elements";
import { createUniqueId } from "@/lib/utils";
import type { ElementAttrs, ElementInfo } from "./element";
import { createPage, pageStore, type PageInfo } from "./page";
import { reportStore } from "./report";
import { REPORT_FILE_VERSION, type ReportFile } from "./schema";

/** 空文本不该进文件：编辑时可以留占位框，落盘时不能留垃圾 */
function isMeaningfulElement(element: ElementInfo): boolean {
	if (element.elementType !== TEXT_ELEMENT_TYPE) {
		return true;
	}
	const text = element.attrs.text;
	return typeof text === "string" && text.trim() !== "";
}

/**
 * 把内存里的报告组装成可直接写文件的结构。
 * 不做字段转换：store 的类型和文件的类型是同一套。
 */
export function toReportFile(): ReportFile {
	return {
		version: REPORT_FILE_VERSION,
		reportId: reportStore.state.reportId,
		reportName: reportStore.state.reportName,
		pageWidth: baseWidth,
		pageHeight: baseHeight,
		pages: pageStore.state.pages.map((page) => ({
			...page,
			elements: page.elements.filter(isMeaningfulElement),
		})),
	};
}

export interface ParseResult {
	file: ReportFile;
	/** 读取过程中修正过的问题，交给上层决定要不要提示用户 */
	warnings: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** attrs 只接受普通对象，其他一律当空对象处理 */
function parseAttrs(raw: unknown): ElementAttrs {
	if (!isRecord(raw)) {
		return {};
	}
	const attrs: ElementAttrs = {};
	for (const [key, value] of Object.entries(raw)) {
		attrs[key] = value;
	}
	return attrs;
}

function parseElement(raw: unknown, usedIds: Set<string>, warnings: string[]): ElementInfo | null {
	if (!isRecord(raw)) {
		warnings.push("跳过一条非法元素记录（不是对象）");
		return null;
	}
	const elementType = typeof raw.elementType === "string" ? raw.elementType.trim() : "";
	// 类型缺失就无从还原；但「类型不认识」是另一回事，那种要保留下来
	if (!elementType) {
		warnings.push("跳过一条缺少 elementType 的元素");
		return null;
	}

	let id = typeof raw.id === "string" ? raw.id.trim() : "";
	if (!id || usedIds.has(id)) {
		id = createUniqueId("element");
		warnings.push(`元素 id 缺失或重复，已重新生成：${id}`);
	}
	usedIds.add(id);

	return { elementType, id, attrs: parseAttrs(raw.attrs) };
}

function parsePage(raw: unknown, warnings: string[]): PageInfo {
	if (!isRecord(raw)) {
		warnings.push("跳过一条非法页面记录");
		return createPage();
	}

	const pageId =
		typeof raw.pageId === "string" && raw.pageId.trim() ? raw.pageId : createUniqueId("page");
	const pageName = typeof raw.pageName === "string" ? raw.pageName : "";

	const rawElements: unknown[] = Array.isArray(raw.elements) ? raw.elements : [];
	if (!Array.isArray(raw.elements)) {
		warnings.push(`页面 ${pageId} 的 elements 不是数组，已当作空页处理`);
	}

	const usedIds = new Set<string>();
	const elements = rawElements
		.map((item) => parseElement(item, usedIds, warnings))
		.filter((item): item is ElementInfo => item !== null);

	return { pageId, pageName, elements };
}

/**
 * 校验并规范化文件内容。
 * 结构不可用（例如根本不是对象）时抛错，其余问题一律修正后记入 warnings。
 */
export function parseReportFile(raw: unknown): ParseResult {
	if (!isRecord(raw)) {
		throw new Error("报告文件内容不是对象，无法解析");
	}

	const warnings: string[] = [];

	let version = REPORT_FILE_VERSION;
	if (typeof raw.version === "number") {
		version = raw.version;
		if (version > REPORT_FILE_VERSION) {
			warnings.push(
				`文件版本 ${version} 高于当前支持的 ${REPORT_FILE_VERSION}，可能有字段无法识别`,
			);
		}
	} else {
		warnings.push("文件缺少 version 字段，按当前版本处理");
	}

	const rawPages: unknown[] = Array.isArray(raw.pages) ? raw.pages : [];
	if (!Array.isArray(raw.pages) || rawPages.length === 0) {
		warnings.push("文件里没有页面，已补一个空页");
	}
	const pages = rawPages.length > 0 ? rawPages.map((item) => parsePage(item, warnings)) : [createPage()];

	return {
		file: {
			version,
			reportId: typeof raw.reportId === "string" ? raw.reportId : "",
			reportName: typeof raw.reportName === "string" ? raw.reportName : "",
			pageWidth: typeof raw.pageWidth === "number" ? raw.pageWidth : baseWidth,
			pageHeight: typeof raw.pageHeight === "number" ? raw.pageHeight : baseHeight,
			pages,
		},
		warnings,
	};
}

/** 把文件内容写进 store（不做额外转换） */
export function applyReportFile(file: ReportFile): void {
	reportStore.writeReportInfo({ reportId: file.reportId, reportName: file.reportName });
	pageStore.replacePages(file.pages, 0);
}

/** JSON 文本 → store 的一步到位入口。JSON 语法错误会原样抛出，由调用方处理 */
export function loadReportFromJSON(json: string): ParseResult {
	const result = parseReportFile(JSON.parse(json));
	applyReportFile(result.file);
	return result;
}
