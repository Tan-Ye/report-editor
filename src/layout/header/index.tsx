import { ToolsBtn } from "./tools-btn";
import { ElementBtn } from "./element-btn";
import { HistoryBtn } from "./history-btn";
import { ProjectBtn } from "./project-btn";

/**
 * 顶栏用 1fr / auto / 1fr 三栏网格，保证中间的编辑操作组真正居中，
 * 不会因为左右两组宽度不同而漂移（justify-between 做不到这一点）。
 */
export function Header() {
  return (
    <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border bg-chrome px-3">
      <div className="flex min-w-0 items-center justify-start">
        <ToolsBtn />
      </div>
      <div className="flex items-center justify-center gap-1">
        <HistoryBtn />
        <ElementBtn />
      </div>
      <div className="flex min-w-0 items-center justify-end">
        <ProjectBtn />
      </div>
    </header>
  );
}
