import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "@/components/ui/toast";
import { runWhenIdle } from "@/lib/utils";
import type { FillSpec, PageInfo } from "@/store";
import { getCurrentReportDir, getCurrentReportRelativeDir, getCurrentReportRoot } from "./report/service";
import { recordIpc, startSpan } from "./startup-timing";

/** 支持导入的图片类型（和 Rust 侧的白名单保持一致） */
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

/** 让用户选一张图；取消返回 null */
export async function pickImageFile(): Promise<string | null> {
	const selected = await open({
		multiple: false,
		directory: false,
		filters: [{ name: "图片", extensions: IMAGE_EXTENSIONS }],
	});
	return typeof selected === "string" ? selected : null;
}

/**
 * 让用户选一张图、复制进报告目录，返回可直接写进 JSON 的填充规格。
 *
 * 复制交给 Rust（`import_media`）：用户选的图片在 APPDATA 之外，fs 插件没有那个 scope；
 * 顺便在 Rust 里按内容算 hash 命名，天然的「同一张图只存一份」。
 */
async function importPickedImage(): Promise<FillSpec | null> {
	const source = await pickImageFile();
	if (!source) {
		return null;
	}
	try {
		const dir = await getCurrentReportDir();
		const fileName = await invoke<string>("import_media", { dir, source });
		return { kind: "image", source: `media/${fileName}`, fit: "cover" };
	} catch (error) {
		toast.add({
			title: "导入图片失败",
			description: error instanceof Error ? error.message : String(error),
			type: "error",
		});
		return null;
	}
}

/** 给「填充」用：只要规格 */
export function importImageFill(): Promise<FillSpec | null> {
	return importPickedImage();
}

export interface ImportedImage {
	fill: FillSpec;
	/** 图片原始像素尺寸，用来决定插入元素的宽高比 */
	width: number;
	height: number;
}

/**
 * 给「图片元素」用：除了规格还要原始尺寸。
 * 顺便把图等进缓存 —— 插进画布的那一刻就能看见，不会先闪一下占位色。
 */
export async function importImageFile(): Promise<ImportedImage | null> {
	const fill = await importPickedImage();
	if (!fill || fill.kind !== "image") {
		return null;
	}
	await ensureMediaImages([fill.source]);
	const image = getMediaImage(fill.source);
	return {
		fill,
		width: image?.naturalWidth || 16,
		height: image?.naturalHeight || 9,
	};
}

/** 已解码的图片缓存：FillSpec 里存的是相对路径，运行时才换成真正的位图 */
const imageCache = new Map<string, HTMLImageElement>();
/** 正在加载的请求：同一个 source 只发一次，也用来让调用方 await */
const loading = new Map<string, Promise<void>>();

/**
 * 媒体根目录覆盖。
 *
 * 平时图片从「当前打开的报告」里读；无头渲染要渲染**任意一份**报告，
 * 不能依赖编辑器当前状态，所以先把它指到目标报告目录，渲染完再清掉。
 * 文件名是按内容 hash 生成的，所以两份报告的 media 不会串。
 */
let mediaBase: { root: string; relative: string } | null = null;

export function setMediaBase(base: { root: string; relative: string } | null): void {
	mediaBase = base;
}

let onImageReady: () => void = () => {};

/** 图片加载完成后通知画布重绘 + 重算填充（由 use-selection 注册） */
export function setMediaImageListener(listener: () => void): void {
	onImageReady = listener;
}

/**
 * 合并同一帧内的多次"图片就绪"通知。
 * 后台预载会连续加载十几张图，每张都重算一遍填充太浪费。
 */
let readyScheduled = false;

function notifyImageReady(): void {
	if (readyScheduled) {
		return;
	}
	readyScheduled = true;
	requestAnimationFrame(() => {
		readyScheduled = false;
		onImageReady();
	});
}

async function loadMediaImage(source: string): Promise<HTMLImageElement> {
	const span = startSpan("media-image");
	// 图片可能是自定义目录里的文件，fs 插件读不到 —— 统一走 Rust 转成 data URL
	const base = mediaBase ?? {
		root: await getCurrentReportRoot(),
		relative: await getCurrentReportRelativeDir(),
	};
	const ipcStart = performance.now();
	const dataUrl = await invoke<string>("read_media_data_url", {
		root: base.root,
		relative: `${base.relative}/${source}`,
	}).finally(() => recordIpc("read_media_data_url", performance.now() - ipcStart));
	const image = new Image();
	image.src = dataUrl;
	await image.decode();
	span.end(`${source.replace(/^media\//, "")} · ${Math.round(dataUrl.length / 1024)}KB`);
	return image;
}

