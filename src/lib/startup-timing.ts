/**
 * 启动耗时打点。
 *
 * 目标：把「从页面开始加载到第一帧」这段时间拆开，看清楚到底慢在哪。
 * 只在调试期一直开着：开销是几次 performance.now()，可以忽略。
 *
 * 用法：
 *   const span = startSpan("open-report");
 *   ...
 *   span.end(`folder=${folder}`);
 *
 * 结果：
 * - 控制台：`[startup] 名称 123.4ms 细节`
 * - 启动 5 秒后自动 console.table 一份汇总
 * - 「关于」对话框里也能看到最近一次启动的打点
 */

export interface StartupSpan {
	name: string;
	/** 相对页面加载起点的毫秒数 */
	start: number;
	/** 持续毫秒；纯事件标记为 0 */
	duration: number;
	detail?: string;
}

export interface IpcStat {
	command: string;
	count: number;
	total: number;
	max: number;
}

/** 启动期间加载的资源（JS/CSS/字体），按耗时排序 */
export interface SlowResource {
	name: string;
	duration: number;
	size: number;
}

declare global {
	interface Window {
		__startupHtml?: number;
		__startupModuleBoot?: number;
	}
}

const spans: StartupSpan[] = [];
const ipcStats = new Map<string, IpcStat>();
const slowResources: SlowResource[] = [];
const ENABLED = true;
/** 控制台输出只在 dev 开：安装版不刷日志，数据仍可在「关于」里看 */
const LOG_ENABLED = import.meta.env.DEV;

function log(message: string) {
	if (!ENABLED || !LOG_ENABLED) {
		return;
	}
	console.info(message);
}

/** 记录一次异步/同步操作的耗时 */
export function startSpan(name: string): { end: (detail?: string) => void } {
	if (!ENABLED) {
		return { end: () => {} };
	}
	const start = performance.now();
	return {
		end(detail?: string) {
			const duration = performance.now() - start;
			spans.push({ name, start, duration, detail });
			log(`[startup] ${name} ${duration.toFixed(1)}ms${detail ? ` · ${detail}` : ""}`);
		},
	};
}

/** 纯事件标记（挂载、第一帧这种没有持续时间的点） */
export function markStartup(name: string, detail?: string): void {
	if (!ENABLED) {
		return;
	}
	const at = performance.now();
	spans.push({ name, start: at, duration: 0, detail });
	log(`[startup] ${name} @${at.toFixed(1)}ms${detail ? ` · ${detail}` : ""}`);
}

/** 记一次 IPC 调用（按命令聚合，不单独打 span，免得刷屏） */
export function recordIpc(command: string, duration: number): void {
	if (!ENABLED) {
		return;
	}
	const stat = ipcStats.get(command) ?? { command, count: 0, total: 0, max: 0 };
	stat.count += 1;
	stat.total += duration;
	stat.max = Math.max(stat.max, duration);
	ipcStats.set(command, stat);
}

export function getStartupSpans(): StartupSpan[] {
	return [...spans].sort((a, b) => a.start - b.start);
}

export function getIpcStats(): IpcStat[] {
	return [...ipcStats.values()].sort((a, b) => b.total - a.total);
}

export function getSlowResources(): SlowResource[] {
	return [...slowResources];
}

/** 主 bundle 之前的时间线：HTML 解析起点、module 启动点 */
function recordEarlyTimeline(): void {
	if (typeof window === "undefined") {
		return;
	}
	const htmlAt = window.__startupHtml;
	if (typeof htmlAt === "number") {
		spans.push({ name: "html-start", start: htmlAt, duration: 0, detail: "HTML 开始解析" });
	}
	const bootAt = window.__startupModuleBoot;
	if (typeof bootAt === "number") {
		spans.push({ name: "module-boot", start: bootAt, duration: 0, detail: "主 bundle 开始执行" });
	}
	// 主 bundle 执行完（本模块初始化）与 module-boot 的差值 ≈ 整个主包的加载+解析+执行
	spans.push({
		name: "main-bundle",
		start: typeof bootAt === "number" ? bootAt : 0,
		duration: performance.now() - (typeof bootAt === "number" ? bootAt : 0),
		detail: "主包加载/解析/执行",
	});
	const navigation = performance.getEntriesByType("navigation")[0] as
		| PerformanceNavigationTiming
		| undefined;
	if (navigation) {
		spans.push({
			name: "navigation",
			start: 0,
			duration: navigation.domContentLoadedEventEnd,
			detail: `responseEnd=${navigation.responseEnd.toFixed(0)}ms · DOMContentLoaded=${navigation.domContentLoadedEventEnd.toFixed(0)}ms`,
		});
	}
}

function collectResources(): void {
	if (typeof performance === "undefined") {
		return;
	}
	slowResources.length = 0;
	const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
	for (const entry of entries) {
		if (entry.duration < 1) {
			continue;
		}
		slowResources.push({
			name: entry.name.split("/").pop() || entry.name,
			duration: entry.duration,
			size: entry.transferSize || entry.encodedBodySize || 0,
		});
	}
	slowResources.sort((a, b) => b.duration - a.duration);
	slowResources.splice(12);
}

recordEarlyTimeline();

/** 启动 5 秒后打一份汇总（这时启动流程基本结束，不会和首屏抢控制台） */
if (ENABLED && typeof window !== "undefined") {
	window.setTimeout(() => collectResources(), 1500);
	window.setTimeout(() => {
		collectResources();
		if (!LOG_ENABLED) {
			return;
		}
		const rows = getStartupSpans().map((span) => ({
			名称: span.name,
			"开始(ms)": Number(span.start.toFixed(1)),
			"耗时(ms)": Number(span.duration.toFixed(1)),
			细节: span.detail ?? "",
		}));
		console.info("[startup] ===== 启动耗时汇总 =====");
		console.table(rows);
		console.table(getIpcStats());
		console.table(getSlowResources());
	}, 5000);
}
