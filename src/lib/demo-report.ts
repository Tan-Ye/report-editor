import { baseHeight, baseWidth } from "@/base";
import { addElement, addPage, setPageFill } from "./report-commands";

/**
 * 示例演示：一步一步往画布上放东西。
 *
 * 和"一次画完"的区别在**可读性**——用户是来看"这东西能做什么"的，
 * 一口气全出现反而看不出每步做了什么。所以：
 *
 * - 每步之间等 `stepDelay`，画布逐步长出来
 * - 执行期间调用方负责锁画布（用户不能操作）
 * - 支持中止：`signal.aborted` 为 true 就停下，已画的保留
 * - **整场只占一步撤销**：调用方用 `setHistorySuppressed(true)` 包住，
 *   结束时补一次 `commitHistoryNow()`（见 `use-demo-runner.ts`）
 */

export interface DemoStep {
	/** 显示给用户看的动作描述 */
	label: string;
	run: () => void;
}

export interface DemoRunResult {
	pageId?: string;
	/** 实际画上去的元素数（中途停止时小于计划值） */
	elementCount: number;
	/** 是否被用户中止 */
	stopped: boolean;
}

const CARD = { fill: "#ffffff", text: "#1f2937", muted: "#6b7280", accent: "#2563eb" };
const MARGIN = 120;

/** 把整页拆成若干步：粒度按"视觉上能看出来变化"划分 */
export function buildDemoSteps(): DemoStep[] {
	const contentWidth = baseWidth - MARGIN * 2;
	const gap = 40;
	const cardWidth = Math.floor((contentWidth - gap * 2) / 3);
	const metrics = [
		{ label: "营业收入", value: "1.82 亿", delta: "+12.4% 同比" },
		{ label: "毛利率", value: "38.6%", delta: "+2.1pp 同比" },
		{ label: "回款率", value: "92.3%", delta: "-0.8pp 同比" },
	];

	const steps: DemoStep[] = [];

	// 1. 新开一页
	steps.push({
		label: "新建页面",
		run: () => {
			addPage({ name: "示例：经营分析" });
		},
	});

	// 需要 pageId 的地方改成"取当前页"——每步都作用在刚建的那页上
	steps.push({
		label: "铺背景",
		run: () => {
			setPageFill({ fill: "#f5f6f8" });
		},
	});

	steps.push({
		label: "写标题",
		run: () => {
			addElement({
				elementType: "text",
				attrs: {
					left: MARGIN,
					top: 96,
					width: contentWidth,
					text: "2026 年第三季度经营分析",
					fontSize: 64,
					fontWeight: "700",
					fill: CARD.text,
				},
			});
			addElement({
				elementType: "text",
				attrs: {
					left: MARGIN,
					top: 186,
					width: contentWidth,
					text: "数据截至 2026-09-30 ｜ 财务中心",
					fontSize: 24,
					fill: CARD.muted,
				},
			});
			addElement({
				elementType: "rect",
				attrs: { left: MARGIN, top: 246, width: contentWidth, height: 2, fill: "#d1d5db" },
			});
		},
	});

	// 2. 三张卡片，一张一步（能看出"一张张出现"）
	metrics.forEach((metric, index) => {
		const left = MARGIN + index * (cardWidth + gap);
		steps.push({
			label: `数据卡片 ${index + 1}：${metric.label}`,
			run: () => {
				addElement({
					elementType: "rect",
					attrs: { left, top: 320, width: cardWidth, height: 240, fill: CARD.fill },
				});
				addElement({
					elementType: "text",
					attrs: {
						left: left + 32,
						top: 352,
						width: cardWidth - 64,
						text: metric.label,
						fontSize: 22,
						fill: CARD.muted,
					},
				});
				addElement({
					elementType: "text",
					attrs: {
						left: left + 32,
						top: 396,
						width: cardWidth - 64,
						text: metric.value,
						fontSize: 52,
						fontWeight: "700",
						fill: CARD.text,
					},
				});
				addElement({
					elementType: "text",
					attrs: {
						left: left + 32,
						top: 476,
						width: cardWidth - 64,
						text: metric.delta,
						fontSize: 20,
						fill: CARD.accent,
					},
				});
			},
		});
	});

	// 3. 结论 + 页脚
	steps.push({
		label: "写结论",
		run: () => {
			addElement({
				elementType: "rect",
				attrs: { left: MARGIN, top: 620, width: 6, height: 132, fill: CARD.accent },
			});
			addElement({
				elementType: "text",
				attrs: {
					left: MARGIN + 28,
					top: 620,
					width: contentWidth - 28,
					text: "整体达成全年目标的 74%，四季度需重点提升回款质量。",
					fontSize: 26,
					fill: CARD.text,
				},
			});
		},
	});

	steps.push({
		label: "收尾",
		run: () => {
			addElement({
				elementType: "text",
				attrs: {
					left: MARGIN,
					top: baseHeight - 88,
					width: contentWidth,
					text: "内部资料 · 请勿外传",
					fontSize: 18,
					fill: "#9ca3af",
				},
			});
		},
	});

	return steps;
}

/** 当前页元素数（演示过程中用来统计） */
export function countElements(page: { elements: unknown[] } | undefined): number {
	return page?.elements.length ?? 0;
}

/** 等一会儿，可被中止（中止时立刻 resolve，不抛异常） */
function wait(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * 跑完整场演示。
 *
 * `onStep` 每步开始时回调（界面显示"正在做什么"）；`signal` 中止后
 * 立刻停下并把已画的部分留着，由调用方补历史记录。
 */
export async function runDemoReport(options: {
	signal: AbortSignal;
	onStep?: (step: DemoStep, index: number, total: number) => void;
	stepDelay?: number;
	getElementCount: () => number;
}): Promise<DemoRunResult> {
	const steps = buildDemoSteps();
	const delay = options.stepDelay ?? 420;

	for (let index = 0; index < steps.length; index += 1) {
		if (options.signal.aborted) {
			break;
		}
		options.onStep?.(steps[index], index, steps.length);
		steps[index].run();
		await wait(delay, options.signal);
	}

	return {
		elementCount: options.getElementCount(),
		stopped: options.signal.aborted,
	};
}
