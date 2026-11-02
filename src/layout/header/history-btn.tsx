import { useSyncExternalStore } from "react";
import { Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { historyStore } from "@/store";

/**
 * 撤销/重做。
 * 它们只是 store 操作，恢复后靠 pageStore 的 revision 驱动画布重载。
 */
export function HistoryBtn() {
  const view = useSyncExternalStore(historyStore.subscribe, historyStore.getSnapshot);

  return (
    <div
      role="toolbar"
      aria-label="撤销与重做"
      className="flex items-center gap-0.5 rounded-lg border border-border/70 bg-background p-0.5"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!view.canUndo}
        aria-label="撤销 (Ctrl+Z)"
        title="撤销 (Ctrl+Z)"
        onClick={() => historyStore.undo()}
        className="rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Undo2 className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!view.canRedo}
        aria-label="重做 (Ctrl+Shift+Z)"
        title="重做 (Ctrl+Shift+Z)"
        onClick={() => historyStore.redo()}
        className="rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Redo2 className="size-4" />
      </Button>
    </div>
  );
}
