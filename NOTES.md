# 报表编辑器 —— 交接文档

> 给下一次会话/新的 agent 用。读完这份文件就能接上，不需要重新解释需求。
> 代码是唯一真相，本文记录的是**代码里看不出来的东西：为什么这么做、踩过哪些坑、还剩什么没做**。

---

## 一、项目与技术栈

Tauri 2 桌面应用 + React 19 + Fabric.js 7.4 + Tailwind 4 + shadcn(base-ui) + TypeScript 5.8（`strict`、`noUnusedLocals`、`noUnusedParameters`）。

画布是一张 1920×1080 的「页面」，可以有多页。用户在上面画矩形、形状、线条、文本。

### 验证方式

```powershell
.\node_modules\.bin\tsc.cmd --noEmit   # 唯一的自动化验证手段，必须 EXIT=0
pnpm tauri dev                          # 跑起来才能验证交互
```

**不能自己装依赖**（沙箱限制），缺包必须让用户装。装完要重跑 `pnpm install`。

---

## 二、坐标与渲染模型（先看这个，否则看不懂画布代码）

- **场景坐标 = 页面坐标**：白色页面矩形固定放在场景原点 `(0,0)`，尺寸 `baseWidth × baseHeight`（1920×1080）。
- 缩放只通过 `canvas.setViewportTransform([s,0,0,s,tx,ty])` 实现，**元素自身的 left/top 与环境缩放无关**。
- 页面要求「始终居中」：`tx = 容器宽/2 − s·页宽/2`，`ty` 同理。
- 元素允许被放到页面外（用户明确拒绝做边界钳制）。
- 页面背景矩形永远在对象数组第 0 位，元素的层叠顺序最低从索引 1 开始。
- 点阵背景（`.canvas-grid`）是 CSS 背景，**不跟随缩放**。

---

## 三、目录结构

```
src/
├── base/            尺寸常量（1920×1080）、元素类型/路径/默认排版
├── store/           纯状态，无 UI
├── lib/             计算 + IO + 事件总线（允许副作用）
├── layout/          四大区域 + 底部状态栏
├── components/ui/   shadcn 组件（生成后需要修，见坑 7）
├── components/report/ 报告信息抽屉、打开报告抽屉
└── hooks/           全局快捷键、草稿自动保存、启动恢复
```

### store 各自负责什么

| store | 职责 | 关键点 |
|---|---|---|
| `page.ts` | 页面列表 + 当前页 + `revision` | 只在**结构性变化**时通知订阅方；元素增删改**不通知**（否则拖一下元素整个侧栏重渲染） |
| `element.ts` | `selectionStore`（选中 id 数组 + primary）、`elementObjectMap`（id ↔ 画布对象双向映射） | `primary` 只在单选时有值 |
| `report.ts` | 报告名 + id | 启动即有默认「未命名报告」 |
| `tool.ts` | 当前工具、线条样式、形状类型、是否绘制中 | 纯 UI 状态，不进文件 |
| `history.ts` | 撤销/重做快照栈 | 见下方决策 2 |
| `save-state.ts` | 保存状态 | 用 `revision`/`savedRevision` 派生脏状态 |
| `zoom.ts` | `{scale, manual}` | `manual=false` 表示跟随「适应窗口」 |
| `coordination.ts` | 选中状态写入的统一入口 | 页面数据回写由画布侧负责 |

### draw-area 的 hook 拆分

原来的 `index.tsx` 有 891 行、全塞在一个 `useEffect` 里，已按功能拆开：

| 文件 | 职责 |
|---|---|
| `index.tsx` | 只剩 hook 编排 + JSX（约 43 行） |
| `use-canvas.ts` | 创建画布（**只一次**）、尺寸、viewport、缩放、Ctrl+滚轮、销毁 |
| `use-drawing.ts` | 拖拽绘制状态机：`makeBox`（Shift 等比/45° 吸附）、预览、`finishDrag`、工具模式 |
| `use-text-editing.ts` | 文本放置、双击进入编辑、回车/失焦退出、占位虚线框 |
| `use-selection.ts` | 选中同步、对齐命令（`ELEMENT_COMMAND`） |
| `use-page.ts` | `loadPage` / `syncPage` / revision 判断 |
| `use-context-menu.ts` | 右键菜单、删除/锁定/层级 |

**⚠️ 隐式契约**：`use-canvas.ts` 拆成了 `useCanvas()`（创建）+ `useCanvasTeardown()`（销毁），**销毁 hook 必须放在最后一个调用**。原因：React 按 hook 定义顺序执行清理，fabric `dispose()` 之后其它 hook 再访问 `canvas.upperCanvasEl` 会抛错。

---

