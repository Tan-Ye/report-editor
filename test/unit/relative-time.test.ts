import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "@/lib/utils";

describe("相对时间的说法", () => {
	const now = Date.now();
	const ago = (ms: number) => now - ms;

	it("一分钟内是「刚刚」", () => {
		expect(formatRelativeTime(ago(3_000))).toBe("刚刚");
	});

	it("一分钟到一小时按分钟", () => {
		expect(formatRelativeTime(ago(5 * 60_000))).toBe("5 分钟前");
	});

	it("超过一小时按小时", () => {
		expect(formatRelativeTime(ago(3 * 3_600_000))).toBe("3 小时前");
	});

	it("超过一天按天", () => {
		expect(formatRelativeTime(ago(2 * 86_400_000))).toBe("2 天前");
	});

	it("时间在未来（时钟回拨）也当成刚刚，不算出负数", () => {
		expect(formatRelativeTime(now + 60_000)).toBe("刚刚");
	});

	it("拿不到 mtime 时不假装知道时间", () => {
		expect(formatRelativeTime(0)).toBe("时间未知");
	});
});
