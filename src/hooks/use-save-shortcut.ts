import { useEffect } from "react";
import { isEditableTarget } from "@/lib/dom";
import { saveReport } from "@/lib/report/service";

/** Ctrl/Cmd + S 保存 */
export function useSaveShortcut() {
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!(event.ctrlKey || event.metaKey) || event.altKey) {
				return;
			}
			if (event.key.toLowerCase() !== "s") {
				return;
			}
			// 无论焦点在哪都要拦掉浏览器自带的"另存为"
			event.preventDefault();
			if (isEditableTarget(event.target)) {
				return;
			}
			void saveReport();
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, []);
}
