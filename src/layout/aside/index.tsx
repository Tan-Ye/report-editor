import { useSyncExternalStore } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { historyStore, pageStore } from "@/store";
import { PageItem } from "./page";

/** 订阅函数与快照函数放模块级：引用稳定，避免每次渲染重新订阅 */
const subscribePages = (onStoreChange: () => void) => pageStore.subscribe(onStoreChange);
const getPagesSnapshot = () => pageStore.state;

export function Aside() {
  const { pages, current } = useSyncExternalStore(subscribePages, getPagesSnapshot);

  const handleAddPage = () => {
    const index = pageStore.addPage();
    // 新建后直接切过去，画布会通过 pageStore 的订阅自动装载空白页
    pageStore.setCurrentPage(index);
    historyStore.commit();
  };

  const handleSelectPage = (index: number) => {
    pageStore.setCurrentPage(index);
  };

  const handleDeletePage = (index: number) => {
    pageStore.deletePage(index);
    historyStore.commit();
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-chrome">
      <div className="flex h-10 shrink-0 items-center justify-between pl-3 pr-1.5">
        <div className="flex items-baseline gap-1.5">
          <h2 className="text-sm font-medium text-foreground">页面</h2>
          <span className="text-xs tabular-nums text-muted-foreground">{pages.length}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="新建页面"
          aria-label="新建页面"
          onClick={handleAddPage}
          className="text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-4" />
        </Button>
      </div>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <div className="flex flex-col gap-1">
          {pages.map((page, index) => (
            <PageItem
              // pageId 由 createPage 保证非空，未落盘的文件在读取时也会补齐
              key={page.pageId}
              index={index}
              name={page.pageName}
              active={index === current}
              canDelete={pages.length > 1}
              onSelect={() => handleSelectPage(index)}
              onDelete={() => handleDeletePage(index)}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}
