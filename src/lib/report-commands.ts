import { baseHeight, baseWidth } from "@/base";
import {
	BRUSH_ELEMENT_TYPE,
	IMAGE_ELEMENT_TYPE,
	KNOWN_ELEMENT_TYPES,
	TEXT_ELEMENT_TYPE,
} from "@/base/elements";
import { createUniqueId } from "@/lib/utils";
import {
	historyStore,
	normalizeFill,
	pageStore,
	reportStore,
	type ElementAttrs,
	type ElementInfo,
	type PageGuide,
	type PageInfo,
	type PageStyle,
} from "@/store";
import { collectImageSources, ensureMediaImages } from "./media";
import { renderPageImage } from "./page-image";

/**
 * 文档命令层：给 agent（以及以后的批处理、脚本）用的**程序化改文档**入口。
 *
 * 和 UI 操作的区别只有一个方向：UI 是"画布改完写回 store"，
 * 这里是"直接改 store，再让画布重载"。所以有个硬约束：
 *
 * ⚠️ 所有变更都必须经过 `pageStore.replacePages()` —— 它是唯一会 bump `revision`
 * 的入口，`use-page` 靠它重载画布。直接调 `updateElementInCurrentPage` 之类
 * 不会 bump revision，画布上看不到任何变化。
 *
 * 另外：**一个命令 = 一步撤销**，失败不留痕（先算新状态，成功了才写 store）。
 */

export interface CommandResult {
	ok: boolean;
	/** 给模型看的说明，用中文写清楚"做了什么/为什么失败" */
	message: string;
	/** 结构化结果，便于调用方继续操作（例如新元素 id） */
	data?: Record<string, unknown>;
}

const fail = (message: string): CommandResult => ({ ok: false, message });

/**
 * 批量执行期的"工作副本"。
 *
 * 为什么需要：一个命令 = 一次 `replacePages`（整页重载）+ 一步历史。
 * agent 连续加 5 个元素就会重载 5 次、占 5 步撤销，既慢又闪。
 * 批量模式下所有命令只改这个副本，退出时统一写一次 store、记一步历史。
 *
 * 失败（抛异常）时直接丢弃副本，store 一点没动 —— 半成品不会落进文档。
 */
let workingState: { pages: PageInfo[]; current: number; dirty: boolean } | null = null;

/** 读页面集合：批量执行期读工作副本，否则读 store */
function readPages(): PageInfo[] {
	return workingState?.pages ?? pageStore.getPages();
}

function currentIndex(): number {
	return workingState?.current ?? pageStore.state.current;
}

/** 当前页面集合，深拷贝一层数组（页面对象本身是不可变更新的） */
function pagesOf(): PageInfo[] {
	return [...readPages()];
}

/** 按 id 找页面；不传就是当前页 */
function resolvePage(pageId?: string): { page: PageInfo; index: number } | null {
	const pages = readPages();
	const index = pageId ? pages.findIndex((item) => item.pageId === pageId) : currentIndex();
	if (index < 0 || index >= pages.length) {
		return null;
	}
	return { page: pages[index], index };
}

/**
 * 写回页面集合并记一步历史。
 * replacePages 会 bump revision → use-page 重载画布 → agent 的改动立刻可见。
 */
function commitPages(nextPages: PageInfo[], current = currentIndex()): void {
	if (workingState) {
		workingState = { pages: nextPages, current, dirty: true };
		return;
	}
	pageStore.replacePages(nextPages, current);
	historyStore.commit();
}

/**
 * 批量执行：内部所有命令合并成**一次重载 + 一步撤销**。
 *
 * ```ts
 * batchCommands(() => {
 *   addElement({ elementType: "text", attrs: { text: "标题" } });
 *   addElement({ elementType: "rect", attrs: {} });
 * });
 * ```
 *
 * 支持嵌套：内层只改副本，由最外层统一提交。
 */
