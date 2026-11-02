import { Lock } from "lucide-react";
import { TEXT_ELEMENT_TYPE, getElementTypeLabel } from "@/base/elements";
import {
	getElementDefinition,
	getElementGeometry,
	readGeometryValues,
} from "@/lib/element-registry";
import {
	ELEMENT_COMMAND,
	emitter,
	type ElementCommandPayload,
	type ElementGeometryPatch,
	type ElementStylePatch,
} from "@/lib/emitter";
import type { ElementInfo } from "@/store";
import { AngleDial } from "./angle-dial";
import { FillEditor } from "./fill-editor";
import { NumberField } from "./number-field";
import { TextProperties } from "./text-properties";

interface ElementPropertiesProps {
	element: ElementInfo;
}

export function ElementProperties({ element }: ElementPropertiesProps) {
	const geometry = getElementGeometry(element.elementType);
	const definition = getElementDefinition(element.elementType);
	const values = readGeometryValues(geometry ?? "size", element.attrs);
	const locked = element.attrs.locked === true;

	// 线条没有宽高（用「起点 + 角度 + 长度」描述）；文本高度随内容撑开，没有可编辑的 height
	const isSegment = geometry === "segment";
	const isText = element.elementType === TEXT_ELEMENT_TYPE;
	const supportsHeight = definition?.props.includes("height") ?? false;
	const supportsFill = definition?.props.includes("fill") ?? false;
	const supportsStroke = definition?.props.includes("stroke") ?? false;
	const supportsStrokeWidth = definition?.props.includes("strokeWidth") ?? false;

	const strokeWidth = typeof element.attrs.strokeWidth === "number" ? element.attrs.strokeWidth : 0;
	const opacity = typeof element.attrs.opacity === "number" ? element.attrs.opacity : 1;

	const updateGeometry = (patch: ElementGeometryPatch, commit = true) => {
		emitter.emit<ElementCommandPayload>(ELEMENT_COMMAND, {
			type: "update-geometry",
			id: element.id,
			patch,
			commit,
		});
	};

	const updateStyle = (patch: ElementStylePatch, commit = true) => {
		emitter.emit<ElementCommandPayload>(ELEMENT_COMMAND, {
			type: "update-style",
			id: element.id,
			patch,
			commit,
		});
	};

	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
					{getElementTypeLabel(element.elementType)}
				</span>
				{locked && (
					<span className="flex items-center gap-1 text-xs text-muted-foreground">
						<Lock className="size-3" aria-hidden="true" />
						已锁定
					</span>
				)}
			</div>

			<div className="flex flex-col gap-2">
				<h3 className="text-xs font-medium text-muted-foreground">位置与尺寸</h3>
				<div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
					<NumberField
						label="X"
						value={values.left}
						disabled={locked}
						onCommit={(left) => updateGeometry({ left })}
					/>
					<NumberField
						label="Y"
						value={values.top}
						disabled={locked}
						onCommit={(top) => updateGeometry({ top })}
					/>
					{isSegment ? (
						<NumberField
							label="长度"
							value={values.length}
							disabled={locked}
							onCommit={(length) => updateGeometry({ length })}
						/>
					) : (
						<NumberField
							label="宽"
							value={values.width}
							disabled={locked}
							onCommit={(width) => updateGeometry({ width })}
						/>
					)}
					{!isSegment && supportsHeight && (
						<NumberField
							label="高"
							value={values.height}
							disabled={locked}
							onCommit={(height) => updateGeometry({ height })}
						/>
					)}
				</div>
			</div>

			<div className="flex flex-col gap-2">
				<h3 className="text-xs font-medium text-muted-foreground">旋转</h3>
				<div className="flex items-center gap-2">
					<AngleDial
						value={values.angle}
						disabled={locked}
						// 拖动只预览，松手才记一步历史
						onPreview={(angle) => updateGeometry({ angle }, false)}
						onCommit={(angle) => updateGeometry({ angle })}
					/>
					<div className="min-w-0 flex-1">
						<NumberField
							label="角度"
							value={values.angle}
							suffix="°"
							disabled={locked}
							onCommit={(angle) => updateGeometry({ angle })}
						/>
					</div>
				</div>
			</div>

			{supportsFill && (
				<div className="flex flex-col gap-2">
					<h3 className="text-xs font-medium text-muted-foreground">
						{isText ? "文字颜色" : "填充"}
					</h3>
					<FillEditor
						value={element.attrs.fill}
						disabled={locked}
						onChange={(fill, options) => updateStyle({ fill }, options?.commit ?? true)}
					/>
				</div>
			)}

			{(supportsStroke || supportsStrokeWidth) && (
				<div className="flex flex-col gap-2">
					<h3 className="text-xs font-medium text-muted-foreground">描边</h3>
					<div className="flex items-center gap-1.5">
						{supportsStroke && (
							<div className="min-w-0 flex-1">
								<FillEditor
									value={element.attrs.stroke ? { kind: "solid", color: element.attrs.stroke } : undefined}
									disabled={locked}
									gradient={false}
									onChange={(fill, options) =>
										// 描边只支持纯色：渐变值不会走到这里（面板里没有入口）
										updateStyle(
											{ stroke: fill.kind === "solid" ? fill.color : "#000000" },
											options?.commit ?? true,
										)
									}
								/>
							</div>
						)}
						{supportsStrokeWidth && (
							<div className="w-24 shrink-0">
								<NumberField
									label="宽"
									value={strokeWidth}
									disabled={locked}
									onCommit={(value) => updateStyle({ strokeWidth: value })}
								/>
							</div>
						)}
					</div>
				</div>
			)}

			{isText && (
				<TextProperties attrs={element.attrs} disabled={locked} onChange={updateStyle} />
			)}

			<div className="flex items-center justify-between text-xs">
				<span className="text-muted-foreground">不透明度</span>
				<span className="tabular-nums text-foreground">{Math.round(opacity * 100)}%</span>
			</div>
		</section>
	);
}
