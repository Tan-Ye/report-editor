import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

/** 数值统一显示成最多一位小数：拖动缩放出来的 239.99999 要显示成 240 */
export const formatNumber = (value: number) => String(Math.round(value * 10) / 10);

interface NumberFieldProps {
	label: string;
	value: number;
	disabled?: boolean;
	/** 数值后缀，例如角度的「°」 */
	suffix?: string;
	onCommit: (value: number) => void;
	/**
	 * 每次敲入合法数值就回调一次（不经过失焦）。
	 * 给「改了就要立刻生效」的场景用，比如画笔：改完粗细马上落笔，
	 * 如果只等失焦，第一笔用的还是旧值。
	 */
	onInput?: (value: number) => void;
}

/**
 * 可编辑的数值字段。
 * 编辑过程中不跟随外部值 —— 否则拖动元素时正在输入的内容会被冲掉；
 * 失焦或回车才提交，Esc 放弃本次输入。
 */
export function NumberField({
	label,
	value,
	disabled,
	suffix,
	onCommit,
	onInput,
}: NumberFieldProps) {
	const inputId = useId();
	const [draft, setDraft] = useState(() => formatNumber(value));
	const [editing, setEditing] = useState(false);
	/** 按了 Esc：紧接着的失焦不要再提交 */
	const cancelledRef = useRef(false);

	useEffect(() => {
		if (!editing) {
			setDraft(formatNumber(value));
		}
	}, [value, editing]);

	const commit = () => {
		if (cancelledRef.current) {
			cancelledRef.current = false;
			setDraft(formatNumber(value));
			return;
		}

		const next = Number.parseFloat(draft);
		if (!Number.isFinite(next)) {
			setDraft(formatNumber(value));
			return;
		}
		// 按显示精度取整：填 240.55 就落到 240.6，避免「输入框显示 240.6、实际存 240.55」
		const rounded = Math.round(next * 10) / 10;
		setDraft(formatNumber(rounded));
		// 数值没变就不必改画布、写 store、记一步历史
		if (formatNumber(rounded) !== formatNumber(value)) {
			onCommit(rounded);
		}
	};

	return (
		<div className="flex min-w-0 items-center gap-1.5">
			<label htmlFor={inputId} className="w-8 shrink-0 text-xs text-muted-foreground">
				{label}
			</label>
			<div className="relative min-w-0 flex-1">
				<Input
					id={inputId}
					value={draft}
					disabled={disabled}
					inputMode="decimal"
					className="h-7 px-1.5 text-xs tabular-nums"
					onChange={(event) => {
						const text = event.target.value;
						setDraft(text);
						if (onInput) {
							const parsed = Number.parseFloat(text);
							if (Number.isFinite(parsed)) {
								onInput(Math.round(parsed * 10) / 10);
							}
						}
					}}
					onFocus={() => setEditing(true)}
					onBlur={() => {
						setEditing(false);
						commit();
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.currentTarget.blur();
							return;
						}
						if (event.key === "Escape") {
							cancelledRef.current = true;
							event.currentTarget.blur();
						}
					}}
				/>
				{suffix && (
					<span className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-xs text-muted-foreground">
						{suffix}
					</span>
				)}
			</div>
		</div>
	);
}