export function batchCommands<T>(task: () => T): T {
	const outer = workingState;
	workingState = { pages: [...pageStore.getPages()], current: pageStore.state.current, dirty: false };

	try {
		const result = task();
		const state = workingState;
		workingState = outer;
		// 一条命令都没真正写入（全是 ok:false）：别产生空的重载和历史
		if (!outer && state && state.dirty) {
			pageStore.replacePages(state.pages, state.current);
			historyStore.commit();
		}
		return result;
	} catch (error) {
		// 抛异常：丢弃副本，store 保持原样
		workingState = outer;
		throw error;
	}
}

/** 替换某一页（保持其它页引用不变） */
function withPage(index: number, page: PageInfo): PageInfo[] {
	const pages = pagesOf();
	pages[index] = page;
	return pages;
}

/** 页面尺寸的半宽半高，用来做默认居中 */
const center = () => ({ x: Math.round(baseWidth / 2), y: Math.round(baseHeight / 2) });

/**
 * 文档概览：给模型判断"现在有几页、这页大概有什么"。
 * 只给必要信息，别把整个 attrs 灌进去 —— 那是 token 黑洞。
 */
export function getDocumentSummary() {
	const pages = readPages();
	return {
		reportName: reportStore.state.reportName,
		pageCount: pages.length,
		currentPageIndex: currentIndex(),
		pages: pages.map((page, index) => ({
			index,
			pageId: page.pageId,
			name: page.pageName,
			elementCount: page.elements.length,
			hasBackground: Boolean(page.style?.fill),
			guides: page.guides?.length ?? 0,
		})),
	};
}

/** 某一页的元素清单（精简版）：id、类型、位置尺寸、文本内容 */
export function getPageDetail(pageId?: string): CommandResult {
	const resolved = resolvePage(pageId);
	if (!resolved) {
		return fail("找不到这一页");
	}
	const { page } = resolved;
	return {
		ok: true,
		message: `第 ${page.pageName} 页共 ${page.elements.length} 个元素`,
		data: {
			pageId: page.pageId,
			name: page.pageName,
			background: page.style?.fill ?? null,
			elements: page.elements.map((element) => ({
				id: element.id,
				elementType: element.elementType,
				left: element.attrs.left,
				top: element.attrs.top,
				width: element.attrs.width,
				height: element.attrs.height,
				angle: element.attrs.angle,
				text: element.attrs.text,
				fill: element.attrs.fill,
			})),
		},
	};
}

/** 可用的元素类型与各自必填字段，告诉模型"能摆什么" */
export function describeElementTypes(): CommandResult {
	return {
		ok: true,
		message: "可用的元素类型",
		data: {
			elementTypes: KNOWN_ELEMENT_TYPES,
			notes: [
				"text 元素必须给 attrs.text（空文本保存时会被丢弃）",
				"rect / image / brush / 形状类需要 width、height",
				`image 元素必须给 attrs.fill = { kind: "image", source: "media/xxx.png", fit: "cover" }，source 只能用文档里已有的图片`,
				`${BRUSH_ELEMENT_TYPE} 元素必须给 attrs.path（路径数组），由画笔工具生成，agent 不要自己造`,
				"线条类（line-*）用 left/top/angle/length 描述",
			],
		},
	};
}

/** 新增一页，插入到末尾并切过去 */
export function addPage(options: { name?: string } = {}): CommandResult {
	const pages = pagesOf();
	const page = {
		pageId: createUniqueId("page"),
		pageName: options.name?.trim() || `页面 ${pages.length + 1}`,
		elements: [],
	};
	const next = [...pages, page];
	// 切到新页：agent 后续"往这页加东西"才符合直觉
	commitPages(next, next.length - 1);
	return {
		ok: true,
		message: `已新增第 ${next.length} 页「${page.pageName}」并切换过去`,
		data: { pageId: page.pageId, index: next.length - 1 },
	};
}

