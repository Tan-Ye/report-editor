import {
	ELEMENT_COMMAND,
	emitter,
	type ElementCommandPayload,
} from "@/lib/emitter";
import type { FillSpec } from "@/store";
import { FillEditor } from "./fill-editor";

/**
 * 页面背景的属性。
 *
 * 背景不是受管元素：它没有 id、不参与选中/层级/对齐，也不进 elements。
 * 所以面板这边只能改填充，几何（尺寸）固定为页面尺寸。
 */
export function PageProperties({ fill }: { fill: FillSpec | undefined }) {
	const update = (paint: FillSpec, options?: { commit?: boolean }) => {
		emitter.emit<ElementCommandPayload>(ELEMENT_COMMAND, {
			type: "update-page-background",
			paint,
			commit: options?.commit ?? true,
		});
	};

	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
					背景
				</span>
			</div>

			<div className="flex flex-col gap-2">
				<h3 className="text-xs font-medium text-muted-foreground">填充</h3>
				<FillEditor value={fill} onChange={update} />
			</div>
		</section>
	);
}
