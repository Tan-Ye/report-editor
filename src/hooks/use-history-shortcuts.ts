import { useEffect } from "react";
import { isEditableTarget } from "@/lib/dom";
import { historyStore } from "@/store";

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
