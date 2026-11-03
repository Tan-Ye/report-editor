import { describe, expect, it } from "vitest";
import { isSamePath, normalizePath } from "@/lib/utils/path";

describe("normalizePath", () => {
	it("统一分隔符、去掉结尾分隔符、转小写", () => {
		expect(normalizePath("D:\\报表\\2026\\")).toBe("d:/报表/2026");
		expect(normalizePath("/Users/Me/Reports")).toBe("/users/me/reports");
	});

	it("多余的分隔符会被压掉", () => {
		expect(normalizePath("D:\\\\a\\\\b//")).toBe("d:/a/b");
	});
});

describe("isSamePath", () => {
	it("大小写和分隔符不同视为同一个路径（Windows 语义）", () => {
		expect(isSamePath("D:\\Reports\\A", "d:/reports/a")).toBe(true);
	});

	it("结尾多一个分隔符也算同一个", () => {
		expect(isSamePath("D:\\Reports\\A", "D:\\Reports\\A\\")).toBe(true);
	});

	it("不同路径不能相等", () => {
		expect(isSamePath("D:\\Reports\\A", "D:\\Reports\\B")).toBe(false);
	});
});
