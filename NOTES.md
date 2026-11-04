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
├── base/            尺寸常量（1920×1080）、元素类型/路径/默认排版/形状基准坐标系
├── store/           纯状态，无 UI（对外走 index.ts）
├── lib/             计算 + IO + 事件总线（允许副作用）
├── layout/          四大区域 + 底部状态栏
├── components/ui/   shadcn 组件（生成后需要修，见坑 7）
├── components/report/ 报告信息抽屉、打开报告抽屉
└── hooks/           全局快捷键、草稿自动保存、启动恢复（对外走 index.ts）
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
| `index.tsx` | 只剩 hook 编排 + JSX |
| `use-canvas.ts` | 创建画布（**只一次**）、尺寸、viewport、缩放、Ctrl+滚轮、`panBy` 平移、销毁 |
| `use-drawing.ts` | 拖拽绘制状态机：`makeBox`（Shift 等比/45° 吸附）、预览、`finishDrag`、工具模式 |
| `use-text-editing.ts` | 文本放置、双击进入编辑、回车/失焦退出、占位虚线框 |
| `use-selection.ts` | 选中同步、对齐命令、属性面板改几何（`ELEMENT_COMMAND` 的两个分支） |
| `use-space-pan.ts` | 按住空格 + 拖拽平移视口（见决策 10） |
| `use-page-thumbnail.ts` | 当前页缩略图：commit/换页/撤销后防抖抓图（见决策 13，**必须排在 usePage 之前**） |
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

白名单里**没有 `scaleX/scaleY`**：尺寸只存宽高，缩放只在内存里短暂存在，见决策 12。

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

### 10. 空格平移：在容器捕获阶段吞事件，不动 fabric 的选择状态

`use-space-pan.ts` 按住空格进入拖拽状态，左键拖动平移视口。

**为什么不改 `skipTargetFind` / `selection`**：那两个归工具模式（`use-drawing.applyMode`）所有，改了之后切工具会互相覆盖，退出拖拽时还可能把画布恢复成和当前工具不一致的状态。

**为什么在容器捕获阶段拦**：fabric 把交互监听绑在 `upperCanvasEl`，事件必须先经过容器，`stopPropagation()` 之后 fabric 什么都收不到 —— 不会选中、框选、落笔、双击进文本编辑，也不用管它内部有多少条事件路径。

**⚠️ 要拦的是 `mousedown` / `touchstart` / `click` / `dblclick`，不是 `pointerdown`**：fabric 7.4 的 `enablePointerEvents` 默认 `false`，它监听的是鼠标事件；而 `pointerdown` 上 `preventDefault` 也挡不住浏览器随后补发的鼠标事件。`pointerdown` 只用来记拖动起点。

平移量以「屏幕像素」存在 `use-canvas` 的 ref 里（`panOffsetRef`），`applyViewport` 会把它叠加到居中结果上：缩放/改窗口重算视口时位置能保住，而**非手动（跟随适应窗口）模式下一律清零重新居中** —— 这也是「适应窗口」按钮能被当作「回到居中」用的原因。

### 11. 属性面板写入只有一条路：命令总线 → 画布 → dump 回 store

面板只发 `ELEMENT_COMMAND`（`type: "update-geometry"`），真正改的是 `use-selection.updateElementGeometry`：先 `applyGeometryPatch` 到 fabric 对象，再 `dumpElementFromObject` 回写 `pageStore`，最后 `historyStore.commit()`。

原因：几何的真值在画布对象上（旋转、缩放的内部状态只有对象自己知道）。拿面板输入直接拼一份 `ElementInfo` 写进 store，迟早和对象对不上。

配套细节：

- 尺寸有两种写法（`ElementDefinition.sizeMode`）：`props` 直接写 `width/height`（矩形、文本）；`scale` 只能整体缩放（形状、线条）
- **角度一律绕元素中心转**（`applyAngleAroundCenter`），origin 仍然是左上角。fabric 拖旋转手柄走的是 `centeredRotation` + `wrapWithFixedAnchor`（中心钉住），面板直接 `set({ angle })` 却会绕 origin（左上角）—— 两条路不一致，表现就是「拖手柄正常、填数字绕左上角甩出去」。所以面板改角度要自己把中心摆回去。副作用：填完角度 X/Y 会变，和拖手柄一致
- **Textbox 的 `width` 不在 fabric 的排版属性里**（`textLayoutProperties` 没有它），`set({width})` 不会重新折行，改完必须手动 `initDimensions()`
- 线条没有宽高，面板显示「长度」；文本高度随内容撑开，没有可编辑的 height

### 12. 元素身上不存 scale，尺寸只有宽高

**`attrs` 里永远没有 `scaleX/scaleY`**，`ElementAttrs` 类型、所有 `*_PROPS` 白名单、文件格式里都没有这两项。存的是什么：

- 形状：`width/height`（实际尺寸），`build` 时用 `scaleShapePath()` 把 100×100 的基准路径**重新生成**成目标尺寸 → 对象 `scale` 恒为 1
- 矩形/文本：`width/height` 直接就是对象属性
- 线条：`length`

那什么时候会有 scale？**只有手动拉伸的当下**：拖控制点走的就是 fabric 的 scale。所以 `dumpElementAttrs` 统一把 `width/length × scaleX`、`height × scaleY` 折算回实际尺寸，落盘与回读都以宽高为准；读文件时 `build` 再按宽高把几何重新造出来，对象身上依然没有 scale。等于说 scale 只活在一次拉伸和下一次 dump 之间，绝不会进入数据。

