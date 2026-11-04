import { describe, expect, it } from "vitest";
import { isNewerVersion } from "@/lib/update-service";

describe("isNewerVersion", () => {
	it("相同版本不算更新", () => {
		expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
		expect(isNewerVersion("v0.2.0", "0.2.0")).toBe(false);
	});

	it("按数字比较而不是字符串（0.10.0 > 0.9.0）", () => {
		expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true);
		expect(isNewerVersion("0.9.0", "0.10.0")).toBe(false);
	});

	it("段数不同时缺的段按 0 算", () => {
		expect(isNewerVersion("1.0", "1.0.0")).toBe(false);
		expect(isNewerVersion("1.0.1", "1.0")).toBe(true);
	});

	it("带后缀的预发布版本按数字段处理", () => {
		expect(isNewerVersion("1.2.0", "1.2.0-beta.3")).toBe(false);
		expect(isNewerVersion("1.3.0-rc1", "1.2.9")).toBe(true);
	});

	it("前导 v 和空格不影响结果", () => {
		expect(isNewerVersion(" v0.3.0 ", "0.2.9")).toBe(true);
	});
});
