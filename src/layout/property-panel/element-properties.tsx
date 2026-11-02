import { getElementTypeLabel } from "@/base/elements";
import { UNIT_SIZE } from "@/lib/element-definitions";
import { getElementGeometry } from "@/lib/element-registry";
import type { ElementInfo } from "@/store";

interface ElementPropertiesProps {
	element: ElementInfo;
}

interface PropertyRow {
	label: string;
	value: string;
	/** 有值时，在数值前面画一个色块 */
	swatch?: string;
}

const formatNumber = (value: number) =>
	Number.isInteger(value) ? String(value) : value.toFixed(1);

/** 把 ElementInfo 整理成「标签 - 值」的展示行，按几何类型决定显示哪些字段 */
function describeElement(element: ElementInfo): PropertyRow[] {
	const { attrs } = element;
	const geometry = getElementGeometry(element.elementType);
	const rows: PropertyRow[] = [];

	const left = typeof attrs.left === "number" ? attrs.left : 0;
	const top = typeof attrs.top === "number" ? attrs.top : 0;
	const angle = typeof attrs.angle === "number" ? attrs.angle : 0;
	const opacity = typeof attrs.opacity === "number" ? attrs.opacity : 1;

	rows.push({ label: "位置", value: `${formatNumber(left)}, ${formatNumber(top)}` });

	if (geometry === "segment") {
		// 线条没有宽高，只有长度和角度
		const length = typeof attrs.length === "number" ? attrs.length : 0;
		rows.push({ label: "长度", value: formatNumber(length) });
		rows.push({ label: "角度", value: `${formatNumber(angle)}°` });
	} else {
		// 形状是按 100×100 的基准路径缩放出来的，这里换算回实际尺寸
		const scaleX = typeof attrs.scaleX === "number" ? attrs.scaleX : 1;
		const scaleY = typeof attrs.scaleY === "number" ? attrs.scaleY : 1;
		const width =
			geometry === "stretch" ? UNIT_SIZE * scaleX : typeof attrs.width === "number" ? attrs.width : 0;
		const height =
			geometry === "stretch" ? UNIT_SIZE * scaleY : typeof attrs.height === "number" ? attrs.height : 0;
		rows.push({ label: "尺寸", value: `${formatNumber(width)} × ${formatNumber(height)}` });
		rows.push({ label: "角度", value: `${formatNumber(angle)}°` });
	}

	rows.push({ label: "不透明度", value: `${Math.round(opacity * 100)}%` });

	if (typeof attrs.fill === "string" && attrs.fill !== "transparent") {
		rows.push({ label: "填充", value: attrs.fill, swatch: attrs.fill });
	}
	if (typeof attrs.stroke === "string") {
		rows.push({ label: "描边", value: attrs.stroke, swatch: attrs.stroke });
	}
	if (typeof attrs.strokeWidth === "number") {
		rows.push({ label: "描边宽度", value: formatNumber(attrs.strokeWidth) });
	}

	return rows;
}

export function ElementProperties({ element }: ElementPropertiesProps) {
	const rows = describeElement(element);

	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
					{getElementTypeLabel(element.elementType)}
				</span>
			</div>

			<dl className="flex flex-col gap-1.5 rounded-lg border border-border/70 bg-background p-2.5">
				{rows.map((row) => (
					<div key={row.label} className="flex items-center justify-between gap-3 text-xs">
						<dt className="shrink-0 text-muted-foreground">{row.label}</dt>
						<dd className="flex min-w-0 items-center gap-1.5 text-foreground">
							{row.swatch && (
								<span
									aria-hidden="true"
									className="size-3 shrink-0 rounded-sm border border-border"
									// 动态值：元素自身的颜色，必须走行内样式
									style={{ backgroundColor: row.swatch }}
								/>
							)}
							<span className="truncate tabular-nums">{row.value}</span>
						</dd>
					</div>
				))}
			</dl>
		</section>
	);
}
