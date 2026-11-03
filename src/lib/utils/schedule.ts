/**
 * 空闲调度。
 *
 * 把不着急的活（缩略图、图片预载这类）挪到浏览器空闲帧里做：
 * 直接同步跑会跟交互抢主线程，而它们晚几十毫秒没有任何影响。
 */
export function runWhenIdle(task: () => void): void {
	if (typeof window.requestIdleCallback === "function") {
		window.requestIdleCallback(() => task(), { timeout: 600 });
		return;
	}
	// 没有 requestIdleCallback 的环境退化成短延时
	window.setTimeout(task, 120);
}
