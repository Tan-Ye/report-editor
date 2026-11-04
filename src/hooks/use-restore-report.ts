import { useEffect } from "react";
import { releaseAllOnUnload } from "@/lib/report-session";
import { restoreLastReport } from "@/lib/report-service";

/**
 * 启动时恢复上一次的报告。
 *
 * 例外：「新建报告」开出来的窗口带 `?new=1`，它必须是一份空白文档 ——
 * 否则新窗口会恢复同一个报告，两个窗口编辑同一份内容、互相覆盖。
 * 空白文档不落盘，用户第一次按保存时才会建报告目录。
 *
 * 同时负责在窗口关闭时释放报告占用（Rust 侧的登记表），
 * 否则那个报告会被当成"永远被占用"，别的窗口打不开。
 */
export function useRestoreReport() {
	useEffect(() => {
		const handleUnload = () => {
			void releaseAllOnUnload();
		};
		window.addEventListener("beforeunload", handleUnload);

		const isNewWindow = new URLSearchParams(window.location.search).get("new") === "1";
		if (!isNewWindow) {
			void restoreLastReport();
		}

		return () => {
			window.removeEventListener("beforeunload", handleUnload);
			void releaseAllOnUnload();
		};
	}, []);
}
