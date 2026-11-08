# 项目特有规则 · agent 协作

## 令行禁止（最高优先级）

- **严格执行用户命令，绝不多做一件事。**
- 让改 A 就只改 A：没让改的文件不动，没让加的功能不加，没让做的重构不做。
- 发现别的问题先报告、等指令，不顺手修，不"顺便优化"。
- 命令有歧义先问，不按自己的理解扩大范围。
- 做完即停；有建议可以提，但要标明是建议，不动手。

---

这是给接手本项目的 agent 的**硬性约定**，和 `conv/rules/`（通用规则）、
`frontend-structure.md`（目录职责）、`frontend-style.md`（样式）配合使用：
通用规则讲"怎么做前端"，本文件讲"这个项目里哪些边界不能碰、踩过哪些坑"。

> `NOTES.md` 是给人看的交接文档（不进版本库），记录"为什么这么做"；
> 本文件记录"必须怎么做"。

---

## 0. 先确认方案，再动代码

- 新功能、重构、目录调整这类成本高的改动：**先给方案**（数据怎么存、交互怎么走、动哪些文件、多少量、怎么验证），**确认后**再写。
- 方案没确认之前只讨论，不落代码、不建文件、不改目录。
- 做到一半发现要改方案：停下来同步，不要自己扩范围。
- 一行的小修（错别字、明显 bug）可以直接改。

## 1. fabric 一律按左上角原点（项目约定）

- fabric v7 默认 origin 是 **center**（`fabricObjectDefaultValues` 里 originX/originY = CENTER），不是老版本的 left/top。
- **本项目约定不改 fabric 的全局默认值**，而是要求所有新建对象**显式写** `originX: "left", originY: "top"`。
- 读位置时 `left/top` 就是左上角；不要用 `getCenterPoint()` 反推，也不要按中心点算偏移。
- 元素定义的 `build()`（`src/lib/element/definitions.ts`）已经是这个约定，新增类型照抄。
- 临时画布对象（遮罩、占位、裁剪框）同样要写 origin —— 少写一个就整体偏半个宽高。
- 依赖 Group / ActiveSelection 内置变换的代码，改动前先确认原点假设，不要顺手改全局默认。

## 2. 前端只负责绘制，IO / 请求全部交给 Rust

- 前端禁止 `fetch` / `XMLHttpRequest` / 直接文件 API；磁盘和网络一律走 Rust：
  自写 Tauri command，或官方插件（`plugin-fs` / `plugin-dialog` / `plugin-opener`）。
- 新增存储或请求：先加 `src-tauri/src/commands/`，再在 `src/lib/` 包一层 invoke（参考 `report/service/storage.ts`）。
- 报告路径统一走 `src/lib/report/path.ts`（`ReportArea = "data" | "cache" | "templates"`），**不要手拼** `data/xxx`。
- 媒体文件按内容 hash 命名，JSON 里只存相对路径 `media/<hash>`，不存绝对路径。
- 现成实现：`report/service/storage.ts`（文件）、`agent/llm.ts`（模型请求）、`update-service`（GitHub API）。

## 3. 元素创建入口必须对外导出

- 所有能造出元素对象的方法都要导出，方便 agent / 工具层复用：
  `src/lib/element/registry.ts` 的 `createElementFromInfo`、`buildElementObject`；
  `src/lib/report/commands.ts` 的 `addElement` / `updateElement`。
- 新增元素类型 = 在 `definitions.ts` 注册 `build` + `props` 白名单，并保证能从 attrs 重建；
  不要在画布 hook 或属性面板里另写一套构造逻辑。
- 判断元素功能一律看 `elementType`，**禁止 `instanceof fabric.Rect/Image`**：
  图片元素内部就是一个带图片填充的 `Rect`。
- 文本元素是自绘的 `RichTextBox`（段落模型 + 逐行 fillText），**不要用 `fabric.Textbox`，
  也不要包 `fabric.Group`**：排版在 `rich-layout.ts`、渲染在 `rich-object.ts`、
  编辑覆盖层在 `rich-text-editor.tsx`，数据在 `rich-text.ts`（详见 NOTES §40）。

## 4. 状态、历史、画布的分工

