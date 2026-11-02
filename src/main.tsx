import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from "@/components/ui/toast";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  // Toaster 必须在最外层：它提供 toast 上下文，并渲染右下角的提示浮层
  <Toaster>
    <App />
  </Toaster>,
);
