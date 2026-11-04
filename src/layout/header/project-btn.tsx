import { FilePlus2, Save } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { OpenReportDrawer } from "@/components/report/open-report-drawer";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { saveReport } from "@/lib/report-service";
import { openNewReportWindow } from "@/lib/report-window";
import { saveStateStore } from "@/store";

export function ProjectBtn() {
  const view = useSyncExternalStore(saveStateStore.subscribe, saveStateStore.getSnapshot);
  const [creating, setCreating] = useState(false);

  const handleNew = async () => {
    if (creating) {
      return;
    }
    setCreating(true);
    try {
      await openNewReportWindow();
      // 新窗口自己会打开，这边只留个痕迹，避免用户以为没反应
      toast.add({ title: "已新建报告", description: "在新窗口里开始编辑", type: "success" });
    } catch (error) {
      toast.add({
        title: "新建报告失败",
        description: error instanceof Error ? error.message : String(error),
        type: "error",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        className="gap-1.5 text-muted-foreground hover:text-foreground"
        title="新建报告（打开一个新窗口）"
        disabled={creating}
        onClick={() => void handleNew()}
      >
        <FilePlus2 className="size-4" />
        {creating ? "创建中…" : "新建"}
      </Button>
      <OpenReportDrawer />
      <Button
        type="button"
        className="gap-1.5"
        title={view.dirty ? "有未保存的改动 (Ctrl+S)" : "保存 (Ctrl+S)"}
        disabled={view.saving}
        onClick={() => void saveReport()}
      >
        <Save className="size-4" />
        {view.saving ? "保存中…" : "保存"}
      </Button>
    </div>
  );
}