**为什么这么做**：两套尺寸（基准尺寸 + scale）意味着每个读元素的地方都要做一次换算，早就有过矩形拉伸后保存丢尺寸的问题（`RECT_PROPS` 里没有 scale）。统一成宽高以后，面板、对齐、导出拿到的都是同一个数。

旧文件兼容在 `report-file.parseElement` 的 `migrateAttrs()`：读到 `scaleX/scaleY` 就按 `UNIT_SIZE × scale` 折成宽高再继续。`UNIT_SIZE` 因此挪到了 `base/elements.ts`（它是形状基准坐标系的边长，本来就是常量）。

### 13. 页面缩略图：当前页抓图 + 其它页懒加载离屏渲染

三种触发、两个生产者，写同一个 `thumbnailStore`（纯内存，不落盘）：

| 场景 | 生产者 | 方式 |
|---|---|---|
| 当前页改动 | `use-page-thumbnail.ts` | 防抖 300ms，直接从主画布 `toDataURL` 抓 |
| 换页 | 同上 | 订阅 pageStore，**必须在 usePage 之前注册**（见下） |
| 其它页 | `lib/page-thumbnail.ts` 的队列 | 侧栏 `IntersectionObserver` 滚到可见才入队，一次空闲渲染一页 |

**当前页为什么直接抓**：所见即所得，不用重建对象；裁剪框取「页面在屏幕上的矩形」（`vpt[4]/vpt[5]` + 页宽×zoom），所以放大平移后一样能抓全，页面外的元素自然被裁掉。

**⚠️ 换页时的顺序陷阱**：`pageStore` 按订阅顺序通知。这个 hook 必须排在 `usePage` **前面** —— 轮到它时画布还停在旧页，正好补抓旧页最后的状态；随后 `usePage` 才重载新页。反过来写的话，切页会丢掉旧页最后一笔编辑（防抖还没到就被取消）。

**⚠️ 离屏渲染必须用 `buildElementObject`（不登记）**：`createElementFromInfo` 会把「id → 对象」写进 `elementObjectMap`，离屏那批对象一旦登记，右键菜单/属性面板/对齐就会拿到不在画布上的幽灵对象。

**其它细节**：

- 队列存 `pageId` 而不是页面快照：排队期间页面可能又改了或删了，flush 时重新查一次最新数据
- 空页不生成图（`isFresh` 把「空页且无记录」视为最新），元素删光时主动 `delete`，否则旧画面会赖着不走
- 过期判断用「画它时的 `elements` 数组引用」—— pageStore 是不可变更新，没动过的页引用不变，撤销/重做只重画真变了的页

**关于「交给 Rust 渲染」**：`renderPageThumbnail()` 是整个功能里唯一的计算热点，签名是 `PageInfo → dataURL`。真到了需要的时候，把这个函数体换成 `invoke("render_page_thumbnail", ...)` 即可，调用方一行都不用动。现在不做，是因为 Rust 侧要重新实现一遍 fabric 的渲染（路径、描边、**文本折行与字体**），保真度风险远大于这点开销。

### 14. 填充支持渐变：存序列化对象，读回来手动还原

`attrs.fill` 的类型是 `ElementPaint = string | SerializedGradient`：

- 纯色 → 字符串
- 渐变 → `fabric.Gradient.toObject()` 的产物（`{type, gradientUnits, coords, colorStops}`），普通对象，能直接进 JSON

**为什么要转换**：`object.fill` 拿到的是 `Gradient` **实例**，直接塞进 JSON 会得到一堆内部字段；而反过来把普通对象 `set({fill})` 给 fabric，它也画不出来。

- 落盘：`dumpElementAttrs` 里判断 `value instanceof fabric.Gradient` → `toObject()`
- 回填：`applyElementAttrs` / `applyStylePatch` 里判断是不是带 `colorStops` 的对象 → `new fabric.Gradient(...)` 还原

**`Gradient.fromObject` 是 async**（内部其实同步 `new`），同步路径上直接用构造函数，省得把画布操作变成异步。

**坐标用 `gradientUnits: "percentage"`（0~1）**：元素改宽高时渐变跟着缩放。用 `pixels` 的话，放大元素渐变不会跟着变，还得在每次改尺寸时重算坐标。

现状：线性（水平/垂直/对角）+ 径向，两色标；描边只支持纯色。

### 15. 文本属性与取色器的提交时机

文本的字号、字重、字体、对齐、行高都在 `TEXT_PROPS` 白名单里，走的是 `update-style` 命令（和几何分开），canvas 侧用 `applyStylePatch` 落到对象上。

- 字号/字体都在 fabric 的 `textLayoutProperties` 里，`set` 会自动重排，**不用**手动 `initDimensions()`
- 原生 `<input type="color">` 只监听 **原生 `change`**（取色器关闭时一次），不听 `input`：后者在拖动取色器时连续触发，会把撤销历史刷爆
- `update-style` 带一个 `commit?: boolean`（默认 true）：以后要做「拖动实时预览」时，途中传 false，松手再统一 `historyStore.commit()`

### 16. 页面背景：是「页面的属性」，不是「页面里的元素」

背景存在 `PageInfo.background`（类型同样是 `ElementPaint`，支持渐变），**不进 `elements`**。

**为什么不把白页变成一个元素**：它永远铺在最底层、不参与层级/对齐/框选/删除，做成元素反而要在所有遍历元素的地方加特判。现在它只是画布上一个固定的 `fabric.Rect`，`use-page.loadPage()` 切页时按 `pageInfo.background` 换一次填充。