## 四、关键决策与原因

### 1. 序列化走「纯数据 + 属性白名单」，不用 `toObject()`

每个元素类型在 `element-definitions.ts` 里有一份 `props` 白名单。原因：

- `toObject()` 会带出 `canvas` 引用形成环，写不进 JSON
- fabric 内部字段（缓存、控制点等）不该进文件格式

线条额外存一个自定义字段 `length`：斜线的包围盒宽高**还原不出真实长度**。

### 2. 撤销/重做用全量快照，不用命令模式

原因：store 全是不可变更新（每次写都建新数组、只替换动到的对象），所以快照之间**大量对象是共享引用**，每步真正新增的只有一个数组 + 被改动的元素对象（几百字节）。命令模式则要为增/删/排序各写一套反向逻辑，复杂度和漏改风险都不划算。

配套细节：

- `undo()` 恢复数据用**上一个快照**，但 `current` 用**被撤销那一步**的快照 → 撤销会跳回改动发生的页面
- 在历史中间做新操作 → 丢弃后面的重做分支
- `commit()` 用 `pages` 引用 + `current` 判断内容是否真变了，空操作不入栈

### 3. 撤销恢复时「只重载、不回写画布」

`replacePages` 会让 `pageStore.revision++`，画布据此强制重载。

原因：store 是唯一真值。早期版本有个 `flushCanvasToPage()`，切页前把画布内容写回旧页 —— 一旦在恢复快照后还走这一步，**会把刚恢复的数据覆盖成撤销前的内容**。现在整条 flush 路径已删除，所有写操作都即时回写 store。

`revision` 存在的原因是：撤销时页面 **id 没变**，光靠 id 判断不出数据被整体替换了。

### 4. 保存

- **先同步定格 JSON，再异步写盘**：点保存之后用户还在编辑，等到 IO 时才序列化会存出「混合状态」
- **原子写**：写 `report.json.tmp` 再 `rename`，避免写一半崩掉把原报告写坏
- **不并发**：保存中再次触发只置脏，这一轮结束会自动再存一次
- **脏状态用版本号派生**：`beginSave()` 记下当时的 revision，写盘成功后只有 revision 没再变才标干净 —— 否则保存期间的改动会被误判成已保存
- 脏标记统一挂在 `historyStore.commit/undo/redo` 上：所有文档改动都经过它，挂这里不会漏

### 5. 磁盘布局

```
%APPDATA%/com.admin.tauri-app-template/
├── data/<报告名>-<id>/{report.json, media/}    ← 已保存
└── cache/<报告名>-<id>/{report.json, media/}   ← 未保存的草稿
```

- **绝不写软件安装目录**：Program Files 没有写权限，升级卸载还会清空
- **目录名只是给人看的标签**，查找永远靠 `report.json` 里的 `reportId` —— 改名、非法字符、重名都不会坏
- 目录名要过 `sanitizeFolderName()`：Windows 非法字符、保留名（CON/COM1…）、结尾的点、60 字符截断
- **cache 与 data 结构完全一致** → 迁移是整目录 rename，JSON 里的相对路径一个字节都不用改
- 媒体文件按**内容 hash** 命名并去重（尚未实现，结构已预留）
- **空文本保存时过滤**（`isMeaningfulElement`）：编辑期间允许留占位框，落盘不能留垃圾

### 6. 启动恢复

`restoreLastReport()`：扫 `data/` 按 mtime 倒序，打开最近一份；**一份都没有时才新建**。

### 7. 锁定元素保持 `evented: true`

`selectable: false` 让框选/点选跳过它，但 `evented` 必须为 true，否则右键选不中、**永远解不了锁**。

### 8. 绘制预览每帧重建对象

预览用「每次指针移动重新 `build(box)`」，而不是「基准形状 + scaleX 拉伸」。原因：拉伸会让虚线间距和箭头大小跟着变形。

### 9. 文本元素

- 用 `Textbox`（固定宽度、自动换行），`splitByGrapheme: true`（中文没空格也能断行）
- 新建时放占位文字「文本」+ 虚线框，状态记在模块级 `WeakSet`（不持久化）；**双击才进入编辑**
- 空文本或占位框都显示虚线，否则它在画布上完全不可见

---

## 五、踩过的坑（同样的问题别再犯）

### 坑 1：fabric 的右键事件被自己吞掉了

fabric **有** `contextmenu` / `contextmenu:before` 事件，但 `stopContextMenu` 选项默认 `true`，`Canvas._onContextMenu` 里会 `stopEvent(e)` —— 事件不再冒泡，外层菜单组件根本收不到。

