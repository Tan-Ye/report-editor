import { useSyncExternalStore } from "react";
import { MousePointer2 } from "lucide-react";
import { baseHeight, baseWidth } from "@/base";
import { ReportInfoDrawer } from "@/components/report/report-info-drawer";
import { selectionStore } from "@/store";
import { ElementProperties } from "./element-properties";

/**
 * 订阅函数与快照函数放在模块级：引用稳定，
 * 否则每次渲染都会重新订阅一次。
 */
const subscribeSelection = (onStoreChange: () => void) =>
	selectionStore.subscribe(onStoreChange);

const getSelectionSnapshot = () => selectionStore.getSnapshot();

export function PropertyPanel() {
	const selection = useSyncExternalStore(subscribeSelection, getSelectionSnapshot);
	// 多选时暂时不展示属性，等批量编辑做好再接
	const onlyOne = selection.ids.length === 1 ? selection.primary : null;

	return (
		<aside className="flex w-64 shrink-0 flex-col border-l border-border bg-chrome">
			<div className="flex h-10 shrink-0 items-center px-3">
				<h2 className="text-sm font-medium text-foreground">属性</h2>
			</div>

			<div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-4">
				{selection.ids.length === 0 && (
					<div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-8 text-center">
						<MousePointer2 className="size-5 text-muted-foreground/70" aria-hidden="true" />
						<p className="text-xs font-medium text-foreground">未选中元素</p>
						<p className="text-xs leading-relaxed text-muted-foreground">
							在画布中选中元素后，可在此查看它的属性
						</p>
					</div>
				)}

				{onlyOne && <ElementProperties element={onlyOne} />}

				<section className="mt-5">
					<h3 className="mb-2 text-xs font-medium text-muted-foreground">画布</h3>
					<dl className="space-y-1.5 rounded-lg border border-border/70 bg-background p-2.5">
						<div className="flex items-center justify-between text-xs">
							<dt className="text-muted-foreground">尺寸</dt>
							<dd className="tabular-nums text-foreground">
								{baseWidth} × {baseHeight}
							</dd>
						</div>
						<div className="flex items-center justify-between text-xs">
							<dt className="text-muted-foreground">背景</dt>
							<dd className="text-foreground">白色</dd>
						</div>
					</dl>
				</section>
			</div>

			{/* 右下角：报告信息抽屉入口 */}
			<div className="shrink-0 border-t border-border p-2">
				<ReportInfoDrawer />
			</div>
		</aside>
	);
}
