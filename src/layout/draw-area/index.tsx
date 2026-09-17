import { useEffect, useRef } from "react";
import * as fabric from "fabric";
import { useSize } from "ahooks";
import { bgCanvasWidth, bgCanvasHeight } from "@/base/index";
import { computeCanvasPositionAndSize } from "@/lib/utils";

export function DrawArea() {
  const boardContainer = useRef<HTMLDivElement>(null)
  // const containerSize = useSize(boardContainer)

  const bgCanvasRef = useRef<fabric.Canvas>(null)
  // console.log('containerSize', containerSize);
  useEffect(() => {
    // 初始化画布
    // 背景与范围的画布初始化
    if (bgCanvasRef.current || !boardContainer.current) {
      return
    }
    console.log('111111111111', boardContainer.current);

    const containerRect = boardContainer.current.getBoundingClientRect()
    // 创建 canvas，但不指定元素，让 fabric 自己创建
    const canvas = new fabric.Canvas(undefined, {
      width: bgCanvasWidth,
      height: bgCanvasHeight,
      backgroundColor: 'gray',
    })

    bgCanvasRef.current = canvas

    // 获取 fabric 创建的 wrapper
    const wrapper = canvas.wrapperEl
    if (wrapper && boardContainer.current) {
      // 清空容器并添加 wrapper
      boardContainer.current.innerHTML = ''
      boardContainer.current.appendChild(wrapper)
      
      // 设置 wrapper 样式
      Object.assign(wrapper.style, {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: `${bgCanvasWidth}px`,
        height: `${bgCanvasHeight}px`,
      })
    }
    const canvasPosition = computeCanvasPositionAndSize({containerRect})
    console.log('containerRect width height',containerRect, canvasPosition);
    const bgRect = new fabric.Rect({
      ...canvasPosition,
      // scale: 0,
      // left:0,
      // top:0,
      scaleX: canvasPosition.scale,
      scaleY: canvasPosition.scale,
      // scaleX: 0.5,
      // scaleY: 1,
      fill: 'white',
      draggable: false,
      lockMovement: true,
      selectable: false,
      moveCursor: 'default',
      rotateCursor: 'default',
      scaleCursor: 'default',
      hoverCursor: 'default',
    });
    bgCanvasRef.current.add(bgRect);
    return () => {
      bgCanvasRef.current = null
    }
  }, [])

  return (
    <div className="w-full h-full flex items-center justify-center bg-background border-border relative flex-1 overflow-hidden" ref={boardContainer} />
  );
}