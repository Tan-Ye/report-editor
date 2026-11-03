import { Save } from "lucide-react";
import { useSyncExternalStore } from "react";
import { OpenReportDrawer } from "@/components/report/open-report-drawer";
import { Button } from "@/components/ui/button";
import { saveReport } from "@/lib/report-service";
import { saveStateStore } from "@/store";

export function ProjectBtn() {
  const view = useSyncExternalStore(saveStateStore.subscribe, saveStateStore.getSnapshot);

  return (
    <div className="flex items-center gap-2">
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
