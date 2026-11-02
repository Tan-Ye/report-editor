import { useEffect } from "react";
import type { RefObject } from "react";
import type { Canvas } from "fabric";
import { isEditableTarget } from "@/lib/dom";

interface UseSpacePanArgs {
	canvas: Canvas | null;
	containerRef: RefObject<HTMLDivElement | null>;
	panBy: (dx: number, dy: number) => void;
}

/** 按住空格、还没拖动时的指针样式 */
const IDLE_CURSOR = "grab";
/** 正在拖动时的指针样式 */
const DRAGGING_CURSOR = "grabbing";

/**
 * 按住空格进入拖拽状态：此时按住左键拖动可以平移画布。
 *
 * 解决的是「窗口放不下整页」的问题：放大之后右侧、下侧会跑出可视区，
 * 只有平移过去才能接着在那些地方绘制。
 *
 * 拦截放在容器的**捕获阶段**：fabric 把交互监听绑在 upperCanvasEl 上，
 * 事件必须先经过容器，这里 stopPropagation 之后 fabric 什么都收不到，
 * 也就不会选中元素、不会框选、不会开始画形状、也不会双击进文本编辑。
 * 这比自己复刻一遍 fabric 的事件处理可靠 —— 也不用去改 skipTargetFind /
 * selection 这些属于工具模式的状态，切换工具时不会互相打架。
 */
