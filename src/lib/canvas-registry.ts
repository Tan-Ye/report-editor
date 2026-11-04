import type * as fabric from "fabric";

/**
 * 当前主画布的登记处。
 *
 * 画布实例原本只活在 `draw-area` 的组件树里，但 agent 执行器需要它：
 * 执行期间要锁画布（防止用户操作和 AI 操作互相打断），以后还要做逐帧动画。
 *
 * 放 lib 而不是 store：它不是一个"可序列化的状态"，而是运行时的库对象，
 * 和 `elementObjectMap` 同性质（那边挂在 store 是因为它属于元素模型的一部分）。
 */
let activeCanvas: fabric.Canvas | null = null;

export function setActiveCanvas(canvas: fabric.Canvas | null): void {
	activeCanvas = canvas;
}

export function getActiveCanvas(): fabric.Canvas | null {
	return activeCanvas;
}
