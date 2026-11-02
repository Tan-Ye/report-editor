import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { applyAlpha } from "@/lib/fill";
import { importImageFill } from "@/lib/media";
import type { FillSpec, GradientStop, ImageFit } from "@/store";
import { AngleDial } from "./angle-dial";
import { NumberField } from "./number-field";

/** 第二次参数 commit=false 表示「只是在预览」，不要记历史 */
type FillChange = (fill: FillSpec, options?: { commit?: boolean }) => void;

interface FillEditorProps {
	/** 当前填充：纯色 / 渐变 / 图片 */
	value: FillSpec | undefined;
	disabled?: boolean;
	/** 是否允许渐变/图片（描边这类只支持纯色的地方传 false） */
	gradient?: boolean;
	onChange: FillChange;
}

type GradientFill = Extract<FillSpec, { kind: "gradient" }>;
type ImageFill = Extract<FillSpec, { kind: "image" }>;
type Tab = "solid" | "gradient" | "image";

/** 图片填充的适应方式 */
const FIT_OPTIONS: { value: ImageFit; label: string }[] = [
	{ value: "cover", label: "覆盖" },
	{ value: "contain", label: "适应" },
	{ value: "tile", label: "平铺" },
	{ value: "center", label: "居中" },
	{ value: "original", label: "原始" },
];

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const DEFAULT_GRADIENT: GradientFill = {
	kind: "gradient",
	type: "linear",
	angle: 0,
	stops: [
		{ offset: 0, color: "#4f6dff", alpha: 1 },
		{ offset: 1, color: "#a855f7", alpha: 1 },
	],
};

/** 把任意写法（#fff / rgb(…) / 令牌解析出来的值）转成 <input type="color"> 认的 #rrggbb */
function toHexColor(color: string | undefined, fallback = "#ffffff"): string {
	if (!color) {
		return fallback;
	}
	if (HEX_COLOR.test(color)) {
		return color.length === 4
			? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
			: color;
	}
	const match = color.match(/rgba?\(([^)]+)\)/i);
	if (!match) {
		return fallback;
	}
	const [r, g, b] = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
	if (![r, g, b].every((channel) => Number.isFinite(channel))) {
		return fallback;
	}
	const hex = (channel: number) =>
		Math.round(Math.min(Math.max(channel, 0), 255)).toString(16).padStart(2, "0");
	return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function stopCss(stop: GradientStop): string {
	return applyAlpha(stop.color, stop.alpha ?? 1);
}

/** 用 CSS 预览当前填充（触发按钮上的小色块与渐变条） */
export function paintCss(value: FillSpec | undefined): string {
	if (!value) {
		return "transparent";
	}
	if (value.kind === "solid") {
		return value.color;
	}
	if (value.kind === "image") {
		// 图片路径暂时用棋盘格表示
		return "repeating-conic-gradient(#d8d8d8 0% 25%, #ffffff 0% 50%) 50% / 8px 8px";
	}
	const stops = [...value.stops]
		.sort((a, b) => a.offset - b.offset)
		.map((stop) => `${stopCss(stop)} ${Math.round(stop.offset * 100)}%`)
		.join(", ");
	if (value.type === "radial") {
		return `radial-gradient(circle at 50% 50%, ${stops})`;
	}
	return `linear-gradient(${value.angle}deg, ${stops})`;
}

function describeFill(value: FillSpec | undefined): string {
	if (!value) {
		return "无";
	}
	if (value.kind === "solid") {
		return value.color;
	}
	if (value.kind === "image") {
		return "图片";
	}
	return value.type === "radial" ? "径向渐变" : "线性渐变";
}

/**
 * 原生取色器。
 *
 * 只听原生 `change`（取色器关闭时触发一次），不听 `input`：
 * 后者在拖动取色器时连续触发，会把撤销历史刷爆。
 */
