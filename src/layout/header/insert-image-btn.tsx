import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ELEMENT_COMMAND, emitter } from "@/lib/emitter";
import { importImageFile } from "@/lib/media";

/**
 * 插入图片元素。
 *
 * 选图 → Rust 复制进报告目录 → 拿到原始尺寸后交给画布按比例摆到页面中间。
 * 图片走的是元素的 `fill`，所以换图、适应方式、缩略图、预载全都复用填充那套。
 */
export function InsertImageBtn() {
	const [busy, setBusy] = useState(false);

	const handleClick = async () => {
		if (busy) {
			return;
		}
		setBusy(true);
		try {
			const imported = await importImageFile();
			if (!imported) {
				return;
			}
			emitter.emit(ELEMENT_COMMAND, {
				type: "insert-image",
				fill: imported.fill,
				width: imported.width,
				height: imported.height,
			});
		} finally {
			setBusy(false);
		}
	};

	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			disabled={busy}
			title="插入图片"
			onClick={() => void handleClick()}
			className="text-muted-foreground hover:bg-accent hover:text-foreground"
		>
			<ImagePlus className="size-4" />
			图片
		</Button>
	);
}
