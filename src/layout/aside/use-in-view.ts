import { useEffect, useState } from "react";
import type { RefObject } from "react";

/**
 * 元素是否进入视口（含预加载边距）。
 * 侧栏缩略图靠它做懒加载：滚到附近才渲染，页数多也不会一次性把主线程占满。
 */
export function useInView(ref: RefObject<Element | null>, rootMargin = "200px"): boolean {
	const [inView, setInView] = useState(false);

	useEffect(() => {
		const element = ref.current;
		if (!element) {
			return;
		}
		// 不支持的環境就当它一直可见：等价于「立即加载」，功能不能因此失效
		if (typeof IntersectionObserver === "undefined") {
			setInView(true);
			return;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				setInView(entries.some((entry) => entry.isIntersecting));
			},
			{ rootMargin },
		);
		observer.observe(element);

		return () => {
			observer.disconnect();
		};
	}, [ref, rootMargin]);

	return inView;
}
