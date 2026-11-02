import { createUniqueId } from "@/lib/utils";

export interface ReportInfo {
	reportName: string;
	reportId: string;
}

/** 新建报告的默认信息 */
export function createReportInfo(reportName = ""): ReportInfo {
	return {
		reportName,
		reportId: createUniqueId("report"),
	};
}

/**
 * 报告信息存储,单例模式
 * 用于存储当前选中的报告信息，包括报告名称和报告ID
 */
class ReportStore {
	state: ReportInfo;
	constructor() {
		// 报告一创建就要有名字和 id：没有 id 建不了目录，没有名字列表里没法认
		this.state = createReportInfo("未命名报告");
	}

	setReportInfo(v: Partial<ReportInfo>) {
		this.state = { ...this.state, ...v };
	}

	readReportInfo(): ReportInfo {
		return this.state;
	}

	writeReportInfo(v: ReportInfo) {
		this.state = v;
	}

	/** 重置为新报告（新建或打开文件后调用） */
	reset(info: ReportInfo = createReportInfo()) {
		this.state = info;
	}
}

export const reportStore = new ReportStore();
