import * as fabric from "fabric";
import { baseHeight, baseWidth } from "@/base";
import { pageStore, thumbnailStore, type PageInfo } from "@/store";
import { buildElementObject, toFabricPaint } from "./element-registry";
import { getReportPalette } from "./theme-tokens";

/** 缩略图输出宽度（像素）：侧栏显示约 160px，取 2× 让高清屏不糊 */
const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_QUALITY = 0.72;

/**
 * 从主画布抓当前页。
 *
 * 裁剪框取「页面在屏幕上的矩形」（viewportTransform 的 tx/ty + 页宽×zoom），
 * 所以放大、平移之后一样能抓到整页，页面外的元素也会被裁掉 —— 缩略图只放绘制区。
 * 代价只跟输出尺寸有关，zoom 再大也不会渲染更大。
 */
export function captureCurrentPageThumbnail(canvas: fabric.Canvas): string | null {
	const viewport = canvas.viewportTransform;
	if (!viewport) {
		return null;
	}
	const zoom = viewport[0];
	if (!zoom) {
		return null;
	}

	const width = baseWidth * zoom;
	const height = baseHeight * zoom;

	return canvas.toDataURL({
		format: "jpeg",
		quality: THUMBNAIL_QUALITY,
		multiplier: THUMBNAIL_WIDTH / width,
		left: viewport[4],
		top: viewport[5],
		width,
		height,
	});
}

/**
 * 离屏渲染某一页的缩略图。
 *
 * 这是整个缩略图功能里唯一「重」的地方：一页几十个元素大约 10–30ms。
 * 如果以后报告大到这一步明显卡顿，把它换成 `invoke("render_page_thumbnail", ...)`
 * 交给 Rust 渲染即可 —— 调用方只认这个函数签名，不用动别处。
 */
export function renderPageThumbnail(page: PageInfo): string | null {
	// 既没元素也没背景色 = 一张白纸，不生成：侧栏的白框已经能表达「这页什么都没有」
	if (page.elements.length === 0 && !page.style?.fill) {
		return null;
	}

	const offscreen = new fabric.StaticCanvas(undefined, {
		width: baseWidth,
		height: baseHeight,
		// 背景色要自己铺：离屏画布里没有主画布那个白页对象
		backgroundColor: (toFabricPaint(page.style?.fill, { width: baseWidth, height: baseHeight }) ??
			getReportPalette().pageFill) as never,
		enableRetinaScaling: false,
	});

	for (const info of page.elements) {
		// 注意用不登记的构建函数，别把主画布的 id → 对象表污染成离屏对象
		const object = buildElementObject(info);
		if (object) {
			offscreen.add(object);
		}
	}

	const url = offscreen.toDataURL({
		format: "jpeg",
		quality: THUMBNAIL_QUALITY,
		multiplier: THUMBNAIL_WIDTH / baseWidth,
		left: 0,
		top: 0,
		width: baseWidth,
		height: baseHeight,
	});

	void offscreen.dispose();
	return url;
}

/** 待渲染队列：只在侧栏滚到可见时才进队。存 pageId 不存快照 —— 排队期间数据可能又变了 */
const queue: string[] = [];
let scheduled = false;

/** 空闲时跑活；没有 requestIdleCallback 的环境退化成短延时 */
function runWhenIdle(task: () => void) {
	if (typeof window.requestIdleCallback === "function") {
		window.requestIdleCallback(() => task(), { timeout: 600 });
		return;
	}
	window.setTimeout(task, 120);
}

/**
 * 请求某一页的缩略图。
 * 已经是最新的、或已经在队列里，都会直接跳过 —— 调用方可以每次渲染都无脑调。
 */
export function requestPageThumbnail(page: PageInfo): void {
	if (thumbnailStore.isFresh(page.pageId, page)) {
		return;
	}
	if (queue.includes(page.pageId)) {
		return;
	}
	queue.push(page.pageId);
	scheduleFlush();
}

/** 页面被删掉时把它从队列里摘掉，免得给已经不存在的页渲染 */
export function cancelPageThumbnail(pageId: string): void {
	const index = queue.indexOf(pageId);
	if (index >= 0) {
		queue.splice(index, 1);
	}
}

function scheduleFlush() {
	if (scheduled) {
		return;
	}
	scheduled = true;
	// 一次空闲只做一页：整批塞进去会把主线程占满，交互就不跟手了
	runWhenIdle(flush);
}

function flush() {
	scheduled = false;
	const pageId = queue.shift();
	if (!pageId) {
		return;
	}

	// 排队期间这一页可能被改过、甚至被删了，所以在这里重新取一次最新数据
	const page = pageStore.getPages().find((item) => item.pageId === pageId);
	if (page) {
		if (page.elements.length === 0 && !page.style?.fill) {
			// 变空了：撤掉旧图，别让已经不存在的画面留在侧栏
			thumbnailStore.delete(page.pageId);
		} else if (!thumbnailStore.isFresh(page.pageId, page)) {
			const url = renderPageThumbnail(page);
			if (url) {
				thumbnailStore.set(page.pageId, url, page);
			}
		}
	}

	if (queue.length > 0) {
		scheduleFlush();
	}
}