function ColorInput({
	value,
	disabled,
	onCommit,
}: {
	value: string;
	disabled?: boolean;
	onCommit: (color: string) => void;
}) {
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		const input = inputRef.current;
		if (!input) {
			return;
		}
		const handleChange = () => {
			onCommit(input.value);
		};
		input.addEventListener("change", handleChange);
		return () => {
			input.removeEventListener("change", handleChange);
		};
	}, [onCommit]);

	return (
		<input
			ref={inputRef}
			type="color"
			aria-label="选择颜色"
			disabled={disabled}
			key={value}
			defaultValue={value}
			className="h-7 w-8 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5 disabled:pointer-events-none disabled:opacity-50"
		/>
	);
}

/** 十六进制输入：回车或失焦提交 */
function HexInput({
	value,
	disabled,
	onCommit,
}: {
	value: string;
	disabled?: boolean;
	onCommit: (color: string) => void;
}) {
	const [draft, setDraft] = useState(value);

	useEffect(() => {
		setDraft(value);
	}, [value]);

	const commit = () => {
		const next = draft.trim();
		if (!HEX_COLOR.test(next)) {
			setDraft(value);
			return;
		}
		onCommit(toHexColor(next));
	};

	return (
		<Input
			value={draft}
			disabled={disabled}
			className="h-7 min-w-0 px-1.5 text-xs uppercase tabular-nums"
			onChange={(event) => setDraft(event.target.value)}
			onBlur={commit}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.currentTarget.blur();
				}
			}}
		/>
	);
}

/**
 * 一个色标：颜色 + 位置 + 透明度。
 * 两个数字框在输入时只预览、失焦才提交 —— 否则每敲一个字符就多一步撤销。
 */
function StopRow({
	stop,
	disabled,
	canRemove,
	onChange,
	onRemove,
}: {
	stop: GradientStop;
	disabled?: boolean;
	canRemove: boolean;
	onChange: (stop: GradientStop, commit: boolean) => void;
	onRemove: () => void;
}) {
	const commitNumber = (
		raw: string,
		apply: (value: number) => GradientStop,
		commit: boolean,
	) => {
		const next = Number.parseFloat(raw);
		if (!Number.isFinite(next)) {
			return;
		}
		onChange(apply(next), commit);
	};

	return (
		<div className="flex items-center gap-1">
			<ColorInput
				value={toHexColor(stop.color)}
				disabled={disabled}
				onCommit={(color) => onChange({ ...stop, color }, true)}
			/>
			<Input
				aria-label="色标位置（百分比）"
				value={String(Math.round(stop.offset * 100))}
				disabled={disabled}
				inputMode="numeric"
				className="h-7 w-12 px-1 text-xs tabular-nums"
				onChange={(event) =>
					commitNumber(
						event.target.value,
						(value) => ({ ...stop, offset: Math.min(Math.max(value / 100, 0), 1) }),
						false,
					)
				}
				onBlur={(event) =>
					commitNumber(
						event.target.value,
						(value) => ({ ...stop, offset: Math.min(Math.max(value / 100, 0), 1) }),
						true,
					)
				}
			/>
			<Input
				aria-label="色标透明度（百分比）"
				value={String(Math.round((stop.alpha ?? 1) * 100))}
				disabled={disabled}
				inputMode="numeric"
				className="h-7 w-12 px-1 text-xs tabular-nums"
				onChange={(event) =>
					commitNumber(
						event.target.value,
						(value) => ({ ...stop, alpha: Math.min(Math.max(value / 100, 0), 1) }),
						false,
					)
				}
				onBlur={(event) =>
					commitNumber(
						event.target.value,
						(value) => ({ ...stop, alpha: Math.min(Math.max(value / 100, 0), 1) }),
						true,
					)
				}
			/>
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				aria-label="删除色标"
				disabled={disabled || !canRemove}
				onClick={onRemove}
				className="text-muted-foreground hover:text-destructive"
			>
				<Trash2 className="size-3" />
			</Button>
		</div>
	);
}

