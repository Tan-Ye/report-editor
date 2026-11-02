# report-editor · 报表编辑器

用 Tauri 2 + React 19 做的桌面端报表编辑器，画布基于 Fabric.js，UI 用 Tailwind CSS 4 + shadcn/Base UI。

**状态：早期骨架（最后一次提交 2026-09-18）**。已经完成四区布局、页面/元素的内存 store、Fabric 背景画布与缩放适配；元素编辑、属性面板、保存/导出、后端接口都还没实现。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面壳 | Tauri 2（Rust） |
| 前端 | React 19 · TypeScript 5.8 · Vite 7 |
| 画布 | Fabric.js 7（依赖里还列了 Konva，目前代码未使用） |
| UI | Tailwind CSS 4 · shadcn · Base UI · lucide-react |
| 工具 | ahooks · clsx · tailwind-merge |

## 目录

```
report-editor/
├── src/
│   ├── layout/          # 顶栏、左侧页面栏、中间画布、右侧属性面板
│   ├── store/           # report / page / element 三个单例 store（element 的基础类带订阅）
│   ├── base/            # 画布尺寸等基础常量
│   └── lib/             # 工具函数与事件总线
├── src-tauri/           # Tauri 2 的 Rust 壳
├── package.json
└── vite.config.ts       # 开发端口固定 9527（strictPort）
```

## 开发

需要 Node 20+、pnpm、Rust，以及 Tauri 2 在 Windows 上的系统依赖（WebView2、MSVC 工具链）。

```bash
pnpm install
pnpm dev          # 只起前端，http://localhost:9527
pnpm tauri dev    # 起桌面窗口，自动拉起 Vite
pnpm build        # tsc + vite build
pnpm tauri build  # 打包桌面应用
```

## 当前进度

- [x] 四区布局：Header / Aside / DrawArea / PropertyPanel
- [x] 报表、页面、元素的内存 store（element 的基础类带监听/订阅机制）
- [x] Fabric 画布初始化、3000×3000 背景与缩放定位
- [ ] 元素添加、选择、拖拽、属性编辑
- [ ] 页面切换、增删与缩略图
- [ ] 项目保存/打开，导出 PDF / 图片
- [ ] 把模板名 `tauri-app-template` 改成 `report-editor`（`package.json`、`src-tauri/Cargo.toml`、`tauri.conf.json`、窗口标题）

## 说明

- 画布逻辑集中在 `src/layout/draw-area/index.tsx`，元素数据结构在 `src/store/element.ts`（`ElementInfo` 包了一个 `FabricObject`）。
- 目前没有测试，也没有持久化；所有数据只存在内存里，刷新即丢。