export function useSpacePan({ canvas, containerRef, panBy }: UseSpacePanArgs) {
	useEffect(() => {
		const container = containerRef.current;
		if (!canvas || !container) {
			return;
		}
		// 闭包里再绑一次 const：函数声明里访问参数会丢掉非空收窄
		const fabricCanvas = canvas;

		/** 空格是否按住 */
		let panMode = false;
		/** 空格键当前的物理状态：比 panMode 更可信，用来兜住「keyup 丢了」的情况 */
		let spaceDown = false;
		/** 是否正在拖动 */
		let dragging = false;
		/** 左键是否按着：绘制/拉伸途中切进拖拽会把状态机挂住，这种时候不接管 */
		let pointerHeld = false;
		let lastClientX = 0;
		let lastClientY = 0;
		/** 进入拖拽状态前的指针样式，退出时还回去 */
		let savedCursor: { defaultCursor: string; hoverCursor: string } | null = null;

		/** 拖动时连对象上的悬停样式一起改，否则鼠标压过元素会跳回 grab */
		function setCursor(cursor: string) {
			fabricCanvas.defaultCursor = cursor;
			fabricCanvas.hoverCursor = cursor;
			fabricCanvas.setCursor(cursor);
		}

		function enterPanMode() {
			if (panMode) {
				return;
			}
			panMode = true;
			savedCursor = {
				defaultCursor: fabricCanvas.defaultCursor,
				hoverCursor: fabricCanvas.hoverCursor,
			};
			setCursor(IDLE_CURSOR);
		}

		function exitPanMode() {
			if (!panMode) {
				return;
			}
			panMode = false;
			dragging = false;
			if (savedCursor) {
				fabricCanvas.defaultCursor = savedCursor.defaultCursor;
				fabricCanvas.hoverCursor = savedCursor.hoverCursor;
				savedCursor = null;
			}
			fabricCanvas.setCursor(fabricCanvas.defaultCursor);
		}

		function handleKeyDown(event: KeyboardEvent) {
			if (event.code !== "Space") {
				return;
			}
			// 先记物理状态：哪怕后面因为各种原因不接管，也知道空格是按着的
			spaceDown = true;
			if (event.repeat) {
				return;
			}
			// Ctrl/⌘/Alt + 空格是系统与输入法的组合键，不接管
			if (event.ctrlKey || event.metaKey || event.altKey) {
				return;
			}
			// 输入框里空格得能正常打出来；文本对象编辑时焦点在隐藏的 textarea 上，同样命中这里
			if (isEditableTarget(event.target)) {
				return;
			}
			if (pointerHeld) {
				return;
			}
			// 空格默认会滚动页面，还会「点击」当前聚焦的按钮，必须拦掉
			event.preventDefault();
			enterPanMode();
		}

		function handleKeyUp(event: KeyboardEvent) {
			if (event.code !== "Space") {
				return;
			}
			spaceDown = false;
			if (!panMode) {
				return;
			}
			event.preventDefault();
			exitPanMode();
		}

		function handlePointerDown(event: PointerEvent) {
			pointerHeld = true;
			// 自愈：空格早就松开了却没收到 keyup（被别的组件吞掉、或切窗口时丢了事件），
			// 这时还压着 mousedown 就会「点不中、一拖就平移」，先把模式退掉让事件正常走
			if (panMode && !spaceDown) {
				exitPanMode();
			}
			if (!panMode || event.button !== 0) {
				return;
			}
			// pointerdown 不是 fabric 监听的那一类（它默认 enablePointerEvents=false），
			// 这里只负责记起点；真正拦住 fabric 的是下面的 mousedown 捕获
			dragging = true;
			lastClientX = event.clientX;
			lastClientY = event.clientY;
			setCursor(DRAGGING_CURSOR);
		}

		/**
		 * 拖拽状态下把事件挡在容器里。
		 * fabric 监听的是 mousedown / touchstart / click / dblclick，
		 * 而 pointerdown 上的 preventDefault 挡不住浏览器随后补发的鼠标事件，
		 * 所以这几类要单独拦。
		 */
		function swallowForFabric(event: Event) {
			if (!panMode) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
		}

		function handlePointerMove(event: PointerEvent) {
			if (!dragging) {
				return;
			}
			const dx = event.clientX - lastClientX;
			const dy = event.clientY - lastClientY;
			lastClientX = event.clientX;
			lastClientY = event.clientY;
			panBy(dx, dy);
		}

		function handlePointerUp() {
			pointerHeld = false;
			if (!dragging) {
				return;
			}
			dragging = false;
			if (panMode) {
				setCursor(IDLE_CURSOR);
			}
		}

		/** 切到别的应用时收不到 keyup，不主动退出会一直停在拖拽状态 */
		function handleWindowBlur() {
			pointerHeld = false;
			spaceDown = false;
			exitPanMode();
		}

		/** 标签页/窗口切走同理：keyup 可能压根送不到 */
		function handleVisibilityChange() {
			if (!document.hidden) {
				return;
			}
			pointerHeld = false;
			spaceDown = false;
			exitPanMode();
		}

		// 键盘监听走捕获阶段：外层组件 stopPropagation 时也收得到，
		// 否则 keyup 一被吞，空格状态就再也退不出来了
		window.addEventListener("keydown", handleKeyDown, true);
		window.addEventListener("keyup", handleKeyUp, true);
		window.addEventListener("blur", handleWindowBlur);
		document.addEventListener("visibilitychange", handleVisibilityChange);
		// 移动与抬起挂在 window 上：拖到画布外、甚至拖出可视区也不会断
		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp, true);
		window.addEventListener("pointercancel", handlePointerUp, true);
		container.addEventListener("pointerdown", handlePointerDown, true);
		// 捕获阶段拦截，事件到不了 upperCanvasEl，fabric 的整套交互就不会启动
		container.addEventListener("mousedown", swallowForFabric, true);
		container.addEventListener("touchstart", swallowForFabric, true);
		container.addEventListener("click", swallowForFabric, true);
		container.addEventListener("dblclick", swallowForFabric, true);

		return () => {
			exitPanMode();
			window.removeEventListener("keydown", handleKeyDown, true);
			window.removeEventListener("keyup", handleKeyUp, true);
			window.removeEventListener("blur", handleWindowBlur);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp, true);
			window.removeEventListener("pointercancel", handlePointerUp, true);
			container.removeEventListener("pointerdown", handlePointerDown, true);
			container.removeEventListener("mousedown", swallowForFabric, true);
			container.removeEventListener("touchstart", swallowForFabric, true);
			container.removeEventListener("click", swallowForFabric, true);
			container.removeEventListener("dblclick", swallowForFabric, true);
		};
	}, [canvas, containerRef, panBy]);
}
