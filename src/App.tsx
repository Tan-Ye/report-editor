import "./App.css";
import "./global.css";

import { Toaster } from "@/components/ui/toast";
import { useDraftAutosave, useHistoryShortcuts, useRestoreReport, useSaveShortcut } from "@/hooks";
import { Container } from "@/layout";

function App() {
  // 全局快捷键：撤销/重做、保存
  useHistoryShortcuts();
  useSaveShortcut();
  // 未保存的草稿定时写进 cache
  useDraftAutosave();
  // 启动时恢复上一次的报告（没有才新建）
  useRestoreReport();

  return (
    <Toaster>
      <main className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground antialiased">
        <Container />
      </main>
    </Toaster>
  );
}

export default App;