/** 设置页面背景填充（undefined 清回默认白纸） */
export function setPageFill(options: { pageId?: string; fill?: unknown }): CommandResult {
	const resolved = resolvePage(options.pageId);
	if (!resolved) {
		return fail("找不到这一页");
	}
	const fill = options.fill === undefined || options.fill === null ? undefined : normalizeFill(options.fill);
	if (options.fill !== undefined && options.fill !== null && !fill) {
		return fail("填充值不合法：给 {kind:'solid',color} 或 {kind:'gradient',...}");
	}
	const style: PageStyle = { ...resolved.page.style, fill };
	const nextPage: PageInfo = { ...resolved.page, style };
	commitPages(withPage(resolved.index, nextPage));
	return {
		ok: true,
		message: fill ? "已更新页面背景" : "已清空页面背景",
		data: { pageId: resolved.page.pageId },
	};
}

/** 新增参考线（位置按 10 取整，和 UI 里的规则一致） */
export function addGuide(options: {
	pageId?: string;
	axis: "x" | "y";
	position: number;
}): CommandResult {
	const resolved = resolvePage(options.pageId);
	if (!resolved) {
		return fail("找不到这一页");
	}
	const limit = options.axis === "x" ? baseWidth : baseHeight;
	if (!Number.isFinite(options.position)) {
		return fail("参考线位置必须是数字");
	}
	const position = Math.round(Math.min(Math.max(options.position, 0), limit) / 10) * 10;
	const guides: PageGuide[] = [...(resolved.page.guides ?? []), { axis: options.axis, position }];
	commitPages(withPage(resolved.index, { ...resolved.page, guides }));
	return { ok: true, message: `已添加${options.axis === "x" ? "竖" : "横"}向参考线（${position}）` };
}

/** 各类型的几何默认值：模型只给位置时也能落一个像样的元素 */
function defaultGeometry(elementType: string): { width: number; height: number } {
	if (elementType === TEXT_ELEMENT_TYPE) {
		return { width: 640, height: 80 };
	}
	if (elementType.startsWith("line-")) {
		return { width: 400, height: 0 };
	}
	return { width: 480, height: 280 };
}

/**
 * 命令层接受的 attrs。
 *
 * 和 `ElementAttrs` 的唯一区别是 `fill` 放开成 unknown：
 * 模型经常给 `"#fff"` 这种纯色字符串或旧格式对象，统一交给 `normalizeFill` 归一，
 * 其它字段仍然保持类型约束。
 */
export type CommandAttrs = Omit<ElementAttrs, "fill"> & { fill?: unknown };

/**
 * 新增元素。
 *
 * 只做"数据合法"这一层校验；具体渲染由 `buildElementObject` 负责，
 * 所以这里产出的 attrs 必须和手工操作时存的完全同构。
 */
export function addElement(options: {
	pageId?: string;
	elementType: string;
	attrs?: CommandAttrs;
}): CommandResult {
	const elementType = options.elementType?.trim();
	if (!elementType) {
		return fail("缺少 elementType");
	}
	if (!KNOWN_ELEMENT_TYPES.includes(elementType)) {
		return fail(`不认识元素类型「${elementType}」，可用：${KNOWN_ELEMENT_TYPES.join("、")}`);
	}
	const resolved = resolvePage(options.pageId);
	if (!resolved) {
		return fail("找不到这一页");
	}

	const { fill: rawFill, ...rest } = options.attrs ?? {};
	const geometry = defaultGeometry(elementType);
	const point = center();
	const attrs: ElementAttrs = { ...rest };

	// 位置：没给就居中
	attrs.left = typeof rest.left === "number" ? rest.left : point.x - geometry.width / 2;
	attrs.top = typeof rest.top === "number" ? rest.top : point.y - geometry.height / 2;

	// 宽度/高度：文本以外的元素必须有，缺就补默认
	if (elementType !== TEXT_ELEMENT_TYPE) {
		attrs.width = typeof rest.width === "number" ? rest.width : geometry.width;
		if (!elementType.startsWith("line-")) {
			attrs.height = typeof rest.height === "number" ? rest.height : geometry.height;
		}
	} else if (typeof rest.width === "number") {
		attrs.width = rest.width;
	}

	if (elementType === TEXT_ELEMENT_TYPE && (typeof attrs.text !== "string" || !attrs.text.trim())) {
		return fail("text 元素必须给 attrs.text");
	}

	// 填充统一归一化：模型经常给 "#fff" 或 {kind:'solid',...} 两种写法
	if (rawFill !== undefined) {
		const fill = normalizeFill(rawFill);
		if (!fill) {
			return fail("attrs.fill 不合法");
		}
		attrs.fill = fill;
	}
	if (elementType === IMAGE_ELEMENT_TYPE && attrs.fill?.kind !== "image") {
		return fail("image 元素需要 attrs.fill = { kind:'image', source:'media/…', fit }");
	}

	const element: ElementInfo = {
		id: createUniqueId("element"),
		elementType,
		attrs,
	};
	const nextPage: PageInfo = { ...resolved.page, elements: [...resolved.page.elements, element] };
	commitPages(withPage(resolved.index, nextPage));
	return {
		ok: true,
		message: `已在「${resolved.page.pageName}」添加 ${elementType} 元素`,
		data: { elementId: element.id, pageId: resolved.page.pageId },
	};
}