/**
 * 从页面里收集所有图片填充的 source（元素 + 页面背景）。
 * 打开文档预载、渲染缩略图之前都要用它。
 */
export function collectImageSources(pages: readonly PageInfo[]): string[] {
	const sources = new Set<string>();
	const add = (fill: unknown) => {
		if (typeof fill !== "object" || fill === null) {
			return;
		}
		const spec = fill as { kind?: unknown; source?: unknown };
		if (spec.kind === "image" && typeof spec.source === "string" && spec.source) {
			sources.add(spec.source);
		}
	};
	for (const page of pages) {
		add(page.style?.fill);
		for (const element of page.elements) {
			add(element.attrs.fill);
		}
	}
	return [...sources];
}

/**
 * 预载队列，分两档：
 *
 * - `inserted`：新插入的图。用户刚贴上去就等着看效果，下一帧就得加载
 * - `background`：文档里其它页的图。一次空闲帧加载一张，不抢主线程
 *
 * 当前页的图和侧栏可见页的图**不进队列**，由主画布/缩略图按需立即请求 ——
 * 它们本来就比后台预载更急。
 */
const insertedQueue: string[] = [];
const backgroundQueue: string[] = [];
let preloadScheduled = false;

/**
 * 把图片排进预载队列。
 *
 * `inserted: true` 插队（文档内新插入的图），默认排到队尾（打开文档时的预载）。
 */
export function preloadMediaImages(
	sources: string[],
	options: { inserted?: boolean } = {},
): void {
	const queue = options.inserted ? insertedQueue : backgroundQueue;
	let queued = false;
	for (const source of sources) {
		if (
			imageCache.has(source) ||
			loading.has(source) ||
			insertedQueue.includes(source) ||
			backgroundQueue.includes(source)
		) {
			continue;
		}
		queue.push(source);
		queued = true;
	}
	if (queued) {
		schedulePreload();
	}
}

function schedulePreload(): void {
	if (preloadScheduled) {
		return;
	}
	preloadScheduled = true;
	runWhenIdle(() => {
		preloadScheduled = false;
		// 插队的先来：新插入的图比文档里其它页的图更急
		const next = insertedQueue.shift() ?? backgroundQueue.shift();
		if (!next) {
			return;
		}
		// 排队期间可能已经被主画布/缩略图加载过了，别重复读
		if (!imageCache.has(next) && !loading.has(next)) {
			loadMediaImage(next)
				.then((image) => {
					imageCache.set(next, image);
					notifyImageReady();
				})
				.catch((error) => {
					console.error("图片预载失败", next, error);
				});
		}
		if (insertedQueue.length > 0 || backgroundQueue.length > 0) {
			schedulePreload();
		}
	});
}

/**
 * 同步取已解码的图片；没加载过就顺手发起加载并返回 undefined。
 *
 * 填充的转换链路是同步的（建对象、渲染缩略图都在同步流程里），
 * 所以第一次拿不到图时先留空，等加载完由监听回调重新应用一次填充。
 */
export function getMediaImage(source: string): HTMLImageElement | undefined {
	const cached = imageCache.get(source);
	if (cached) {
		return cached;
	}
	if (!loading.has(source)) {
		const task = loadMediaImage(source)
			.then((image) => {
				imageCache.set(source, image);
				notifyImageReady();
			})
			.catch((error) => {
				console.error("图片加载失败", source, error);
			})
			.finally(() => {
				loading.delete(source);
			});
		loading.set(source, task);
	}
	return undefined;
}

/**
 * 等这些图片全部落地（没加载过的会顺手发起加载）。
 *
 * 缩略图是离屏同步渲染的，而图片要过 IPC 读文件 + decode；
 * 不先等一下，从没被打开过的页面在侧栏里就会缺图。
 */
export async function ensureMediaImages(sources: string[]): Promise<void> {
	const span = startSpan("media-ensure");
	const tasks: Promise<void>[] = [];
	for (const source of sources) {
		if (imageCache.has(source)) {
			continue;
		}
		// 先发起加载，再拿到它的 Promise
		getMediaImage(source);
		const task = loading.get(source);
		if (task) {
			tasks.push(task);
		}
	}
	await Promise.all(tasks);
	span.end(`${sources.length} 张，新请求 ${tasks.length} 张`);
}