**怎么选中它**：白页是 `evented: false, selectable: false` —— 一旦可点选，框选会把它框进去，拖动整个选区就能把页面拖走。所以改成手动判：`mouse:down` 记落点，`mouse:up` 时如果「原地一点（<3px）+ 落在页面矩形内 + 没选中任何东西」，就 `setActiveObject(page)`。

- `selectionStore` 因此多了一个 `page: boolean`，用来区分「选中了背景」和「什么都没选」
- 白页 `hasControls: false, hasBorders: true`：能被选中、有边框提示，但没有控制点，拖不动也转不了
- 面板里选中背景时显示 `PageProperties`（只有填充色），元素面板不显示

**⚠️ 缩略图的失效判断也跟着改了**：`thumbnailStore` 原本比「画它时的 `elements` 数组引用」，但改背景色时 `elements` 引用不变 → 会漏判成「还是最新的」。现在改成比**页面对象引用**（`PageInfo`），背景改动同样会换掉页面对象，判断才是准的。

**改背景后要 `pageStore.emit()`**：`updateCurrentPageBackground` 里主动通知一次，否则面板上的色块不会更新。这次 emit 不会触发画布重载 —— `revision` 没变，`use-page.syncPage` 直接早退。

### 17. FillSpec：JSON 存意图，fabric 只接收

填充/背景的统一模型（`store/fill.ts`）：

```ts
FillSpec =
  | { kind: "solid",    color }
  | { kind: "gradient", type: "linear" | "radial", angle, stops: [{ offset, color, alpha }] }
  | { kind: "image",    source, fit: "cover" | "contain" | "tile" | "center" | "original" }
```

**存的是意图，不是 fabric 的产物**（这一点很关键）：角度、图片适应方式在 `Gradient`/`Pattern` 里还原不回来，所以转换只做 **JSON → fabric** 一个方向，全部集中在 `lib/fill.ts` 的 `toFabricPaint(fill, size)`。

**写入路径按「真值在哪」拆成两半**：

| 字段 | 真值 | 什么时候写 |
|---|---|---|
| 几何（left/top/angle/width/height/length）+ 文本 `text` | **fabric 对象** | 拖拽、缩放、双击编辑后 dump 回来（`dumpObjectTruth`） |
| 样式（fill/stroke/strokeWidth/fontSize/fontFamily/fontWeight/textAlign/lineHeight/opacity） | **store** | 只由面板写，**永不从对象回读** |

所以：
- `readElementInfo()` = store 的样式 + 对象的几何，两者合并
- `snapshotElementInfo()` 只给**新建**元素用（那时默认样式还只存在于对象上）
- `applyStylePatch()` 会**返回**该落库的字段 —— 不能改完再从对象读回来，此时 `object.fill` 已经是 Gradient 实例了

**渐变的坐标用 pixels 而不是 percentage**：percentage 会让角度随元素宽高比失真（正方形上的 45° 到宽扁矩形上就不是 45°）。代价是尺寸变了要重算 —— `use-selection` 在改宽高之后会调一次 `refreshFill()`。以后图片填充的 fit 也挂在同一个位置。

**旧文件迁移**：`normalizeFill()` 认纯色字符串、旧版 `{ type, coords, colorStops }` 渐变对象、新 FillSpec 三种；`PageInfo.background` → `PageInfo.style.fill`。

### 18. 图片填充：复制进 media/，渲染是异步的

导入链路：

```
dialog.open() 选文件（绝对路径，在 APPDATA 之外）
  → invoke("import_media", { dir, source })   ← Rust 侧
      读字节 → SHA-256 取前 8 字节当文件名 → 写 .tmp → rename 到 media/<hash>.<ext>
  → JSON 里只存 "media/<hash>.<ext>"
```

**为什么必须走 Rust**：用户选的图片在 APPDATA 之外，`fs` 插件没有那个 scope，前端根本读不到。放 Rust 还避免了把整张图经 IPC 传字节。

**渲染是异步的**：`toFabricPaint()` 是同步的，第一次拿不到解码后的图 → 先返回 `undefined`（暂时透明），同时 `getMediaImage()` 发起加载；加载完通过 `setMediaImageListener` 通知画布把带图片填充的对象重新 `refreshFill()` 一次。缩略图里如果图还没加载完就是空白，属于已知取舍。

**fit 的实现**：`patternTransform = [scale, 0, 0, scale, offsetX, offsetY]`，cover/contain 按「图片自然尺寸 vs 元素尺寸」算缩放并居中，tile 用原尺寸平铺，center 居中不缩放。

**草稿的图片**：未保存的报告图片落在 `cache/<报告目录>/media/`，而保存后 cache 会被清掉 —— 所以 `saveReport()` 里先用 `copyMediaDir()` 把 media 搬进 data，再写 JSON。

### 19. 主题色板与最近使用色

- **主题色**：`base/colors.ts` 里的固定十二色。刻意不读 `--report-*` 令牌 —— 色板是给用户挑的调色盘，不是「默认值」，要稳定可预期；`--report-*` 只是新元素的默认样式。
- **最近使用**：`store/preferences.ts` 存最近 10 个颜色（去重、置顶），落盘在 `<应用数据>/cache/ui-preferences.json`。

**为什么放在 cache 目录而不是跟着报告走**：这是「这台机器上这个人的习惯」，不是文档内容。放 `cache/` 根下、和草稿目录同级，`listReportFolders()` 只收目录，不会把它当成报告 ✓。

**写盘要防抖**：`rememberColor()` 只更新内存 + 400ms 后落一次盘；连续取色不会每次都写文件。读失败/写失败都只打日志 —— 偏好读不出来不该影响使用。

