import { useState } from "react";
import type { ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ToolMenuItem {
  value: string;
  label: string;
  icon: ReactNode;
  selected: boolean;
  onSelect: () => void;
}

interface ToolMenuProps {
  /** 触发按钮的无障碍名称 */
  label: string;
  /** 下拉面板的名称 */
  menuLabel: string;
  /** 当前工具是否处于激活状态 */
  active: boolean;
  /** 按钮里显示的内容（当前选中的样式/形状） */
  trigger: ReactNode;
  items: ToolMenuItem[];
}

/**
 * 工具下拉。
 * 浮层、定位、点外部关闭、ESC 关闭、aria 状态全部交给 Popover 组件，
 * 这里只保留「选项列表长什么样」这一层业务。
 */
export function ToolMenu({ label, menuLabel, active, trigger, items }: ToolMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            title={label}
            className={cn(
              "relative rounded-md text-muted-foreground",
              "hover:bg-accent hover:text-foreground",
              "aria-expanded:bg-accent aria-expanded:text-foreground",
              active && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
            )}
          >
            {trigger}
            <ChevronDown
              aria-hidden="true"
              className="absolute bottom-0.5 right-0.5 size-2.5 opacity-60"
            />
          </Button>
        }
      />

      <PopoverContent align="start" side="bottom" sideOffset={4} className="w-40 gap-0 p-1">
        <div role="menu" aria-label={menuLabel} className="flex flex-col">
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitemradio"
              aria-checked={item.selected}
              onClick={() => {
                item.onSelect();
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                item.selected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent",
              )}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">{item.icon}</span>
              <span className="truncate">{item.label}</span>
              {item.selected && <Check aria-hidden="true" className="ml-auto size-3 shrink-0" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
