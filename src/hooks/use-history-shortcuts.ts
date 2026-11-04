import { useEffect } from "react";
import { isEditableTarget } from "@/lib/dom";
import { historyStore, toolStore } from "@/store";

/**
 * 撤销/重做快捷键：
 * - Ctrl/Cmd + Z         撤销
 * - Ctrl/Cmd + Shift + Z 重做
 * - Ctrl/Cmd + Y         重做（Windows 习惯）
 */
export function useHistoryShortcuts() {
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const withModifier = event.ctrlKey || event.metaKey;
			if (!withModifier || event.altKey || isEditableTarget(event.target)) {
				return;
			}
			// 裁剪态里撤销会把文档改掉、覆盖层却停留在旧几何上，先禁用
			if (toolStore.getCroppingId()) {
				event.preventDefault();
				return;
			}

			const key = event.key.toLowerCase();
			if (key === "z") {
				event.preventDefault();
				if (event.shiftKey) {
					historyStore.redo();
				} else {
					historyStore.undo();
				}
				return;
			}

			if (key === "y") {
				event.preventDefault();
				historyStore.redo();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, []);
}