**面板里的作用规则**：纯色模式点色板改整体颜色；渐变模式点色板改「当前选中的色标」（色标行会高亮，点行或聚焦它的取色器都会切换选中）。图片模式不显示色板。

### 20. 媒体孤儿清理

`saveReport()` 写盘后，按**刚写下去的那份 JSON** 收集引用的媒体文件名，把 `media/` 里其余文件删掉。

- 引用来源：元素 `attrs.fill` 与页面 `style.fill` 里 `kind === "image"` 的 `source`
- 目录可能刚被改名（`relocateFolderToMatchName`），所以清理前要重新 `findReportFolder` 定位一次
- 全程 try/catch：删不掉不该让保存失败

### 21. 关窗拦截：三选一，且必须用 `destroy()`

`hooks/use-close-guard.ts` 监听 `getCurrentWindow().onCloseRequested()`：

- 文档不脏 → 直接放行
- 脏 → `event.preventDefault()` + 弹 `CloseConfirmDialog`（保存并关闭 / 不保存 / 取消）
- 选完两条关闭路径都走 **`destroy()`**：`close()` 会再触发一次 `onCloseRequested`，绕回自己
- 「保存并关闭」里保存失败（或保存期间又改了）就不关窗，把窗口留给用户

**⚠️ 需要 capability**：`core:window:allow-destroy`。`core:default` 只给了窗口的只读权限（`core:window` 的 default 里没有 allow-close / allow-destroy），漏了会在点「保存并关闭」时被拒。capabilities 是编译进二进制的，改完要重启 `pnpm tauri dev`。

### 22. 检查更新：只做「拉清单 + 比版本」，不引 updater 插件

`lib/update-service.ts`：

- `UPDATE_MANIFEST_URL` 现在是空串 = 没配置更新源，检查会直接返回 `unavailable` 并说明原因，**不会假装检查成功**
- 有地址时：`fetch(JSON)` → 拿 `{ version, notes?, url? }` → 逐段比较版本号
- UI 在底部状态栏左侧的版号按钮里（点开是「关于」+ 检查更新）

**为什么不用 `tauri-plugin-updater`**：那套要签名密钥 + 托管构建产物，现在连发布渠道都没有。等真有发布流程再换，届时这里的调用点不用改。

### 23. 刻度 / 参考线 / 顶点吸附：都建在「视口镜像」上

这三样都是 DOM 覆盖层（`canvas-overlay.tsx`，整层 `pointer-events: none`），不是画布对象 —— 不参与选中、导出、缩略图。

**`store/viewport.ts` 是它们的地基**：视口变换本来只活在 `use-canvas` 的闭包里，React 层拿不到。现在 `applyViewport` / `panBy` 之后都会镜像一份 `{scale, tx, ty, width, height}` 出来。

- **刻度**：用 canvas 画（不是 DOM 节点），零点 = 页面左上角，屏幕位置 = `tx + 值 × zoom`；每帧重画几十个刻度，用 DOM 会疯狂创建节点。步长从 `[10,20,50,100,200,500,1000,2000]` 里挑「屏幕间距 ≥ 60px」的第一个。刻度条**覆盖**在画布上（20px），靠「适应窗口」自带的 48px 边距留出空隙 —— 不让空间、不改视口计算。
- **参考线**：存 `PageInfo.guides`（每页独立），位置一律 `round(值 / 10) * 10`；点刻度条创建、拖动调整、拖出页面即删除；拖动中只改本地状态，**松手才写 store + commit**，一次拖动一步撤销。
- **吸附**：阈值 5 个**场景单位**；候选 = 其他元素顶点 + 页面四角 + 参考线。**不抖的关键是每次都从「指针算出的原始位置」求增量**——fabric 每帧按指针重算 left/top，所以不存在「基于已吸附位置再吸附」的累积误差。单个轴只取最近的一个候选，多个候选同时在范围内也只跟一个走。多选不启用（left/top 是相对选区的，语义不同）。

**⚠️ 覆盖层坐标系**：`viewportStore` 的 tx/ty 是相对**画布容器**的，而刻度条自己往右下偏了 20px。所以刻度条上的点击换算要用**父元素**（覆盖层）的矩形，不能用刻度条自己的 —— 否则取到的场景坐标会少 20px。

### 24. 自定义数据目录

**模型**：一个数据目录 = 一套报告库，里面有自己的 `data/`（已保存）和 `cache/`（草稿）。目录列表存在 `cache/ui-preferences.json`（和最近使用色同一个文件）：

```json
{ "recentColors": [...], "dataDirs": { "dirs": ["D:\\报表"], "defaultPath": "D:\\报表" } }
```

**添加目录会自动套一层应用标识目录**：用户选 `D:\报表`，真正的根是 `D:\报表\com.admin.tauri-app-template`（`getIdentifier()` 拿到的值）。这样同一个文件夹能放多个应用的数据，也不会把 `data/`、`cache/` 直接摊在用户选中的目录里。显示名要跳过这层（`dirLabel`），否则几个自定义目录会显示成同一个名字。

- **内置目录**（应用数据目录）永远排在第一位、不可删；它的路径是环境决定的，**不落盘**，启动时由 `app_data_dir` 命令 + `dataDirsStore.init()` 拼回去
- **默认目录**决定新建报告落在哪儿；切换默认目录**不会**改变当前报告的保存位置
- **存储根解析**（`getStorageRoot`）：已落盘的报告用它自己记录的 `rootPath`，新报告用默认目录；这个函数会先 `await ensurePreferencesLoaded()`，所以报告 IO 永远拿得到目录列表，不依赖 hook 的调用顺序
- **打开列表**聚合所有目录，每项标出来源目录；**移除目录只从列表移除，磁盘文件不动**

