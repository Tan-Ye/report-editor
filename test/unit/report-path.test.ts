import { describe, expect, it } from "vitest";
import {
	getReportFolderName,
	getReportJsonPath,
	getReportMediaPath,
	sanitizeFolderName,
	toMediaReference,
} from "@/lib/report/path";

describe("sanitizeFolderName", () => {
	it("去掉 Windows 非法字符", () => {
		expect(sanitizeFolderName('a/b\\c:d*e?f"g<h>i|j')).toBe("abcdefghij");
	});

	it("去掉首尾空白和结尾的点", () => {
		expect(sanitizeFolderName("  季度报告... ")).toBe("季度报告");
	});

	it("长度截断到 60 个字符", () => {
		expect(sanitizeFolderName("报".repeat(200))).toHaveLength(60);
	});

	it("Windows 保留名视为不可用", () => {
		expect(sanitizeFolderName("CON")).toBe("");
		expect(sanitizeFolderName("lpt1")).toBe("");
	});

	it("全是非法字符时返回空串", () => {
		expect(sanitizeFolderName("///")).toBe("");
		expect(sanitizeFolderName("   ")).toBe("");
	});
});

describe("getReportFolderName", () => {
	it("正常名字：名字 + id", () => {
		expect(getReportFolderName("季度报告", "abc123")).toBe("季度报告-abc123");
	});

	it("名字不可用时只留 id（查找永远靠 JSON 里的 reportId）", () => {
		expect(getReportFolderName("CON", "abc123")).toBe("abc123");
		expect(getReportFolderName("", "abc123")).toBe("abc123");
	});
});

describe("路径拼装", () => {
	it("JSON 与 media 都在报告目录下，区域用 data / cache", () => {
		expect(getReportJsonPath("data", "报告", "id1")).toBe("data/报告-id1/report.json");
		expect(getReportJsonPath("cache", "报告", "id1")).toBe("cache/报告-id1/report.json");
		expect(getReportMediaPath("data", "报告", "id1", "a.png")).toBe(
			"data/报告-id1/media/a.png",
		);
	});

	it("JSON 里引用的媒体路径始终相对报告目录，换目录不用改写", () => {
		expect(toMediaReference("a.png")).toBe("media/a.png");
	});
});
