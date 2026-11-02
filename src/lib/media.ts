import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "@/components/ui/toast";
import type { FillSpec } from "@/store";
import { getCurrentReportDir, getCurrentReportRelativeDir, getCurrentReportRoot } from "./report-service";

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
 * 导入一张图片并返回可直接写进 JSON 的填充规格。
 *
 * 复制交给 Rust（`import_media`）：用户选的图片在 APPDATA 之外，fs 插件没有那个 scope；
 * 顺便在 Rust 里按内容算 hash 命名，天然的「同一张图只存一份」。
 */
export async function importImageFill(): Promise<FillSpec | null> {
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

/** 已解码的图片缓存：FillSpec 里存的是相对路径，运行时才换成真正的位图 */
const imageCache = new Map<string, HTMLImageElement>();
const pending = new Set<string>();

let onImageReady: () => void = () => {};

/** 图片加载完成后通知画布重绘 + 重算填充（由 use-selection 注册） */
export function setMediaImageListener(listener: () => void): void {
	onImageReady = listener;
}

async function loadMediaImage(source: string): Promise<HTMLImageElement> {
	// 图片可能是自定义目录里的文件，fs 插件读不到 —— 统一走 Rust 转成 data URL
	const root = await getCurrentReportRoot();
	const relative = `${await getCurrentReportRelativeDir()}/${source}`;
	const dataUrl = await invoke<string>("read_media_data_url", { root, relative });
	const image = new Image();
	image.src = dataUrl;
	await image.decode();
	return image;
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
	if (pending.has(source)) {
		return undefined;
	}
	pending.add(source);
	void loadMediaImage(source)
		.then((image) => {
			imageCache.set(source, image);
			onImageReady();
		})
		.catch((error) => {
			console.error("图片加载失败", source, error);
		})
		.finally(() => {
			pending.delete(source);
		});
	return undefined;
}
