# 复刻指南（给 agent）

> 目标：**只看这份文档 + 仓库里的金标报告**，就能重新实现一个功能等价的项目。
> 结构、约束、坑都写在这里；实现细节去读对应文件。

## 1. 要交付什么

一个 Windows 桌面报表编辑器：

- 1920×1080 多页画布，元素可拖拽/缩放/旋转/对齐/分层/锁定
- 元素：矩形、文本、图片、画笔，10 种形状，7 种线条
- 填充：纯色 / 线性径向渐变 / 图片（覆盖/适应/平铺/居中/原始）
- 刻度尺 + 参考线 + 吸附
- 文档存成目录（`report.json` + `media/`），草稿自动保存、崩溃恢复、`.bak` 备份
- 导出 PDF（带 report.json 附件）/ PNG / JPEG / 长图 / HTML 包
- AI 助手：自然语言调工具改画布，会话按报告持久化

## 2. 技术栈（版本别乱跳）

| 层 | 选型 |
|---|---|
| 桌面壳 | Tauri 2（Rust），NSIS 安装包 |
| 前端 | React 19 + TypeScript 5.8（strict，`noUnusedLocals`/`noUnusedParameters`） |
| 构建 | Vite 7，端口固定 9527 |
| 画布 | Fabric.js 7（**不要换 Konva**：元素模型、`toObject`、Path 复用都依赖它） |
| UI | Tailwind 4 + shadcn + Base UI + lucide-react |
| 测试 | Vitest（node 环境，不引 jsdom） |

**版本对齐规则**：`@tauri-apps/api` 与 Rust 的 `tauri` crate 的 major.minor 必须一致，否则 `tauri build` 直接失败。

## 3. 目录骨架（照着建）

```
src/
├── base/            常量与纯数据：画布尺寸、颜色、KNOWN_ELEMENT_TYPES
├── store/           单例 store + 文档模型 + 序列化
├── lib/             库层（IO / 渲染 / 命令 / 导出 / agent）
│   └── utils/       全局纯函数
├── hooks/           跨组件的 React 逻辑
├── layout/          header / aside / draw-area / property-panel / footer
└── components/      ui / report / agent
src-tauri/src/
├── lib.rs           只做装配（模块声明 + invoke_handler）
└── commands/        storage.rs / media.rs / export.rs / agent.rs / update.rs
test/
├── fixtures/        金标报告 + 媒体样张
└── unit/            纯函数与 store 逻辑测试
```

## 4. 数据模型（实现前先定死）

```jsonc
// report.json
{
  "version": 1, "reportId": "…", "reportName": "…",
  "pageWidth": 1920, "pageHeight": 1080,
  "pages": [{
    "pageId": "…", "pageName": "封面",
    "style": { "fill": FillSpec },          // 可选
    "guides": [{ "axis": "x", "position": 120 }],
    "elements": [{ "id": "…", "elementType": "rect", "attrs": {} }]
  }]
}

// FillSpec
{ "kind": "solid", "color": "#fff" }
{ "kind": "gradient", "type": "linear|radial", "angle": 90, "stops": [{ "offset": 0, "color": "#fff", "alpha": 1 }] }
{ "kind": "image", "source": "media/<内容hash>.png", "fit": "cover|contain|tile|center|original" }
```

**先照抄 `test/fixtures/report-v1.json`**：它覆盖了所有元素类型、渐变背景、参考线、阴影、画笔轨迹，是格式的唯一权威。

## 5. 实现顺序（每个里程碑都能单独验收）

**M1 画布骨架**
四区布局 → Fabric 画布（页矩形 + 视口变换）→ 坐标刻度尺 → 缩放/平移。
验收：画布能缩放 10%–400%，刻度零点对齐页面左上角。

**M2 元素与属性**
`elementType → builder` 表驱动 → 拖拽创建 → 选择/变换/对齐/分层/锁定 → 属性面板（几何、填充、文本）。
验收：能画矩形和文本，改颜色和字号立刻生效，Ctrl+Z 能撤销。

**M3 文档与持久化**
序列化（`toReportFile` / `parseReportFile`）→ 数据目录 → 保存/打开 → 草稿自动保存 + 崩溃恢复 → `.bak`。
验收：保存后重启应用能打开；强杀进程后重开能恢复未保存改动。

**M4 导出与 AI**
离屏渲染 → PDF（手写 PDF 装配，JPEG + 附件）/ 图片 / 长图 / HTML 包 → agent 工具层 + 循环 + 面板。
验收：导出的 PDF 能打开且带 `report.json` 附件；一句话能让 AI 往画布上加 5 个元素，一次撤销能退回。

## 6. 十条硬约束（不遵守必出 bug）

1. **元素分支只能用 `elementType`**：图片元素、画笔元素内部也是 Rect / Path，`instanceof` 会误判。
2. **几何真值在画布，样式真值在 store**：改样式不要回读 fabric 实例。
3. **程序化改文档必须走 `pageStore.replacePages`**：元素增删改不 bump `revision`，不经过它画布不刷新。
4. **导出一律离屏渲染**：主画布会带出选中框和控制点。
5. **图片必须先 `ensureMediaImages`**：离屏渲染是同步的，图没解码完会缺图。
6. **画笔元素存轨迹（`attrs.path`）**：没法从包围盒重新生成，重建时按存储宽高设 scale，`applyElementAttrs` 不能覆盖 width/height。
7. **阴影存意图不存渲染结果**：`attrs.shadow` 是颜色/透明度/模糊/偏移，渲染时造 `fabric.Shadow`。
8. **Tauri 嵌套结构体要 `#[serde(rename_all = "camelCase")]`**：自动改名只作用于命令参数名，不进结构体字段（否则前端传 `baseUrl` 会报 `missing field base_url`）。
9. **Key 按服务商分开存**：自定义端点只有在 localhost 时才允许不带 Key（否则会静默发出无凭据请求，得到 401）。
10. **agent 执行期间锁画布**：`replacePages` 会整页重载并清空选中，不锁会打断用户操作。
11. **一份报告只能在一个窗口打开**：占用登记表放 Rust（前端各窗口互相看不见）；两个窗口编辑同一份会互相覆盖 `report.json` 和 `agent/conversation.json`。
12. **新窗口必须跳过"恢复上次报告"**：用 `?new=1` 之类的标记，否则每个新窗口都会恢复成同一份内容。

## 7. 验收清单（复刻完逐条过）

- [ ] `pnpm test` 全绿（纯函数 + store 逻辑，不依赖 canvas）
- [ ] `npx tsc --noEmit` 无错误
- [ ] `cargo check` 通过；`pnpm tauri build` 出 NSIS 安装包
- [ ] 新增元素默认无描边；文本、形状、图片、画笔都能创建并重建
- [ ] 撤销/重做按"一步操作"回退，含 agent 的一次工具调用
- [ ] 保存 → 关闭 → 重开，内容一致；强杀后草稿能恢复
- [ ] 导出的 PDF 每页一张满版图，`report.json` 作为附件可提取
- [ ] 金标报告 `parse → 序列化 → parse → 序列化` 两次结果完全一致
- [ ] 换服务商后 Key 输入框为空，切回来原 Key 还在

## 8. 反模式（别做）

- 用 `canvas.toDataURL()` 抓主画布做缩略图/导出（带选中框）
- 把 UI 状态（选中项、临时框）写进报告文件
- 在 `lib/utils/` 里放领域逻辑（`normalizeFill` 属于 store）
- 让模型写"交接摘要"（费钱且不可靠，用程序拼）
- 给 agent 直接开文件系统权限（只开放文档操作，导出/保存由用户点按钮）