**切换默认目录时的迁移**：当前报告已保存且不在目标目录里时，弹三选一 —— 取消 / 不迁移（报告继续存回原目录，新建的走新默认）/ 迁移过去。迁移走 Rust 的 `storage_move_dir`：先试 `rename`，跨盘失败就退化成「递归复制 + 删除原目录」。

**草稿的一个已知取舍**：草稿是写在"当前默认目录"下的 `cache/` 里的。如果新建报告后、保存之前改了默认目录，草稿会留在旧目录，保存时找不到它 —— 图片可能会丢。这是罕见操作，先不管；真遇到就把草稿路径也记到 reportStore 里。

### 25. 层次边界：`lib/utils/` 只装全局通用工具

**先纠正一个我自己搞错的判据**：一开始我以为"被两层以上共用"就该进 utils，于是把 `normalizeFill`（填充解析）挪了过去 —— 这是错的。它懂填充自己的历史格式（纯色字符串、旧版渐变坐标、fabric 至少两个色标），是**填充领域的知识**，不属于任何地方都用得着的通用工具。现在已经挪回 `store/fill.ts`，和类型放一起。

**正确判据：整个应用都会用的东西才进 utils；带领域知识的东西留在自己的领域里。**

```
src/lib/utils/
├── index.ts        出口（只导出，不写逻辑），对外一律 `@/lib/utils`
├── class-names.ts  cn
├── id.ts           createUniqueId
├── path.ts         normalizePath / isSamePath
└── viewport.ts     computeViewportFit + ViewportFit
```

**依赖方向（硬规则）**：

```
base  ←  utils  ←  lib  ←  store / layout / components
```

- **utils 不引 lib**，也不引任何上层运行时；现在整个 utils 目录只有 `clsx` / `tailwind-merge` 两个第三方依赖，运行时零上层耦合
- **lib / store / 组件都可以引 utils**（`@/lib/utils`）

**当前划分**：

| 放哪 | 装什么 | 例子 |
|---|---|---|
| `lib/utils/` | **全局通用**：无状态、无副作用、不带领域知识 | `cn`、`createUniqueId`、`computeViewportFit`、`normalizePath` |
| `store/` | 状态、状态迁移、**文档模型**（类型 + 该领域的值规整与序列化） | `fill.ts`（类型 + `normalizeFill`）、`report-file.ts`（`toReportFile`/`parseReportFile`）、`createPage` |
| `lib/` | 库层：画布封装、注册表、存储与媒体服务，允许单例与副作用 | `element-registry`、`report-service`、`report-storage`、`report-path`、`media` |

**几个刻意没挪的**：

- `store/fill.ts` 的 `normalizeFill`：填充领域知识，且 `store/report-file.ts` 也要用（store 不能引 lib）→ 跟着类型留在 store
- `lib/report-path.ts`：纯函数，但内容是"报告目录怎么命名"（Windows 非法字符、保留设备名、长度上限、data/cache 结构）→ 存储领域知识，留在 lib
- `createPage` / `createReportInfo`：文档对象的构造器，跟着类型走

**store 全量检查的其它收获**：`store/schema.ts` 里删掉了没人调用的 `createEmptyReportFile`（死代码）。

### 26. 图片加载优先级

图片是异步读的（Rust 转 data URL + decode），渲染是同步的，所以要明确"先加载谁"：

| 优先级 | 谁 | 机制 |
|---|---|---|
| 1 | 当前页的图 | 主画布构建对象时 `getMediaImage` **立即**请求，不进队列 |
| 2 | 文档内新插入的图 | 预载队列**队头**（`insertedQueue`），下一个空闲帧就加载 |
| 3 | 侧栏可见页的图 | 缩略图渲染前 `ensureMediaImages` **立即**请求（按需，跳过队列） |
| 4 | 未展示页的图 | 预载队列**队尾**（`backgroundQueue`），空闲帧一次一张 |

- `useMediaPreload`（hook 层）负责 2 和 4：用**页面 id 是否整体更换**区分「换了文档」和「文档内新增」——换了文档就全部排队尾，新增的图插队
- 3 由缩略图触发：`flush` 里先 `await ensureMediaImages(图片来源)` 再渲染，所以从没打开过的页也不会缺图
- `getMediaImage` 是同步接口，缓存没命中就发起加载并返回 `undefined`；加载完成后用 `notifyImageReady()` 通知画布重算填充（同一帧的多次通知会合并成一次）
- 这套逻辑**不能放进 `report-service`**：`media` 需要 `report-service` 提供当前报告目录，反过来调就成环了，所以放在 hook 层，依赖方向仍是 `report-service ← hooks → media`

**⚠️ 当前页缩略图要等图**：侧栏里当前页的缩略图是从主画布直接抓的（`captureCurrentPageThumbnail`），而页面背景图是异步解码的 —— 打开文档时先铺默认底色，图解码完才重新刷填充。同步抓就会抓到一张没有背景图的缩略图，而且 `isFresh` 判定它没过期，之后也不会重抓。所以 `usePageThumbnail` 抓之前要 `await ensureMediaImages(...)` 再等一帧（等 `notifyImageReady` 的 rAF 把填充真正应用上）。换页那条路径例外：画布马上要被重载，只能同步抢抓。

### 27. 图片元素

图片元素（`IMAGE_ELEMENT_TYPE = "image"`）不用单独的渲染/存储链路，**整块就是一个 `fabric.Rect`，图片存在 `attrs.fill`（kind = "image"）里**：