**解法**：`new fabric.Canvas(el, { stopContextMenu: false })` + 监听 `canvas.on("contextmenu", ...)`。数据要用 `flushSync` 提交，因为菜单在同一个事件里就渲染了。

### 坑 2：`findTarget()` 返回的不是对象

```ts
canvas.findTarget(e) // → FullTargetsInfoWithContainer，对象在 .target 里
```

### 坑 3：`setActiveObject` 不会把对象加到画布

文本元素看不见就是因为少了 `canvas.add(object)` —— `setActiveObject` 只设置选中状态，不渲染。

### 坑 4：Textbox 的 left/top 会被内部排版重算

构造时传的 `left/top` 不是最终位置。**解法**：造完用 `getBoundingRect()` 量实际位置，把它平移到目标点：

```ts
const bounds = object.getBoundingRect();
object.set({ left: object.left + (point.x - bounds.left), top: ... });
```

另外：`set({ text })` 也会触发重排版，所以设文字必须在校正位置**之前**。

### 坑 5：`opener:default` 不含 `allow-open-path`

`opener:default` = `allow-open-url` + `allow-reveal-item-in-dir` + `allow-default-urls`。用 `openPath()` 会直接报错。

**解法**：用 `revealItemInDir()`，或在 capabilities 里显式加 `opener:allow-open-path` 并配 `$APPDATA/**` scope。查权限清单可以读 `src-tauri/gen/schemas/acl-manifests.json`（里面有全部合法标识符）。

### 坑 6：`fs:allow-appdata-read-recursive` 是 **permission_set** 不是 permission

在 `acl-manifests.json` 的 `permissions` 里搜不到它，别以为不存在 —— 去 `permission_sets` 里找。

### 坑 7：shadcn CLI 生成组件的两个后遗症

1. 新组件一律 `import { cn } from "cn"` → 必须改成 `@/lib/utils`（仓库里已有自己的 `cn`）
2. **CLI 会重写 `package.json`**，把 `@tauri-apps/plugin-fs` 这类依赖挤掉 → 加完组件检查一遍 `package.json`

### 坑 8：工具快捷键会抢浏览器组合键

`useKeyPress` 的判断必须排除 `ctrlKey`/`metaKey`/`altKey`，否则 `Ctrl+R` 会切到矩形工具。

---

## 六、未完成 / 待办

| 项 | 说明 |
|---|---|
| 单元素对齐页面 | 目前对齐只支持「≥2 个选中，以选区包围盒为基准」。单选对齐到页面计划放右键菜单 |
| 图片/视频元素 | 目录结构（`media/`）和 hash 去重规则已定，元素类型还没做 |
| 媒体孤儿清理 | 保存时按 JSON 引用清理未使用的媒体文件 |
| 缩放锚点 | 现在是缩放到页面中心，不是光标位置；也没有平移（放大后只能看中间） |
| 属性面板可编辑 | 目前只读；多选时整块不显示（后续做批量修改） |
| 批量编辑 | `selectionStore.primary` 在多选时为 null 就是为它留的口 |
| 数据绑定 | `ElementAttrs` 允许任意扩展字段，`attrs` 里有空位 |
| 导出 PDF/图片 | 顶栏「导出」按钮目前只弹提示 |
| 自定义数据目录 | 抽屉里只读展示 + 「在文件夹中显示」，迁移逻辑没做 |
| 文本编辑的 window blur | 切到别的应用不会退出编辑（fabric 只在画布内失焦时退出） |

---

## 七、约定（写代码前先看）

- 规则文件：`conv/rules/frontend-*.md`、`conv/project/frontend-*.md`。**`conv/` 目录由 conv 管理，可能被 `conv update` 覆盖**
- `lib` ≠ `utils`：`lib` 是库层（允许单例和副作用），`utils` 只放纯函数
- 引入入口：`src/store`、`src/hooks` **对外一律从各自的 `index.ts` 引**（`@/store`、`@/hooks`）；`lib` 不设 barrel，按 `@/lib/xxx` 直接引。**store 内部互相 import 必须用相对路径**，经自己的 barrel 会形成「index → 模块 → index」的循环
- 颜色令牌在 `src/global.css`，文档内容色（页面/形状/线条/文本）用 `--report-*` 前缀，**只在 `:root` 定义、不随深色模式变**，fabric 读不到 CSS 变量，运行时经 `getReportPalette()` 取
- 字号只用 `text-xs` / `text-sm`，不要为奇数值造新 token
- Tab 缩进、中文注释、注释写「为什么」而不是「做了什么」
- 组件：**shadcn 已有对应组件时必须用它，不要自己造轮子**；只有 shadcn 没有的才新建，且不乱封装成项目级组件
- 在输入框里打字时不能抢全局快捷键（`isEditableTarget`）