- `store` 是唯一真值：画布只读 store，写回走 `ELEMENT_COMMAND` 或 store 方法，全部不可变更新。
- 一次用户操作只 `historyStore.commit()` 一次（多选删除、粘贴一批、裁剪确认都是一步撤销）。
- `pageStore` 只在结构性变化（页数、当前页、整体替换）时通知；元素增删改不 emit。
- 缩略图 / 离屏渲染必须用**不登记**的 `buildElementObject`，
  用 `createElementFromInfo` 会在 `elementObjectMap` 里留下画布上不存在的幽灵对象。
- 几何真值在 fabric 对象上（拖拽后 dump 回 store），样式真值在 JSON 里（fabric 永不回读）。

## 5. 序列化与文件格式

- 存文件走每个元素类型的 `props` 白名单 + 纯数据，**不要用 fabric 的 `toObject()`**。
- 改文件格式（加字段、改语义）：先改金标 `test/fixtures/report-v1.json`，再跑测试，看哪条挂。
- 空文本元素保存时会被过滤（`report-file.ts` 的 `isMeaningfulElement`），不要依赖空文本落盘。
- 图片裁剪存 `FillSpec.crop`（源图像素矩形），有 crop 时 `fit` 不参与渲染。

## 6. 窗口、长任务与画布锁

- 新窗口 label 必须是 `report-*`（`capabilities` 靠它授权），走 `src/lib/report/service/window.ts`。
- 同一报告同时只能在一个窗口打开：`report/service/session.ts` 的占用登记，打开前先 `claimReport`。
- agent / 示例演示这类会长时间改画布的任务用 `acquireCanvasLock()`。
- 会覆盖画布的 UI（如裁剪层）要显式让其它交互让路：空格平移、Delete/Ctrl+C/V、Ctrl+Z、
  右键菜单、面板命令、Ctrl+滚轮缩放；换页或视口变化直接退出。

## 7. 样式与颜色

- 颜色与字号规则见 `frontend-style.md`；补充：fabric 读不到 CSS 变量，
  颜色统一从 `src/lib/theme-tokens.ts` 的 `getReportPalette()` 取。

## 8. 验证与提交

- 唯一自动化验证：`.\node_modules\.bin\tsc.cmd --noEmit`，必须 EXIT=0。
- `vitest` 需要放宽沙箱权限（esbuild 起子进程），提交前跑一遍。
- **交互必须手点验证**：布局、拖拽、裁剪这类问题 `tsc` 查不出来（本项目已因此返工过）。
- 提交：`git add -A` 后把 `NOTES.md` 撤出 —— 注意大小写，
  用 `git reset -- HEAD -- NOTES.md`（`-- notes` 匹配不到）；
  commit message 用 UTF-8 无 BOM（`[System.IO.File]::WriteAllText(..., UTF8Encoding($false))`）。
- `NOTES.md` 不进版本库；新接手先读它。

## 9. 目录约定

- 目录职责见 `frontend-structure.md`；`src/lib/` 的补充约定：
  - 按领域分文件夹：`agent/` `report/` `demo/` `element/` `utils/`。
  - **成组的进文件夹，单文件的留根上**；别为整齐造只装一个文件的目录。
  - 领域内可再分层：`report/service/` 放 IO 与编排，根上放纯逻辑与渲染。
  - 文件夹内文件名去掉重复前缀（`report/storage.ts` 而不是 `report/report-storage.ts`）。
  - 领域目录允许有出口文件（如 `report/service/index.ts`）；`lib` 根上不设 barrel。
  - 组件按"一块 UI"切，不按"一个组件一个文件"切。

## 10. 踩过的坑（按出现频率）

1. **fabric v7 origin 默认 center**（本文件第 1 条），不显式写就整体偏移。
2. **base-ui 的 `GroupLabel` 必须包在 `Group` 里**，否则运行时直接抛错。
3. `usePageThumbnail` 必须排在 `usePage` 之前（store 按订阅顺序通知）。
4. `useCanvasTeardown` 必须最后调用（fabric dispose 后其它 hook 再碰会炸）。
5. 文本编辑靠 body 上的隐藏 textarea 收键盘，监听快捷键要避开它。
6. `renameReportDir` 要显式传 `area`，别默认是 `data/`。
7. 恢复草稿后的脏标记要用 `saveStateStore.markDirty()`；`historyStore.commit()` 在 reset 后是空操作。
8. 图片是异步解码的：缩略图 / 导出 / 裁剪前先 `ensureMediaImages()`。
9. 新增/调整目录后记得全仓 import 一起改，改完必须 `tsc`（本仓库没有 lint 兜底）。
10. `NOTES.md` 提交时要显式撤出（见第 8 条）。
