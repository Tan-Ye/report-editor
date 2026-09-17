import { Button } from "@/components/ui/button";
import { ComponentProps } from "react";
import { LineSquiggle, MousePointer, File, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import {useKeyPress} from 'ahooks'

interface ToolBtnProps extends ComponentProps<typeof Button> {
  children: React.ReactNode;
  keyCode?: string;
  onClick?: () => void;
  title?: string;
}

function ToolBtn ({ children, className, keyCode, onClick, ...props }: ToolBtnProps) {
  useKeyPress((e: KeyboardEvent) => {
    if (!keyCode) {
      return false
    }
    if (e.key === keyCode) {
      console.log('press', keyCode)
    }
    return true
  },() => {
    onClick?.()
  })
  return <Button className={cn("w-8 h-8 flex items-center justify-center shadow-none ", className)} onClick={onClick} {...props}>{children}</Button>
}

export function ToolsBtn() {
  return (
    <div className="flex items-center rounded-2xl ">
      <ToolBtn title="文件"><File className="w-6 h-6" /></ToolBtn>
      <ToolBtn title="鼠标"><MousePointer className="w-6 h-6" /></ToolBtn>
      <ToolBtn title="线"><LineSquiggle className="w-6 h-6" /></ToolBtn>
      <ToolBtn title="形状"><Circle className="w-6 h-6" /></ToolBtn>
    </div>
  );
}