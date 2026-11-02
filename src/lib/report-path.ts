/**
 * 报告在磁盘上的路径拼装。
 * 纯函数，不做任何 IO —— 这样路径规则可以单独验证，也方便以后换存储位置。
 *
 * 磁盘结构（data 与 cache 完全一致，保存时整目录迁移即可，JSON 不用改）：
 *
 *   <根目录>/
 *   ├── data/<报告目录>/report.json
 *   ├── data/<报告目录>/media/<hash>.<ext>
 *   ├── cache/<报告目录>/report.json      ← 未保存的草稿
 *   └── cache/<报告目录>/media/…
 */

/** 报告数据的存放区：已保存的进 data，草稿留在 cache */
export type ReportArea = "data" | "cache";

export const REPORT_FILE_NAME = "report.json";
export const REPORT_MEDIA_DIR = "media";
/** 原子写用的临时后缀 */
export const REPORT_TEMP_SUFFIX = ".tmp";

/** Windows 非法字符 + 控制字符 */
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;
/** Windows 保留设备名，不能直接当目录名 */
const WINDOWS_RESERVED_NAMES =
	/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** 目录名里报告名部分的最大长度，留出 id 和路径前缀的余量（Windows 260 字符限制） */
const MAX_NAME_LENGTH = 60;

/**
 * 把报告名清理成可以当目录名的片段。
 * 去非法字符、首尾空白和结尾的点；Windows 保留名一律视为不可用。
 */
export function sanitizeFolderName(name: string): string {
	const cleaned = name
		.replace(INVALID_FILENAME_CHARS, "")
		.trim()
		.replace(/[.\s]+$/, "")
		.slice(0, MAX_NAME_LENGTH)
		.trim();

	if (!cleaned || WINDOWS_RESERVED_NAMES.test(cleaned)) {
		return "";
	}
	return cleaned;
}

/**
 * 报告目录名：`<清理后的名字>-<id>`。
 * 名字不合法时只留 id —— 目录名只是给人看的标签，查找永远靠 JSON 里的 reportId。
 */
export function getReportFolderName(reportName: string, reportId: string): string {
	const safeName = sanitizeFolderName(reportName);
	return safeName ? `${safeName}-${reportId}` : reportId;
}

/** 报告目录相对存储区的路径，例如 `data/未命名报告-8f3a…` */
export function getReportDir(area: ReportArea, reportName: string, reportId: string): string {
	return `${area}/${getReportFolderName(reportName, reportId)}`;
}

/** report.json 的相对路径 */
export function getReportJsonPath(area: ReportArea, reportName: string, reportId: string): string {
	return `${getReportDir(area, reportName, reportId)}/${REPORT_FILE_NAME}`;
}

/** 原子写用的临时文件路径 */
export function getReportTempPath(area: ReportArea, reportName: string, reportId: string): string {
	return `${getReportJsonPath(area, reportName, reportId)}${REPORT_TEMP_SUFFIX}`;
}

/** media 目录的相对路径 */
export function getReportMediaDir(area: ReportArea, reportName: string, reportId: string): string {
	return `${getReportDir(area, reportName, reportId)}/${REPORT_MEDIA_DIR}`;
}

/** media 下某个文件的相对路径（文件名按内容 hash 生成，天然短且去重） */
export function getReportMediaPath(
	area: ReportArea,
	reportName: string,
	reportId: string,
	fileName: string,
): string {
	return `${getReportMediaDir(area, reportName, reportId)}/${fileName}`;
}

/** JSON 里引用的媒体路径：始终是相对报告目录的 `media/xxx`，迁移时不用改写 */
export function toMediaReference(fileName: string): string {
	return `${REPORT_MEDIA_DIR}/${fileName}`;
}
