import "./App.css";
import "./global.css";

import { Toaster } from "@/components/ui/toast";
import { CloseConfirmDialog } from "@/components/app/close-confirm-dialog";
import { DraftRecoveryDialog } from "@/components/report/draft-box";
import {
	useCloseGuard,
	useDraftAutosave,
	useHistoryShortcuts,
	useMediaPreload,
	useRestoreReport,
	useSaveShortcut,
	useUiPreferences,
} from "@/hooks";
import { Container } from "@/layout";

function App() {
  // 全局快捷键：撤销/重做、保存
  useHistoryShortcuts();
  useSaveShortcut();
  // 未保存的草稿定时写进 cache
  useDraftAutosave();
  // 启动时恢复上一次的报告（没有才新建），顺带发现上次没保存的内容
  const { draftPrompt } = useRestoreReport();
  // 本地 UI 偏好：最近使用色这类不进文档的习惯
  useUiPreferences();
  // 图片预载：所有页的图都排队加载，切页/缩略图不缺图
  useMediaPreload();
  // 关窗拦截：有未保存内容时先问一句
  const closeGuard = useCloseGuard();

  return (
    <Toaster>
      <main className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground antialiased">
        <Container />
      </main>
      <CloseConfirmDialog
        open={closeGuard.asking}
        onSave={() => void closeGuard.closeAfterSave()}
        onDiscard={() => void closeGuard.closeWithoutSaving()}
        onCancel={closeGuard.cancelClose}
      />
      {/* 启动时发现上次没保存的内容：恢复 / 丢弃 / 稍后 */}
      {draftPrompt && (
        <DraftRecoveryDialog
          drafts={draftPrompt.drafts}
          onRestore={() => void draftPrompt.restoreAll()}
          onDiscard={() => void draftPrompt.discardAll()}
          onDismiss={draftPrompt.dismiss}
        />
      )}
    </Toaster>
  );
}

export default App;