- 换图、适应方式（覆盖/适应/平铺/居中/原始）复用填充面板，不用另写 UI
- 缩略图、预载、媒体清理、undo/redo 全都自动生效（它们都只看 `attrs.fill`）
- `buildImage()` 只造一个带占位色的矩形，真正的图由 `applyElementAttrs` 按 fill 铺上去

插入流程：顶栏「图片」按钮 → `importImageFile()`（Rust 复制进 `media/`、等解码拿到原始尺寸）→ 发 `ELEMENT_COMMAND { type: "insert-image" }` → `use-selection` 里建元素并选中。

**尺寸按原始像素 1:1**，只有比页面还大的图才等比缩到页面内（`scale = min(1, 页宽/图宽, 页高/图高)`）。一开始我写的是"一律缩到页面宽度 40%"，结果元素宽高和文件分辨率对不上，用户没法判断图有没有被压缩 —— 插入图片就该和原图一样大。

**「还原原始尺寸」在属性面板**（不放右键菜单，右键菜单保持精简）：只对**原图比页面大**的图片元素出现（小图插入时已经是原始尺寸，还原没有意义），按钮在「位置与尺寸」下面，带原图分辨率提示，已经还原过时置灰。走的是普通几何更新（`update-geometry` 命令），所以填充重算、落库、撤销都是现成的。

**⚠️ 元素功能一律按 `elementType` 判断，不能按 fabric 类型判断**：图片元素内部就是一个 `fabric.Rect`，用 `instanceof Rect` 会把普通矩形也卷进图片专属功能里。同理以后加视频元素也一样 —— 存储层只看 `elementType` 和 `attrs`。

和视频元素的关系：视频元素以后也走这条路（元素类型 + `attrs` 里放视频地址），区别只是渲染层要换成 `<video>`，**存储和元素注册表不用改**。

### 28. 导出

支持五种格式，全部走**离屏渲染**（`renderPageImage`，和缩略图同一条链路）：

| 格式 | 说明 |
|---|---|
| PDF | 每页一张满版 JPEG，页面尺寸按画布 1:1（1920×1080px @96dpi = 1440×810pt），**附带 report.json 附件** |
| PNG / JPEG | 单页存文件、多页选目录批量存 |
| 长图 | 所有页竖着拼成一张 PNG |
| HTML 包 | `<报告名>/` 目录：`index.html` + `pages/01.jpg…` + `report.json`，浏览器里翻页/全屏 |

**为什么不抓主画布**：主画布上有选中框、变换控件、缩放平移，抓出来的图会带上这些。离屏渲染按 `attrs` 重建对象，所见即所得但干净。

**PDF 为什么手写而不是引库**：我们只需要「多页 + 每页一张满版 JPEG」，用不上 jsPDF 那套排版能力。Rust 里直接拼 PDF 结构（`DCTDecode` 嵌 JPEG），零依赖。注意点：

- 对象编号固定：1 = Catalog、2 = Pages，之后每页占 3 个（Page / Image / Contents），附件再往后排 2 个（Filespec / EmbeddedFile）
- xref 每条必须**正好 20 字节**：`%010d %05d n \n`
- `startxref` 指向 `xref` 关键字的位置
- 附件用 `/Names << /EmbeddedFiles << /Names [(report.json) N 0 R] >> >>`，EmbeddedFile 的 Subtype 要写成 `/application#2Fjson`（斜杠转义）

**PDF 带 JSON 附件是为了「可解析」**：栅格 PDF 里没有元素结构，逆向解析不现实。但把源文件挂成附件之后，导出的 PDF 同时是成品和源文件 —— 以后要做「从 PDF 读回 JSON」，直接抽附件即可，**无损**。

**HTML 包是唯一能播视频的格式**：`index.html` 单文件、零依赖，支持 ←/→/空格翻页、点击左右半屏、全屏、打印样式。视频元素落地后，在页面里按元素坐标叠 `<video>`，底图仍然是这一页截图（视频在底图里是封面帧）。

**长图有 canvas 高度上限**（Chrome 约 16384px），页数多时自动降倍率而不是报错。

**导出前必须等图片落地**：`ensureMediaImages` 先跑，否则离屏渲染是同步的、图还没解码，导出的图里就缺图（和缩略图那个坑同源）。

**导出路径走 Rust**：用户选的目录不在 fs 插件 scope 里，所以落盘用 `write_file_base64` / `write_text_file` / `copy_file` / `export_pdf`；保存对话框需要 `dialog:allow-save` capability。

### 29. Rust 侧按职责分模块

`lib.rs` 只留模块声明、示例命令 `greet` 和 Tauri 装配；命令按职责拆开：

```
src-tauri/src/
├── lib.rs          只做装配（plugin / invoke_handler）
├── base64.rs       base64 编解码
├── path.rs         resolve（相对路径 + 穿越防护）、ensure_parent
└── commands/
    ├── mod.rs
    ├── storage.rs  app_data_dir + storage_* 十三个命令
    ├── media.rs    import_media / read_media_data_url
    └── export.rs   write_file_base64 / write_text_file / copy_file / export_pdf
```

新增命令时先想清楚属于哪一类，别再往 `lib.rs` 里堆。

### 30. 阴影与画笔

**阴影走 fabric 原生 API**：`new fabric.Shadow({...})` 赋给 `object.shadow`，渲染交给 canvas 2D 的阴影实现，导出走同一条渲染管线，不用另写。数据侧存的是纯规格：

