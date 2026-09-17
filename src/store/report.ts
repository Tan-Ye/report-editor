export type ReportInfo = {
	reportName: string;
	reportId: string;
};
/**
 * 报告信息存储,单例模式
 * 用于存储当前选中的报告信息，包括报告名称和报告ID
 */
class ReportStore {
	state: ReportInfo;
	constructor() {
		this.state = {
			reportName: "",
			reportId: "",
		};
	}

	setReportInfo(v: Partial<ReportInfo>) {
		this.state = { ...this.state, ...v } as ReportInfo;
	}

	readReportInfo(): ReportInfo {
		return this.state;
	}

	writeReportInfo(v: ReportInfo) {
		this.state = v;
	}
}

export const reportStore = new ReportStore();
