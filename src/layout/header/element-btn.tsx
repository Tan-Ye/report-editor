import { Fragment, useSyncExternalStore } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ELEMENT_COMMAND, emitter } from "@/lib/emitter";
import { selectionStore } from "@/store";
import type { AlignDirection } from "@/lib/element/align";

interface AlignAction {
  direction: AlignDirection;
  label: string;
  icon: typeof AlignStartVertical;
}

/** 前三个是水平方向的对齐，后三个是垂直方向 */
const ALIGN_ACTIONS: AlignAction[] = [
  { direction: "left", label: "左对齐", icon: AlignStartVertical },
  { direction: "center-x", label: "水平居中", icon: AlignCenterVertical },
  { direction: "right", label: "右对齐", icon: AlignEndVertical },
  { direction: "top", label: "上对齐", icon: AlignStartHorizontal },
  { direction: "center-y", label: "垂直居中", icon: AlignCenterHorizontal },
  { direction: "bottom", label: "下对齐", icon: AlignEndHorizontal },
];

/**
 * 对齐操作组。
 * 基准是「选中元素的整体包围盒」，所以至少要选中 2 个才有意义；
 * 单个元素对齐到页面是另一个功能，走右键菜单。
 */
export function ElementBtn() {
  const selection = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSnapshot);
  const disabled = selection.ids.length < 2;

  // 六个按钮共用一个入口，只有方向参数不同
  const handleAlign = (direction: AlignDirection) => {
    emitter.emit(ELEMENT_COMMAND, { type: "align", direction });
  };

  return (
    <div
      role="toolbar"
      aria-label="对齐"
      className="flex items-center gap-0.5 rounded-lg border border-border/70 bg-background p-0.5"
    >
      {ALIGN_ACTIONS.map((action, index) => {
        const Icon = action.icon;
        return (
          <Fragment key={action.direction}>
            {index === 3 && (
              <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label={action.label}
              title={disabled ? `${action.label}（至少选中 2 个元素）` : action.label}
              onClick={() => handleAlign(action.direction)}
              className="rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Icon className="size-4" />
            </Button>
          </Fragment>
        );
      })}
    </div>
  );
}