```ts
{ color: "#0f172a", opacity: 0.25, blur: 12, offsetX: 0, offsetY: 4 }
```

颜色和透明度分开存，因为 `<input type="color">` 不支持 alpha；渲染时用 `applyAlpha()` 拼 rgba。**fabric 实例永不回读**（和填充一个原则）。阴影对所有元素生效，不走 props 白名单。

**画笔是"真元素"**：`isDrawingMode` + `PencilBrush` 负责落笔，松手时 fabric 触发 `path:created`，那一刻把 `fabric.Path` 登记成 `elementType: "brush"` 的元素：

- `attrs.path` 存路径数组，配 `stroke` / `strokeWidth`
- `buildBrush` 按存下来的宽高设 **scale**（路径是鼠标轨迹，没法按尺寸重新生成几何）
- 为此 `applyElementAttrs` 对 `sizeMode: "scale"` 的元素**跳过 width/height**，否则 fabric 会按「宽 × scale」算出双重缩放的包围盒

**画笔设置要"立刻生效"**：`NumberField` 默认只在失焦/回车提交，而用户在输入框里改完粗细直接去画布落笔时，`blur` 发生在 `mousedown` **之后** —— 第一笔用的还是旧值。所以给 `NumberField` 加了 `onInput`（每次敲入合法数值就回调），画笔用它实时写 store，不经过失焦。

**画笔光标**按笔头和粗细生成内联 SVG 光标（`canvas.freeDrawingCursor`），圆头画圆、方头画方块，粗细跟着变——改设置时鼠标形状立刻对应，不用"画一笔试试"才知道。

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

### 坑 9：fabric 7 默认监听的是**鼠标事件**，不是 pointer 事件

`enablePointerEvents` 默认 `false`，fabric 把 `mousedown`/`mousemove`/`click`/`dblclick` 绑在 `upperCanvasEl` 上。想让 fabric「收不到」这些交互，拦 `pointerdown` 是没用的 —— 浏览器随后照样补发鼠标事件。要么拦鼠标事件本身，要么打开 `enablePointerEvents`。细节见决策 10。

### 坑 10：`Textbox` 的 `width` 不在 fabric 的排版属性里

`textLayoutProperties` 只有字号、行高、text、对齐这些，**没有 `width`**。所以 `set({ width })` 只改框、不重新折行，改完必须手动 `initDimensions()`。属性面板改文本宽度就踩过这个。

---

## 六、未完成 / 待办

| 项 | 说明 |
|---|---|
| 单元素对齐页面 | 目前对齐只支持「≥2 个选中，以选区包围盒为基准」。单选对齐到页面计划放右键菜单 |
| 图片/视频元素 | 目录结构（`media/`）和 hash 去重规则已定，元素类型还没做 |
| 媒体孤儿清理 | 保存时按 JSON 引用清理未使用的媒体文件 |
| 缩放锚点 | 仍是缩放到页面中心，不是光标位置（平移已做，见决策 10） |
| 属性面板可编辑 | 位置/尺寸/角度已可编辑（走命令总线）；颜色、字体、不透明度还没接；多选时整块不显示（后续做批量修改） |
| 批量编辑 | `selectionStore.primary` 在多选时为 null 就是为它留的口 |
| 数据绑定 | `ElementAttrs` 允许任意扩展字段，`attrs` 里有空位 |
| 导出 PDF/图片 | 顶栏「导出」按钮目前只弹提示 |
| 自定义数据目录 | 抽屉里只读展示 + 「在文件夹中显示」，迁移逻辑没做 |
| 文本编辑的 window blur | 切到别的应用不会退出编辑（fabric 只在画布内失焦时退出） |
| 文本纵向拉伸不保留 | 文本高度由内容撑开，纵向拉伸在重开文件后会回到自然高度（以前靠 scale 存着，现在不存了） |

---

## 七、约定（写代码前先看）

- 规则文件：`conv/rules/frontend-*.md`、`conv/project/frontend-*.md`。**`conv/` 目录由 conv 管理，可能被 `conv update` 覆盖**
- `lib` ≠ `utils`：`lib` 是库层（允许单例和副作用），`utils` 只放纯函数
- 引入入口：`src/store`、`src/hooks` **对外一律从各自的 `index.ts` 引**（`@/store`、`@/hooks`）；`lib` 不设 barrel，按 `@/lib/xxx` 直接引。**store 内部互相 import 必须用相对路径**，经自己的 barrel 会形成「index → 模块 → index」的循环
- 颜色令牌在 `src/global.css`，文档内容色（页面/形状/线条/文本）用 `--report-*` 前缀，**只在 `:root` 定义、不随深色模式变**，fabric 读不到 CSS 变量，运行时经 `getReportPalette()` 取
- 字号只用 `text-xs` / `text-sm`，不要为奇数值造新 token
- **元素的尺寸只有 `width/height`（线条是 `length`），不要在 attrs 里存 scale**；几何写死在路径里的元素靠 `ElementDefinition.sizeMode: "scale"` 在拉伸时临时缩放，dump 时折算回宽高（决策 12）
- Tab 缩进、中文注释、注释写「为什么」而不是「做了什么」
- 在输入框里打字时不能抢全局快捷键（`isEditableTarget`）

---

## 八、本次会话做了什么（2026-11-02）

### 已提交

| commit | 内容 |
|---|---|
| `be38595` | 报表编辑器核心功能：多页画布、绘制、撤销、保存、界面骨架（80 文件） |
| `255bf6e` | shadcn 组件选型规则补进 `conv/rules/frontend-style.md` 第 10 条 |

