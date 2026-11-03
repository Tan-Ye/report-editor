import { Lock, Maximize2 } from "lucide-react";
import { baseHeight, baseWidth } from "@/base";
import { IMAGE_ELEMENT_TYPE, TEXT_ELEMENT_TYPE, getElementTypeLabel } from "@/base/elements";
import { Button } from "@/components/ui/button";
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
import { getMediaImage } from "@/lib/media";
import type { ElementInfo, ElementShadow } from "@/store";
import { AngleDial } from "./angle-dial";
import { ColorInput, FillEditor } from "./fill-editor";
import { NumberField } from "./number-field";
import { TextProperties } from "./text-properties";

interface ElementPropertiesProps {
	element: ElementInfo;
}

/** 新加阴影的默认值：轻投影，能看出层次又不脏 */
const DEFAULT_SHADOW: ElementShadow = {
	color: "#0f172a",
	opacity: 0.25,
	blur: 12,
	offsetX: 0,
	offsetY: 4,
};

interface ImageRestoreSize {
	width: number;
	height: number;
	naturalWidth: number;
	naturalHeight: number;
}

/**
 * 图片元素的「还原原始尺寸」目标值。
 *
 * 只对**原图比页面大**的图片元素返回 —— 小图插入时本来就是原始尺寸，还原没有意义。
 *
 * ⚠️ 必须按 elementType 判断，不能看 instanceof Rect：
 * 图片元素内部就是一个矩形，用 fabric 类型判断会把普通矩形也卷进来。
 */
function getImageRestoreSize(element: ElementInfo): ImageRestoreSize | null {
	if (element.elementType !== IMAGE_ELEMENT_TYPE) {
		return null;
	}
	const fill = element.attrs.fill;
	if (!fill || fill.kind !== "image") {
		return null;
	}
	const image = getMediaImage(fill.source);
	const naturalWidth = image?.naturalWidth ?? 0;
	const naturalHeight = image?.naturalHeight ?? 0;
	if (!naturalWidth || !naturalHeight) {
		return null;
	}
	if (naturalWidth <= baseWidth && naturalHeight <= baseHeight) {
		return null;
	}
	// 和插入时同一套规则：等比缩到页面能装下
	const scale = Math.min(baseWidth / naturalWidth, baseHeight / naturalHeight);
	return {
		width: Math.round(naturalWidth * scale),
		height: Math.round(naturalHeight * scale),
		naturalWidth,
		naturalHeight,
	};
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
	const restoreSize = getImageRestoreSize(element);
	// 已经是还原后的尺寸就没必要再点
	const restoreDisabled =
		!restoreSize || (values.width === restoreSize.width && values.height === restoreSize.height);

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

				{restoreSize && (
					<Button
						type="button"
						variant="ghost"
						size="xs"
						disabled={locked || restoreDisabled}
						title={`原图 ${restoreSize.naturalWidth} × ${restoreSize.naturalHeight}，按比例缩到页面内是 ${restoreSize.width} × ${restoreSize.height}`}
						onClick={() =>
							updateGeometry({ width: restoreSize.width, height: restoreSize.height })
						}
						className="self-start text-muted-foreground hover:text-foreground"
					>
						<Maximize2 className="size-3" />
						还原原始尺寸
						<span className="text-muted-foreground">
							（{restoreSize.naturalWidth}×{restoreSize.naturalHeight}）
						</span>
					</Button>
				)}
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

			<div className="flex flex-col gap-2">
				<div className="flex items-center justify-between">
					<h3 className="text-xs font-medium text-muted-foreground">阴影</h3>
					<Button
						type="button"
						variant="ghost"
						size="xs"
						disabled={locked}
						onClick={() => updateStyle({ shadow: element.attrs.shadow ? null : DEFAULT_SHADOW })}
						className="text-muted-foreground hover:text-foreground"
					>
						{element.attrs.shadow ? "移除" : "添加"}
					</Button>
				</div>

				{element.attrs.shadow && (
					<div className="flex flex-col gap-2">
						<div className="flex items-center gap-1.5">
							<ColorInput
								value={element.attrs.shadow.color}
								disabled={locked}
								onCommit={(color) =>
									updateStyle({
										shadow: { ...(element.attrs.shadow as ElementShadow), color },
									})
								}
							/>
							<div className="min-w-0 flex-1">
								<NumberField
									label="模糊"
									value={element.attrs.shadow.blur}
									disabled={locked}
									onCommit={(blur) =>
										updateStyle({
											shadow: { ...(element.attrs.shadow as ElementShadow), blur },
										})
									}
								/>
							</div>
							<div className="min-w-0 flex-1">
								<NumberField
									label="透明%"
									value={Math.round(element.attrs.shadow.opacity * 100)}
									disabled={locked}
									onCommit={(percent) =>
										updateStyle({
											shadow: {
												...(element.attrs.shadow as ElementShadow),
												opacity: Math.min(Math.max(percent / 100, 0), 1),
											},
										})
									}
								/>
							</div>
						</div>
						<div className="grid grid-cols-2 gap-1.5">
							<NumberField
								label="X"
								value={element.attrs.shadow.offsetX}
								disabled={locked}
								onCommit={(offsetX) =>
									updateStyle({
										shadow: { ...(element.attrs.shadow as ElementShadow), offsetX },
									})
								}
							/>
							<NumberField
								label="Y"
								value={element.attrs.shadow.offsetY}
								disabled={locked}
								onCommit={(offsetY) =>
									updateStyle({
										shadow: { ...(element.attrs.shadow as ElementShadow), offsetY },
									})
								}
							/>
						</div>
					</div>
				)}
			</div>

			<div className="flex items-center justify-between text-xs">
				<span className="text-muted-foreground">不透明度</span>
				<span className="tabular-nums text-foreground">{Math.round(opacity * 100)}%</span>
			</div>
		</section>
	);
}