/** 纯色 / 渐变编辑面板。只挂载在 Popover 打开时，状态每次打开从当前值重新初始化 */
function FillPanel({
	value,
	allowGradient,
	disabled,
	onChange,
}: {
	value: FillSpec | undefined;
	allowGradient: boolean;
	disabled?: boolean;
	onChange: FillChange;
}) {
	const initialSolid = value?.kind === "solid" ? value.color : "#4f6dff";
	const initialGradient = value?.kind === "gradient" ? value : DEFAULT_GRADIENT;
	const image = value?.kind === "image" ? (value as ImageFill) : null;

	const [tab, setTab] = useState<Tab>(value?.kind ?? "solid");
	const [solid, setSolid] = useState(initialSolid);
	const [gradient, setGradient] = useState<GradientFill>(initialGradient);
	const [importing, setImporting] = useState(false);

	const emitSolid = (color: string) => {
		setTab("solid");
		setSolid(color);
		onChange({ kind: "solid", color }, { commit: true });
	};

	const emitGradient = (next: Partial<GradientFill>, commit = true) => {
		setTab("gradient");
		const merged: GradientFill = { ...gradient, ...next };
		setGradient(merged);
		onChange(merged, { commit });
	};

	const emitImageFit = (fit: ImageFit) => {
		if (!image) {
			return;
		}
		onChange({ ...image, fit }, { commit: true });
	};

	/** 选图 → 复制进 media/ → 直接提交（导入本身是一次有意义的操作） */
	const pickImage = async () => {
		setImporting(true);
		try {
			const fill = await importImageFill();
			if (fill) {
				onChange(fill, { commit: true });
			}
		} finally {
			setImporting(false);
		}
	};

	const updateStop = (index: number, next: GradientStop, commit: boolean) => {
		emitGradient(
			{ stops: gradient.stops.map((stop, i) => (i === index ? next : stop)) },
			commit,
		);
	};

	const addStop = () => {
		if (gradient.stops.length >= 8) {
			return;
		}
		const sorted = [...gradient.stops].sort((a, b) => a.offset - b.offset);
		const last = sorted[sorted.length - 1];
		emitGradient({
			stops: [...gradient.stops, { offset: 0.5, color: last.color, alpha: last.alpha }],
		});
	};

	const removeStop = (index: number) => {
		if (gradient.stops.length <= 2) {
			return;
		}
		emitGradient({ stops: gradient.stops.filter((_, i) => i !== index) });
	};

	return (
		<div className="flex flex-col gap-2.5">
			{allowGradient && (
				<div className="flex gap-1">
					<Button
						type="button"
						size="xs"
						variant={tab === "solid" ? "secondary" : "ghost"}
						className="flex-1"
						disabled={disabled}
						onClick={() => emitSolid(solid)}
					>
						纯色
					</Button>
					<Button
						type="button"
						size="xs"
						variant={tab === "gradient" ? "secondary" : "ghost"}
						className="flex-1"
						disabled={disabled}
						onClick={() => emitGradient({})}
					>
						渐变
					</Button>
					<Button
						type="button"
						size="xs"
						variant={tab === "image" ? "secondary" : "ghost"}
						className="flex-1"
						disabled={disabled}
						// 切到图片只换面板，选中图片本身才算一次修改
						onClick={() => setTab("image")}
					>
						图片
					</Button>
				</div>
			)}

			{tab === "solid" ? (
				<div className="flex items-center gap-1.5">
					<ColorInput value={toHexColor(solid)} disabled={disabled} onCommit={emitSolid} />
					<HexInput value={toHexColor(solid)} disabled={disabled} onCommit={emitSolid} />
				</div>
			) : tab === "image" ? (
				<div className="flex flex-col gap-2">
					<Button
						type="button"
						size="xs"
						variant="outline"
						disabled={disabled || importing}
						onClick={() => void pickImage()}
					>
						{importing ? "导入中…" : image ? "重新选择图片" : "选择图片"}
					</Button>

					{image && (
						<>
							<div className="truncate text-xs text-muted-foreground" title={image.source}>
								{image.source.replace(/^media\//, "")}
							</div>
							<div className="flex flex-wrap gap-1">
								{FIT_OPTIONS.map((option) => (
									<Button
										key={option.value}
										type="button"
										size="xs"
										variant={image.fit === option.value ? "secondary" : "ghost"}
										className="flex-1"
										disabled={disabled}
										onClick={() => emitImageFit(option.value)}
									>
										{option.label}
									</Button>
								))}
							</div>
						</>
					)}
				</div>
			) : (
				<div className="flex flex-col gap-2">
					<div className="flex gap-1">
						<Button
							type="button"
							size="xs"
							variant={gradient.type === "linear" ? "secondary" : "ghost"}
							className="flex-1"
							disabled={disabled}
							onClick={() => emitGradient({ type: "linear" })}
						>
							线性
						</Button>
						<Button
							type="button"
							size="xs"
							variant={gradient.type === "radial" ? "secondary" : "ghost"}
							className="flex-1"
							disabled={disabled}
							onClick={() => emitGradient({ type: "radial" })}
						>
							径向
						</Button>
					</div>

					{gradient.type === "linear" && (
						<div className="flex items-center gap-2">
							<AngleDial
								value={gradient.angle}
								disabled={disabled}
								// 拖动时只预览，松手才记一步历史
								onPreview={(angle) => emitGradient({ angle }, false)}
								onCommit={(angle) => emitGradient({ angle }, true)}
							/>
							<div className="min-w-0 flex-1">
								<NumberField
									label="角度"
									value={gradient.angle}
									suffix="°"
									disabled={disabled}
									onCommit={(angle) => emitGradient({ angle }, true)}
								/>
							</div>
						</div>
					)}

					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-1 pl-0.5 text-xs text-muted-foreground">
							<span className="w-8">颜色</span>
							<span className="w-12 text-center">位置%</span>
							<span className="w-12 text-center">透明%</span>
							<span className="w-6" />
						</div>
						{gradient.stops.map((stop, index) => (
							<StopRow
								// 色标按数组位置管理，没有稳定 id，用索引是这里唯一合理的选择
								key={index}
								stop={stop}
								disabled={disabled}
								canRemove={gradient.stops.length > 2}
								onChange={(next, commit) => updateStop(index, next, commit)}
								onRemove={() => removeStop(index)}
							/>
						))}
						<Button
							type="button"
							size="xs"
							variant="ghost"
							disabled={disabled || gradient.stops.length >= 8}
							onClick={addStop}
							className="justify-start text-muted-foreground"
						>
							+ 添加色标
						</Button>
					</div>

					<div
						aria-hidden="true"
						className="h-4 w-full rounded-sm border border-border"
						// 动态值：当前渐变的可视化预览
						style={{ background: paintCss(gradient) }}
					/>
				</div>
			)}
		</div>
	);
}

/**
 * 填充编辑器：一个色块按钮，点开编辑纯色或渐变。
 * 文本元素里它就是字色。
 */
export function FillEditor({ value, disabled, gradient = true, onChange }: FillEditorProps) {
	return (
		<Popover>
			<PopoverTrigger
				disabled={disabled}
				className="flex h-7 w-full items-center gap-1.5 rounded-lg border border-border bg-background px-1.5 text-left transition-colors hover:bg-accent/60 disabled:pointer-events-none disabled:opacity-50"
			>
				<span
					aria-hidden="true"
					className="size-4 shrink-0 rounded-sm border border-border"
					// 动态值：元素自身的颜色/渐变，必须走行内样式
					style={{ background: paintCss(value) }}
				/>
				<span className="truncate text-xs text-foreground">{describeFill(value)}</span>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-64">
				<FillPanel
					value={value}
					allowGradient={gradient}
					disabled={disabled}
					onChange={onChange}
				/>
			</PopoverContent>
		</Popover>
	);
}
