import type { ElementInfo } from "./element";
import type { PageInfo } from "./page";

/** 文件格式版本：结构变化时递增，读取时用它决定要不要迁移 */
export const REPORT_FILE_VERSION = 1;

/**
 * 落盘的元素形态。与 store 里的 ElementInfo 是同一个类型 ——
 * 读写都不做字段转换，JSON.parse 的结果可以直接进 store。
 */
export type ReportElementFile = ElementInfo;

/** 落盘的页面形态，与 store 里的 PageInfo 一致 */
export type ReportPageFile = PageInfo;

/**
 * 一个报告 = 一个 JSON 文件，结构对应 store 的三个 store：
 * report（报告信息）/ page（页面）/ element（元素）。
 * 页面尺寸随文件保存，保证文件自描述，不依赖运行时常量。
 */
export interface ReportFile {
	/** 文件格式版本 */
	version: number;
	reportId: string;
	reportName: string;
	pageWidth: number;
	pageHeight: number;
	/** 数组顺序即页面顺序 */
	pages: ReportPageFile[];
}
