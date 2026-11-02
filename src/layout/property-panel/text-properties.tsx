import {
	TEXT_ALIGN_OPTIONS,
	TEXT_FONT_OPTIONS,
	TEXT_FONT_SIZE,
	TEXT_LINE_HEIGHT,
	TEXT_WEIGHT_OPTIONS,
} from "@/base/elements";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ElementStylePatch } from "@/lib/emitter";
import { cn } from "@/lib/utils";
import type { ElementAttrs } from "@/store";
import { NumberField } from "./number-field";

interface TextPropertiesProps {
	attrs: ElementAttrs;
	disabled?: boolean;
	onChange: (patch: ElementStylePatch) => void;
}

/** 一排互斥选项。用 shadcn 的 Button 拼，避免为了一个分段控件引入新组件 */
function Segmented<T extends string>({
	options,
	value,
	disabled,
	onSelect,
}: {
	options: readonly { value: T; label: string }[];
	value: string;
	disabled?: boolean;
	onSelect: (value: T) => void;
}) {
	return (
		<div className="flex min-w-0 flex-1 gap-1">
			{options.map((option) => (
				<Button
					key={option.value}
					type="button"
					size="xs"
					variant={option.value === value ? "secondary" : "ghost"}
					className="flex-1 px-1"
					disabled={disabled}
					onClick={() => onSelect(option.value)}
				>
					{option.label}
				</Button>
			))}
		</div>
	);
}

/** 文本元素专属：字号、行高、字重、对齐、字体（字色在「文字颜色」那一栏里） */
export function TextProperties({ attrs, disabled, onChange }: TextPropertiesProps) {
	const fontSize = typeof attrs.fontSize === "number" ? attrs.fontSize : TEXT_FONT_SIZE;
	const lineHeight = typeof attrs.lineHeight === "number" ? attrs.lineHeight : TEXT_LINE_HEIGHT;
	const weight = String(attrs.fontWeight ?? "400");
	const align = typeof attrs.textAlign === "string" ? attrs.textAlign : "left";
	const family =
		typeof attrs.fontFamily === "string" ? attrs.fontFamily : TEXT_FONT_OPTIONS[0].value;
	const familyLabel = TEXT_FONT_OPTIONS.find((option) => option.value === family)?.label ?? "自定义";

	return (
		<div className="flex flex-col gap-2">
			<h3 className="text-xs font-medium text-muted-foreground">文字</h3>

			<div className="flex flex-col gap-1.5">
				<div className="grid grid-cols-2 gap-x-2">
					<NumberField
						label="字号"
						value={fontSize}
						disabled={disabled}
						onCommit={(value) => onChange({ fontSize: value })}
					/>
					<NumberField
						label="行高"
						value={lineHeight}
						disabled={disabled}
						onCommit={(value) => onChange({ lineHeight: value })}
					/>
				</div>

				<div className="flex items-center gap-1.5">
					<span className="w-8 shrink-0 text-xs text-muted-foreground">字重</span>
					<Segmented
						options={TEXT_WEIGHT_OPTIONS}
						value={weight}
						disabled={disabled}
						onSelect={(value) => onChange({ fontWeight: value })}
					/>
				</div>

				<div className="flex items-center gap-1.5">
					<span className="w-8 shrink-0 text-xs text-muted-foreground">对齐</span>
					<Segmented
						options={TEXT_ALIGN_OPTIONS}
						value={align}
						disabled={disabled}
						onSelect={(value) => onChange({ textAlign: value })}
					/>
				</div>

				<div className="flex items-center gap-1.5">
					<span className="w-8 shrink-0 text-xs text-muted-foreground">字体</span>
					<Popover>
						<PopoverTrigger
							disabled={disabled}
							className={cn(
								"flex h-6 min-w-0 flex-1 items-center justify-between rounded-md px-1.5 text-xs text-foreground transition-colors",
								"hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
							)}
						>
							<span className="truncate">{familyLabel}</span>
						</PopoverTrigger>
						<PopoverContent align="start" className="w-40 p-1">
							<div className="flex flex-col gap-0.5">
								{TEXT_FONT_OPTIONS.map((option) => (
									<Button
										key={option.value}
										type="button"
										size="xs"
										variant={option.value === family ? "secondary" : "ghost"}
										className="justify-start"
										onClick={() => onChange({ fontFamily: option.value })}
									>
										{option.label}
									</Button>
								))}
							</div>
						</PopoverContent>
					</Popover>
				</div>
			</div>
		</div>
	);
}
