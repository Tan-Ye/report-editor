import { KNOWN_ELEMENT_TYPES } from "@/base/elements";
import { parseReportFile, type ParseResult } from "@/store/report-file";
import type { ReportFile } from "@/store/schema";

/**
 * 报告校验入口。
 *
 * 为什么要单独一层：`parseReportFile` 的 warnings 现在是"弹个 toast 就没了"，
 * 但同一批信息别的地方也要用 —— 测试要断言、以后的无头渲染/agent 要先校验再渲染、
 * 出问题时用户要能看到完整清单。所以这里把它升级成**结构化的 issue 列表**：
 *
 * - `level`：error = 没法用；warning = 已经被自动修正，但值得告诉用户
 * - `code`：稳定的机器可读标识，界面和工具按它分类，别让人去匹配中文
 * - `path`：出问题的位置，例如 `pages[0].elements[2]`
 *
 * 这个模块**不 import fabric**，所以能在 node 里跑（单测、以后的无头校验）。
 */
export type ReportIssueLevel = "error" | "warning";

export type ReportIssueCode =
	/** 整体不是一个对象 */
	| "not-an-object"
	/** 缺少 reportId，已重新生成 */
	| "missing-report-id"
	/** 文件里没有页面，已补一个空页 */
	| "missing-pages"
	/** 元素 id 缺失或重复，已重新生成 */
	| "duplicate-element-id"
	/** 页面 id 缺失或重复，已重新生成 */
	| "duplicate-page-id"
	/** 元素缺少 elementType，已丢弃 */
	| "missing-element-type"
	/** 不认识这个元素类型（会保留数据，但画布上不显示） */
	| "unknown-element-type"
	/** 文件版本比当前程序新 */
	| "future-version"
	/** 其它解析过程中修正的问题 */
	| "parse";

export interface ReportIssue {
	level: ReportIssueLevel;
	code: ReportIssueCode;
	message: string;
	/** 出问题的位置，例如 `pages[1].elements[0]` */
	path?: string;
}

export interface ReportValidation {
	/** 没有 error 级问题即为通过（warning 是"已自动修正"） */
	ok: boolean;
	/** 解析并修正后的文件；整体不可解析时为 null */
	file: ReportFile | null;
	issues: ReportIssue[];
}

/** 单条 warning 文本 → 稳定的 code。文案改了口径也不会影响调用方 */
function classifyWarning(message: string): ReportIssueCode {
	if (message.includes("reportId")) {
		return "missing-report-id";
	}
	if (message.includes("没有页面")) {
		return "missing-pages";
	}
	if (message.includes("元素 id")) {
		return "duplicate-element-id";
	}
	if (message.includes("页面 id")) {
		return "duplicate-page-id";
	}
	if (message.includes("elementType")) {
		return "missing-element-type";
	}
	if (message.includes("文件版本")) {
		return "future-version";
	}
	return "parse";
}

/** 校验已解析的结果：补上 parseReportFile 不关心的检查（未知元素类型） */
function inspect(file: ReportFile, warnings: string[]): ReportIssue[] {
	const issues: ReportIssue[] = warnings.map((message) => ({
		level: "warning",
		code: classifyWarning(message),
		message,
	}));

	const known = new Set(KNOWN_ELEMENT_TYPES);
	file.pages.forEach((page, pageIndex) => {
		page.elements.forEach((element, elementIndex) => {
			if (!known.has(element.elementType)) {
				issues.push({
					level: "warning",
					code: "unknown-element-type",
					message: `不认识元素类型「${element.elementType}」，数据保留但画布上不显示`,
					path: `pages[${pageIndex}].elements[${elementIndex}]`,
				});
			}
		});
	});

	return issues;
}

/** 校验任意来源的 JSON（字符串或对象） */
export function validateReportJson(raw: unknown): ReportValidation {
	let source: unknown = raw;
	if (typeof raw === "string") {
		try {
			source = JSON.parse(raw);
		} catch {
			return {
				ok: false,
				file: null,
				issues: [{ level: "error", code: "not-an-object", message: "不是合法的 JSON" }],
			};
		}
	}
	if (typeof source !== "object" || source === null || Array.isArray(source)) {
		return {
			ok: false,
			file: null,
			issues: [{ level: "error", code: "not-an-object", message: "报告内容不是对象" }],
		};
	}

	const result: ParseResult = parseReportFile(source);
	const issues = inspect(result.file, result.warnings);
	return {
		ok: issues.every((issue) => issue.level !== "error"),
		file: result.file,
		issues,
	};
}

/** 校验结果是否"完全干净"（连自动修正都没有） */
export function isClean(validation: ReportValidation): boolean {
	return validation.ok && validation.issues.length === 0;
}

/** 把问题列表压成一行摘要，给 toast 用 */
export function summarizeIssues(validation: ReportValidation, limit = 3): string {
	const messages = validation.issues.slice(0, limit).map((issue) => issue.message);
	const rest = validation.issues.length - messages.length;
	return rest > 0 ? `${messages.join("；")}… 还有 ${rest} 条` : messages.join("；");
}
