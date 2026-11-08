import * as fabric from "fabric";
import { baseHeight, baseWidth } from "@/base";
import {
	TEXT_BOX_WIDTH,
	TEXT_ELEMENT_TYPE,
	TEXT_FONT_SIZE,
	TEXT_LINE_HEIGHT,
} from "@/base/elements";
import { getElementDefinition, snapshotElementInfo } from "@/lib/element/registry";
import { RichTextBox } from "@/lib/element/rich-object";
import { createUniqueId } from "@/lib/utils";
import { elementObjectMap, historyStore, pageStore, toolStore } from "@/store";

/** 文本工具落下时的占位文字：还没编辑也能在框里看到内容 */
const TEXT_PLACEHOLDER = "文本";

export interface CreateTextOptions {
	/** 落完直接进编辑（工具栏「插入富文本」用） */
	openEditor?: boolean;
}

/**
 * 在画布上落一个富文本元素。
 *
 * 画布侧唯一的文本创建入口：文本工具（点哪落哪）和顶栏「插入富文本」
 * （落页面中央）都走这里，保证占位、登记、入 store、选中、历史完全一致。
 */
export function createTextElement(
	canvas: fabric.Canvas,
	point: { x: number; y: number },
	options: CreateTextOptions = {},
): string | null {
	const definition = getElementDefinition(TEXT_ELEMENT_TYPE);
	if (!definition) {
		return null;
	}

	const width = TEXT_BOX_WIDTH;
	const object = definition.build({
		left: point.x,
		top: point.y,
		width,
		height: 0,
		startX: point.x,
		startY: point.y,
		endX: point.x + width,
		endY: point.y,
	});
	if (!(object instanceof RichTextBox)) {
		return null;
	}

	// 占位内容是"还没定稿"的状态：编辑提交后会被真实内容替换
	object.setDoc([{ runs: [{ text: TEXT_PLACEHOLDER }] }], { placeholder: true });
	object.set({ left: point.x, top: point.y });
	object.setCoords();

	const id = createUniqueId("element");
	elementObjectMap.attach({ id, elementType: definition.type }, object);
	const info = snapshotElementInfo(object);
	if (info) {
		pageStore.addElementToCurrentPage(info);
	}

	// 必须真的加到画布上：setActiveObject 只是设为选中，不会把它渲染出来
	canvas.add(object);
	canvas.setActiveObject(object);
	canvas.requestRenderAll();
	historyStore.commit();

	// 落完回到选择态：元素保持选中，双击才进入编辑
	toolStore.setTool("select");
	if (options.openEditor) {
		toolStore.startTextEditing(id);
	}
	return id;
}

/** 页面中央落一个默认宽度的文本元素：左上角坐标 */
export function centerPointForText(): { x: number; y: number } {
	return {
		x: baseWidth / 2 - TEXT_BOX_WIDTH / 2,
		y: baseHeight / 2 - (TEXT_FONT_SIZE * TEXT_LINE_HEIGHT) / 2,
	};
}