### 还在工作区（未提交）

1. **空格平移**（决策 10）：`use-space-pan.ts` 新增，`use-canvas.ts` 加 `panOffsetRef`/`panBy`，`zoom.ts` 的 `fit()` 改成必定通知
2. **属性面板可编辑**（决策 11）：`ELEMENT_COMMAND` 加 `update-geometry`，`element-properties.tsx` 重写成可编辑的数值字段
3. **去掉元素里的 scale**（决策 12）：形状路径按尺寸重新生成、`dumpElementAttrs` 折算 scale、旧文件迁移
4. **页面缩略图**（决策 13）：当前页抓图 + 其它页懒加载离屏渲染；`thumbnailStore` 纯内存；`element-registry` 拆出不登记的 `buildElementObject`

`src/store`、`src/hooks` 改成统一从各自 `index.ts` 引（`@/store`、`@/hooks`），19 个文件 42 处引用已换。

### ⚠️ 只过了 `tsc`，没有跑过应用

这次会话的环境跑不了 `pnpm tauri dev`（`vite build` 也起不来：esbuild 子进程在沙箱里 `spawn EPERM`），所以上面三块**只保证类型正确，运行时行为没验证过**。接手时先按下面顺序点一遍：

- 空格 + 拖拽平移；空格状态下点元素不该选中；文本编辑时空格能打出空格
- 属性面板改 X/Y/宽/高/角度，画布跟手；Esc 放弃、回车提交、Ctrl+Z 能撤
- **画形状 → 拖控制点拉伸 → 保存 → 重开**：尺寸必须一模一样（这是去 scale 的核心验收）
- 打开一份**旧报告**：里面的形状不能变成默认大小（靠 `migrateAttrs`）
- 矩形/线条拉伸后保存重开，尺寸也要对（这条以前是坏的）

### 文档自身

`NOTES.md` 是临时交接文档，**不打算进版本库**（上一轮 `be38595` 里带进去过一次，后续由用户决定去留）。

---

## 六、测试

```bash
pnpm test          # 一次性
pnpm test:watch    # 监听
```

当前只有**纯函数单测**（`test/unit/`），故意不依赖 jsdom / node-canvas：

| 文件 | 覆盖 |
|---|---|
| `path.test.ts` | `normalizePath` / `isSamePath`（大小写、分隔符、结尾斜杠） |
| `fill.test.ts` | `normalizeFill`：老格式纯色、单色标补齐、位置/透明度夹取、旧渐变坐标换算角度、非法输入 |
| `report-path.test.ts` | 目录名清洗（非法字符、保留名、长度）、路径拼装 |
| `report-file.test.ts` | 金标报告解析、序列化幂等、重复 id、未知元素类型保留、空文本"读时留、存时丢" |

**金标报告** `test/fixtures/report-v1.json`（+ `media/tiny.png`）：一份代表当前格式的文档，含文本/矩形/图片/线条/椭圆/画笔/阴影/渐变背景/参考线。

**维护约定**：改文件格式（加字段、改语义）时，先改这份金标报告，再看测试哪条挂了 —— 挂的那条就是"这次改动破坏了什么"。序列化测试断言的是**幂等**（parse → 序列化 → 再 parse → 序列化，两次 JSON 必须完全一致），不是和 fixture 逐字节比对，所以新增字段不用手工同步期望值。

**为什么没有渲染测试**：fabric 需要真实 canvas，得引 jsdom + node-canvas，成本高。等"无头渲染"能力落地后，用金标报告直接渲染成 PNG 做像素比对更划算。

**环境注意**：vitest 要通过 esbuild 起子进程，在受限的沙箱里会 `spawn EPERM`，需要在正常终端里跑。

### 31. 校验入口、无头渲染、金标样例

这三件是为"报告测试"和以后接 agent 共同准备的地基，和做不做 agent 无关——它们本质是**让报告可以被程序检查**。

**校验入口** `lib/report-validate.ts`：

```ts
validateReportJson(raw) → { ok, file, issues: [{ level, code, message, path? }] }
```

- 以前 `parseReportFile` 的 warnings 只能弹 toast，信息用完就没；现在升级成结构化 issue
- `level`：`error` = 没法用（不是对象 / 非法 JSON）；`warning` = 已自动修正但值得告知
- `code` 是稳定标识（`missing-report-id` / `unknown-element-type` / `future-version` …），
  界面和工具按它分类，别去匹配中文文案
- `path` 标出位置（`pages[1].elements[0]`）
- `openReport` 已经改用它，顺带把"未注册类型会保留但不显示"这件事也提示出来了
- 模块不 import fabric，所以能在 node 里跑（单测已经覆盖）

**无头渲染** `lib/report-render.ts`：

```ts
renderReportPages(file, { root, relative }, { scale, format, quality }) → data URL[]
```

- 和导出的唯一区别是数据来源：导出读 store 里的当前文档，它读传进来的 `ReportFile`，
  所以能渲染**磁盘上任意一份报告**，不依赖编辑器状态
- 图片解析靠 `media.setMediaBase()` 临时把媒体根指到目标报告目录，渲染完复位；
  文件名是按内容 hash 生成的，两份报告的 media 不会串
- 目前还没有 UI/命令入口 —— 下一步是把它暴露成工具（agent 或 CLI），
  暴露之后就能"生成 JSON → 渲染 → 自己看对不对"闭环

**金标报告作为样例**：`test/fixtures/README.md` 写了字段速查、覆盖范围和维护规则。
它就是"合法文档长什么样"的模板 —— 给 agent 当 few-shot，也给回归测试当基准。
