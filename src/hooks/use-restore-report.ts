import { useEffect } from "react";
import { restoreLastReport } from "@/lib/report-service";

/**
 * 启动时恢复上一次的报告。
 * 只跑一次；数据目录里没有报告时才新建空报告。
 */
export function useRestoreReport() {
	useEffect(() => {
		void restoreLastReport();
	}, []);
}
