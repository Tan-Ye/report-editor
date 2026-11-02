import { Download, Save } from "lucide-react";
import { useSyncExternalStore } from "react";
import { OpenReportDrawer } from "@/components/report/open-report-drawer";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { saveReport } from "@/lib/report-service";
import { saveStateStore } from "@/store";

export function ProjectBtn() {
  const view = useSyncExternalStore(saveStateStore.subscribe, saveStateStore.getSnapshot);

  // 导出还没接，先给明确反馈，避免点了没反应
  const handleExport = () => {
    toast.add({
      title: "导出功能尚未接入",
      type: "info",
      description: "导出 PDF / 图片会排在报告文件读写之后实现",
    });
  };

  return (
    <div className="flex items-center gap-2">
      <OpenReportDrawer />
      <Button type="button" variant="outline" className="gap-1.5" onClick={handleExport}>
        <Download className="size-4" />
        导出
      </Button>
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
