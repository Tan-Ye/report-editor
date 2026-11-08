import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from "@/components/ui/toast";

const container = document.getElementById("root") as HTMLElement;
// 清掉 index.html 里的启动占位；body 底色和它一致，所以不会闪白
container.replaceChildren();

ReactDOM.createRoot(container).render(
  // Toaster 必须在最外层：它提供 toast 上下文，并渲染右下角的提示浮层
  <Toaster>
    <App />
  </Toaster>,
);