/** 找出元素所在的页与下标（元素 id 全文档唯一，所以跨页找） */
function findElement(elementId: string): { page: PageInfo; pageIndex: number; elementIndex: number } | null {
	const pages = readPages();
	for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
		const elementIndex = pages[pageIndex].elements.findIndex((item) => item.id === elementId);
		if (elementIndex >= 0) {
			return { page: pages[pageIndex], pageIndex, elementIndex };
		}
	}
	return null;
}

/** 修改元素属性（浅合并，只覆盖传进来的字段） */
export function updateElement(options: {
	elementId: string;
	attrs: CommandAttrs;
}): CommandResult {
	const found = findElement(options.elementId);
	if (!found) {
		return fail(`找不到元素 ${options.elementId}`);
	}
	const { fill: rawFill, ...rest } = options.attrs ?? {};
	const attrs: ElementAttrs = { ...found.page.elements[found.elementIndex].attrs };

	for (const [key, value] of Object.entries(rest)) {
		attrs[key] = value;
	}
	if (rawFill !== undefined) {
		const fill = normalizeFill(rawFill);
		if (!fill) {
			return fail("attrs.fill 不合法");
		}
		attrs.fill = fill;
	}

	const elements = [...found.page.elements];
	elements[found.elementIndex] = { ...elements[found.elementIndex], attrs };
	commitPages(withPage(found.pageIndex, { ...found.page, elements }));
	const changed = [...Object.keys(rest), ...(rawFill !== undefined ? ["fill"] : [])];
	return { ok: true, message: `已更新元素（${changed.join("、") || "无字段"}）` };
}

/** 删除元素 */
export function deleteElement(options: { elementId: string }): CommandResult {
	const found = findElement(options.elementId);
	if (!found) {
		return fail(`找不到元素 ${options.elementId}`);
	}
	const elements = found.page.elements.filter((_, index) => index !== found.elementIndex);
	commitPages(withPage(found.pageIndex, { ...found.page, elements }));
	return { ok: true, message: "已删除元素" };
}

/**
 * 渲染一页给模型看。
 *
 * 默认压到 768px 宽、JPEG 0.7：一张 1920×1080 的 PNG base64 会吃掉几千 token，
 * 而模型只需要看清"排版对不对"，不需要看清每个像素。
 */
export async function renderPageForAgent(options: {
	pageId?: string;
	maxWidth?: number;
	format?: "jpeg" | "png";
} = {}): Promise<CommandResult> {
	const resolved = resolvePage(options.pageId);
	if (!resolved) {
		return fail("找不到这一页");
	}
	const page = resolved.page;
	await ensureMediaImages(collectImageSources([page]));

	const maxWidth = Math.min(Math.max(options.maxWidth ?? 768, 256), baseWidth);
	const scale = maxWidth / baseWidth;
	const url = renderPageImage(page, {
		scale,
		format: options.format ?? "jpeg",
		quality: 0.7,
	});
	if (!url) {
		return fail("渲染失败");
	}
	return {
		ok: true,
		message: `第 ${page.pageName} 页的渲染图（${Math.round(baseWidth * scale)}×${Math.round(baseHeight * scale)}）`,
		data: { pageId: page.pageId, imageUrl: url },
	};
}
