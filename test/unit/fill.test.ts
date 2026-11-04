import { describe, expect, it } from "vitest";
import { normalizeFill } from "@/store/fill";

describe("normalizeFill", () => {
	it("纯色字符串转成 solid（兼容老格式）", () => {
		expect(normalizeFill("#ffffff")).toEqual({ kind: "solid", color: "#ffffff" });
	});

	it("空字符串当没填", () => {
		expect(normalizeFill("   ")).toBeUndefined();
	});

	it("新格式纯色原样保留", () => {
		expect(normalizeFill({ kind: "solid", color: "#123456" })).toEqual({
			kind: "solid",
			color: "#123456",
		});
	});

	it("渐变缺色标当没填", () => {
		expect(normalizeFill({ kind: "gradient", stops: [] })).toBeUndefined();
	});

	it("只有一个色标时补一个同色的，fabric 至少要两个", () => {
		const fill = normalizeFill({
			kind: "gradient",
			type: "linear",
			angle: 45,
			stops: [{ offset: 0, color: "#000000" }],
		});
		expect(fill).toEqual({
			kind: "gradient",
			type: "linear",
			angle: 45,
			stops: [
				{ offset: 0, color: "#000000", alpha: 1 },
				{ offset: 1, color: "#000000", alpha: 1 },
			],
		});
	});

	it("色标的位置和透明度会被夹到 0~1", () => {
		const fill = normalizeFill({
			kind: "gradient",
			stops: [
				{ offset: -1, color: "#000000", alpha: 5 },
				{ offset: 3, color: "#ffffff", alpha: -2 },
			],
		});
		expect(fill).toMatchObject({
			stops: [
				{ offset: 0, alpha: 1 },
				{ offset: 1, alpha: 0 },
			],
		});
	});

	it("图片填充需要 source，非法 fit 落回 original", () => {
		expect(normalizeFill({ kind: "image", source: "" })).toBeUndefined();
		expect(normalizeFill({ kind: "image", source: "media/a.png", fit: "stretch" })).toEqual({
			kind: "image",
			source: "media/a.png",
			fit: "original",
		});
	});

	it("旧版渐变对象（coords 坐标）换算成角度", () => {
		// 从左到右：dx=1 dy=0 → 0°
		expect(
			normalizeFill({
				type: "linear",
				coords: { x1: 0, y1: 0, x2: 1, y2: 0 },
				colorStops: [
					{ offset: 0, color: "#000000" },
					{ offset: 1, color: "#ffffff" },
				],
			}),
		).toMatchObject({ kind: "gradient", angle: 0 });

		// 从上到下：dy=1 → 90°
		expect(
			normalizeFill({
				type: "linear",
				coords: { x1: 0, y1: 0, x2: 0, y2: 1 },
				colorStops: [
					{ offset: 0, color: "#000000" },
					{ offset: 1, color: "#ffffff" },
				],
			}),
		).toMatchObject({ kind: "gradient", angle: 90 });
	});

	it("认不出来的值一律 undefined，不抛错", () => {
		expect(normalizeFill(null)).toBeUndefined();
		expect(normalizeFill(42)).toBeUndefined();
		expect(normalizeFill([])).toBeUndefined();
		expect(normalizeFill({ kind: "unknown" })).toBeUndefined();
	});
});

describe("图片裁剪字段", () => {
	it("合法的 crop 原样保留", () => {
		expect(
			normalizeFill({
				kind: "image",
				source: "media/a.png",
				fit: "cover",
				crop: { x: 10, y: 20, width: 300, height: 200 },
			}),
		).toEqual({
			kind: "image",
			source: "media/a.png",
			fit: "cover",
			crop: { x: 10, y: 20, width: 300, height: 200 },
		});
	});

	it("宽高不是正数的 crop 直接丢掉（按整图处理）", () => {
		expect(
			normalizeFill({
				kind: "image",
				source: "media/a.png",
				fit: "cover",
				crop: { x: 0, y: 0, width: 0, height: 10 },
			}),
		).toEqual({ kind: "image", source: "media/a.png", fit: "cover" });
	});

	it("负数坐标夹到 0，小数取整", () => {
		expect(
			normalizeFill({
				kind: "image",
				source: "media/a.png",
				fit: "original",
				crop: { x: -5.4, y: 3.6, width: 100.2, height: 80.5 },
			}),
		).toMatchObject({ crop: { x: 0, y: 4, width: 100, height: 81 } });
	});
});
