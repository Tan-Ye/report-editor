import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * 单测只跑**纯函数**，不碰 DOM 和 fabric。
 *
 * 这样不需要 jsdom / node-canvas 这类重依赖：
 * 被测模块（fill、report-file、report-path、utils）都不 import fabric。
 * 画布渲染那层留给"金标报告 + 离屏渲染"的集成测试以后再补。
 */
export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
	},
});
