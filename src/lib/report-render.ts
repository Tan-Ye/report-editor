import type { ReportFile } from "@/store/schema";
import { collectImageSources, ensureMediaImages, setMediaBase } from "./media";
import { renderPageImage, type RenderPageOptions } from "./page-image";

/**
 * 无头渲染：把一份报告渲染成图片，**不依赖编辑器的任何状态**。
 *
 * 和导出的区别只在数据来源：导出读的是 store 里的当前文档，这里读的是传进来的
 * `ReportFile` —— 所以它能渲染"磁盘上任意一份报告"（以后 agent 写完 JSON，
 * 渲染出来自己看一眼，靠的就是这个入口）。
 *
 * 图片解析：`setMediaBase` 把媒体根临时指到目标报告目录，渲染完复位。
 * 文件名是按内容 hash 生成的，两份报告的 media 不会互相串。
 */
export interface ReportMediaBase {
	/** 数据目录根（绝对路径） */
	root: string;
	/** 报告目录相对 root 的路径，例如 `data/季度报告-abc123` */
	relative: string;
}

export async function renderReportPages(
	file: ReportFile,
	base: ReportMediaBase,
	options: RenderPageOptions,
): Promise<string[]> {
	setMediaBase(base);
	try {
		// 离屏渲染是同步的：图片必须先解码完，否则图里会缺内容
		await ensureMediaImages(file.pages.flatMap((page) => collectImageSources([page])));
		return file.pages.map((page, index) => {
			const url = renderPageImage(page, options);
			if (!url) {
				throw new Error(`第 ${index + 1} 页渲染失败`);
			}
			return url;
		});
	} finally {
		setMediaBase(null);
	}
}
