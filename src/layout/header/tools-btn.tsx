import type { ComponentProps, ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { useKeyPress } from "ahooks";
import { File, MousePointer2, Square, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  LINE_STYLE_OPTIONS,
  SHAPE_OPTIONS,
  SHAPE_PATHS,
  type LineStyle,
  type ShapeType,
} from "@/base/elements";
import { toolStore, type ToolId } from "@/store";
import { isEditableTarget } from "@/lib/dom";
import { cn } from "@/lib/utils";
import { ToolMenu } from "./tool-menu";

const TOOL_SHORTCUTS = { v: "select", r: "rect", l: "line", o: "shape", t: "text" } as const;

type ShortcutKey = keyof typeof TOOL_SHORTCUTS;

const isShortcutKey = (key: string): key is ShortcutKey =>
  Object.prototype.hasOwnProperty.call(TOOL_SHORTCUTS, key);

const PREVIEW_STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** 线条样式预览：直接画出该样式，比用通用图标更直观 */
function LinePreview({ style }: { style: LineStyle }) {
  const dashed = style === "dashed" || style === "dashed-arrow";
  const dotted = style === "dotted";
  const hasEndArrow = style === "arrow" || style === "double-arrow" || style === "dashed-arrow";
  const hasStartArrow = style === "double-arrow";

  return (
    <svg viewBox="0 0 20 12" className="size-4" aria-hidden="true">
      {style === "double" ? (
        <>
          <line x1="2" y1="4" x2="18" y2="4" {...PREVIEW_STROKE} />
          <line x1="2" y1="8" x2="18" y2="8" {...PREVIEW_STROKE} />
        </>
      ) : (
        <line
          x1="2"
          y1="6"
          x2={hasEndArrow ? "15" : "18"}
          y2="6"
          {...PREVIEW_STROKE}
          strokeDasharray={dashed ? "3 2" : dotted ? "0.5 2" : undefined}
        />
      )}
      {hasEndArrow && <path d="M 14 3 L 18 6 L 14 9" {...PREVIEW_STROKE} />}
      {hasStartArrow && <path d="M 6 3 L 2 6 L 6 9" {...PREVIEW_STROKE} />}
    </svg>
  );
}

/** 形状图标直接用绘制时的那条路径，保证「图标长什么样，画出来就是什么样」 */
function ShapeIcon({ type }: { type: ShapeType }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={9}
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={SHAPE_PATHS[type]} />
    </svg>
  );
}

interface ToolButtonProps extends Omit<ComponentProps<typeof Button>, "children"> {
  label: string;
  /** 传布尔值表示这是可切换工具；「文件」这类一次性动作不传，避免误播报 aria-pressed */
  active?: boolean;
  children: ReactNode;
}

function ToolButton({ label, active, className, children, ...props }: ToolButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "rounded-md text-muted-foreground",
        "hover:bg-accent hover:text-foreground",
        active && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

export function ToolsBtn() {
  const activeTool = useSyncExternalStore(toolStore.subscribe, toolStore.getActiveTool);
  const lineStyle = useSyncExternalStore(toolStore.subscribe, toolStore.getLineStyle);
  const shapeType = useSyncExternalStore(toolStore.subscribe, toolStore.getShapeType);

  const selectTool = (tool: ToolId) => {
    toolStore.setTool(tool);
  };

  // 带功能键的组合（Ctrl+R 刷新、Ctrl+Z 撤销等）不能触发工具切换
  useKeyPress(
    (event: KeyboardEvent) =>
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !isEditableTarget(event.target) &&
      isShortcutKey(event.key.toLowerCase()),
    (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (isShortcutKey(key)) {
        toolStore.setTool(TOOL_SHORTCUTS[key]);
      }
    },
  );

  const lineLabel = LINE_STYLE_OPTIONS.find((option) => option.value === lineStyle)?.label ?? "";
  const shapeLabel = SHAPE_OPTIONS.find((option) => option.value === shapeType)?.label ?? "";

  return (
    <div
      role="toolbar"
      aria-label="绘图工具"
      className="flex items-center gap-0.5 rounded-lg border border-border/70 bg-background p-0.5"
    >
      <ToolButton label="文件">
        <File className="size-4" />
      </ToolButton>
      <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />
      <ToolButton
        label="选择工具 (V)"
        active={activeTool === "select"}
        onClick={() => selectTool("select")}
      >
        <MousePointer2 className="size-4" />
      </ToolButton>
      <ToolButton
        label="矩形工具 (R)"
        active={activeTool === "rect"}
        onClick={() => selectTool("rect")}
      >
        <Square className="size-4" />
      </ToolButton>
      <ToolButton
        label="文本工具 (T)"
        active={activeTool === "text"}
        onClick={() => selectTool("text")}
      >
        <Type className="size-4" />
      </ToolButton>

      <ToolMenu
        label={`线条工具 (L) · 当前 ${lineLabel}`}
        menuLabel="线条样式"
        active={activeTool === "line"}
        trigger={<LinePreview style={lineStyle} />}
        items={LINE_STYLE_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
          icon: <LinePreview style={option.value} />,
          selected: option.value === lineStyle,
          onSelect: () => {
            toolStore.setLineStyle(option.value);
            toolStore.setTool("line");
          },
        }))}
      />

      <ToolMenu
        label={`形状工具 (O) · 当前 ${shapeLabel}`}
        menuLabel="形状"
        active={activeTool === "shape"}
        trigger={<ShapeIcon type={shapeType} />}
        items={SHAPE_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
          icon: <ShapeIcon type={option.value} />,
          selected: option.value === shapeType,
          onSelect: () => {
            toolStore.setShapeType(option.value);
            toolStore.setTool("shape");
          },
        }))}
      />
    </div>
  );
}
