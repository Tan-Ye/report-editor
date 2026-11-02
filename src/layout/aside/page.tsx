import { useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";
import { baseHeight, baseWidth } from "@/base";
import { Button } from "@/components/ui/button";
import { requestPageThumbnail } from "@/lib/page-thumbnail";
import { cn } from "@/lib/utils";
import type { PageInfo } from "@/store";
import { useInView } from "./use-in-view";

interface PageItemProps {
  page: PageInfo;
  index: number;
  active: boolean;
  /** 只剩一页时不允许删除 */
  canDelete: boolean;
  /** 已生成的缩略图（data URL）；还没有时就是一张白纸 */
  thumbnail?: string;
  onSelect: () => void;
  onDelete: () => void;
}

/**
 * 单个页面条目：16:9 缩略图 + 页码角标 + 名称/尺寸。
 * 外层用 div 而不是 button —— 删除按钮要放在里面，button 不能嵌套 button。
 */
export function PageItem({
  page,
  index,
  active,
  canDelete,
  thumbnail,
  onSelect,
  onDelete,
}: PageItemProps) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const inView = useInView(previewRef);

  // 懒加载：滚到可见才离屏渲染。当前页不走这里 —— 它由画布直接抓图，所见即所得
  useEffect(() => {
    if (!inView || active) {
      return;
    }
    requestPageThumbnail(page);
  }, [inView, active, page]);

  return (
    <div className="group relative">
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={onSelect}
        className={cn(
          "flex w-full flex-col gap-1.5 rounded-lg p-1.5 text-left transition-colors",
          active ? "bg-accent" : "hover:bg-accent/60",
        )}
      >
        <div
          ref={previewRef}
          className={cn(
            "relative aspect-video w-full overflow-hidden rounded-md border bg-white transition-shadow",
            active
              ? "border-primary/50 shadow-sm ring-2 ring-primary/25"
              : "border-border/80 group-hover:border-border",
          )}
        >
          {/*
            缩略图只展示，不参与任何交互：
            draggable=false 防止拖拽起一张系统图片，pointer-events-none 让点击落到外层按钮上
          */}
          {thumbnail && (
            <img
              src={thumbnail}
              alt=""
              draggable={false}
              className="pointer-events-none size-full select-none object-contain"
            />
          )}

          <span className="absolute left-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded bg-foreground/85 px-1 text-xs font-medium leading-none tabular-nums text-background">
            {index + 1}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 px-0.5">
          <span className="truncate text-xs font-medium text-foreground">
            {page.pageName || `第 ${index + 1} 页`}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {baseWidth}×{baseHeight}
          </span>
        </div>
      </button>

      {canDelete && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`删除第 ${index + 1} 页`}
          title="删除页面"
          onClick={onDelete}
          className="absolute right-2 top-2 bg-background/90 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="size-3" />
        </Button>
      )}
    </div>
  );
}
