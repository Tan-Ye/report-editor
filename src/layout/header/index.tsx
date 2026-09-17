import { ToolsBtn } from "./tools-btn";
import { ElementBtn } from "./element-btn";
import { ProjectBtn } from "./project-btn";

export function Header() {
  return (
    <header className="w-full h-12 flex px-6 items-center justify-between border-b-2 border-b-border">
      <ToolsBtn />
      <ElementBtn />
      <ProjectBtn />
    </header>
  );
}