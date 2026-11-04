# 架构与目录设计

> 这份文档写给**要改这个项目的人**。想从零复刻一份，看 [rebuild-guide.md](./rebuild-guide.md)。

## 一句话

Tauri 2 桌面应用：1920×1080 多页报表画布（Fabric.js），文档存成目录（`report.json` + `media/`），可导出 PDF / 图片 / 长图 / HTML 包，内置 AI 助手直接改画布。

## 分层

```
base/        纯常量与纯数据（画布尺寸、颜色、元素类型清单）—— 不 import 任何东西
store/       状态 + 文档模型 + 序列化（单例 store，subscribe/getSnapshot）
lib/         库层：允许单例和副作用（IO、渲染、命令、agent 编排）
lib/utils/   全局通用的纯函数（不许 import lib，不许含领域知识）
hooks/       跨组件的 React 逻辑（快捷键、草稿自动保存、指针位置）
layout/      四个区域：header / aside / draw-area / property-panel / footer
components/  ui（无业务）、report（报告相关）、agent（AI 面板）
```

依赖方向只能向下：`components → layout → hooks → lib → store → base`。
**反向 import 一律视为 bug**。

## 目录职责（容易踩错的几个）

| 目录 | 放什么 | 不放什么 |
|---|---|---|
| `store/` | 可序列化的状态、文档模型、store 方法 | DOM 引用、fabric 实例的副作用 |
| `lib/` | IO、渲染、命令、导出、agent 编排 | React 组件、UI 状态 |
| `lib/utils/` | `clamp`、`createUniqueId`、路径处理这类纯函数 | `normalizeFill`（这是领域知识，在 `store/fill.ts`） |
| `layout/draw-area/` | 画布相关的 hooks（选择、绘制、画笔、缩放） | 业务命令（在 `lib/report/commands.ts`） |

文件命名：kebab-case；导出用命名导出（不用 default，除了页面级组件）。

## 数据流：三条互不干扰的写路径

```
① 人工操作
   指针事件 → draw-area 的 hooks → 画布改 → readElementInfo 落 store → historyStore.commit()

② agent / 脚本
   lib/report/commands.ts → 改 store → pageStore.replacePages()（bump revision）
                          → 画布整页重载 → historyStore.commit()

③ 打开/撤销
   parseReportFile / history 快照 → applyReportFile → pageStore.replacePages() → 画布重载
```

关键点：**只有 ① 是"画布先行"，② ③ 都是"store 先行"**。

- 手工路径里画布是几何的真值，改完立刻回写 store
- 程序化路径必须写 store，再靠 `replacePages` 让画布跟上——因为元素的增删改**不会 bump revision**，不经过它画布不会刷新
- agent 执行期间用 `withAgentCanvasLock` 锁画布，避免整页重载打断用户正在做的操作

## 文档模型

```
ReportFile { version, reportId, reportName, pageWidth, pageHeight, pages[] }
PageInfo   { pageId, pageName, style?.fill, guides[], elements[] }
ElementInfo{ id, elementType, attrs }
FillSpec   solid | gradient | image
```

- **元素类型决定一切**：判断分支只能用 `elementType`，不能用 `instanceof Rect`（图片元素和画笔元素内部也是 Rect / Path）
- **写路径分离**：几何（left/top/width/height/angle）的真值是画布对象；样式（fill/stroke/字体/阴影）的真值是 store，永不回读 fabric
- 序列化在 `store/report-file.ts`，格式基准是 `test/fixtures/report-v1.json`

## 渲染与导出

```
renderPageImage(page, {scale, format, quality})   ← 离屏 StaticCanvas，唯一的渲染入口
  ├─ page-thumbnail  缩略图（抓图前等图片解码 + 一帧）
  ├─ report-export    PDF / PNG / 长图 / HTML 包
  └─ agent-tools      render_page（给用户看效果）
```

**绝不能从主画布抓图**：选中框、控制点会一起被截进去。永远是离屏重建。

## Agent

```
agent-panel（UI） → agent-runner（循环） → agent-tools（工具定义与执行）
                                        → report-commands（改文档）
                                        → Rust llm_chat（网络）
```

- 工具执行包在画布锁里，一次工具调用 = 一步撤销（`batchCommands`）
- 会话存 `agent/conversation.json`（一个报告一个会话），超预算先裁剪、再交接
- 交接摘要由**程序拼接**，不让模型写（省钱且不会瞎写）

## 多窗口与占用

- 「新建」= 开新窗口（`?new=1` 跳过"恢复上次报告"，从空白文档开始）
- 一份报告同时只能在一个窗口打开：Rust `commands/session.rs` 里维护 `reportId → windowLabel` 的登记表，打开前 `claim_report`，关窗口时 `release_reports_for_window`
- 登记表在进程内存里，崩溃不会留下死锁文件
- 为什么必须做：两个窗口编辑同一份报告会互相覆盖 `report.json` 和 `agent/conversation.json`

## 示例演示

`lib/demo/runner.ts` 负责调度：加锁 → 抑制历史（`setHistorySuppressed`）→ 分步执行（每步都会重载画布）→ 结束时补一次历史提交 → 解锁。所以整场演示只占一步撤销，中途停止不会留下半截历史。

## 测试

- 只测纯函数与 store 逻辑：`path` / `fill` / `report-path` / `report-file` / `report-validate` / `report-commands` / `update-service`
- 所有被测模块都不 import fabric，所以不需要 jsdom
- Rust 侧单测在 `commands/*.rs` 的 `#[cfg(test)]` 里（端点拼装、Key 清洗）
- 改文件格式时先改金标报告，再看哪条测试挂了

## 已知技术债

- `lib/report/commands.ts` 的 `describeElementTypes`、`lib/agent/conversation.ts` 的 `CONVERSATION_DIRNAME`、`lib/agent/tools.ts` 的 `modelSupportsVision` 目前没有调用方（预留接口）
- agent 的 `render_page` 图片只给用户看，模型看不到（DeepSeek 纯文本）；接视觉模型时需要在消息里带 image_url
- 无自动更新：只做版本检查 + 跳发布页
