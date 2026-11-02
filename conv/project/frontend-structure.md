# 项目特有规则 · frontend-structure

通用规则见 [../rules/frontend-structure.md](../rules/frontend-structure.md)。

本文件只写**本项目独有**的补充规则，不重复通用规则。

## 目录职责

| 目录 | 职责 |
|---|---|
| `src/layout/` | 四区布局组件：顶栏 / 页面栏 / 画布 / 属性面板，按区域建子目录 |
| `src/components/ui/` | shadcn-ui 生成的基础组件，不做业务封装 |
| `src/store/` | 应用状态与数据协调：report / page / element / tool / schema / 文件读写 |
| `src/lib/` | 库层：画布封装、元素注册表、主题令牌读取等，允许单例与模块级副作用 |
| `src/base/` | 常量与数据表：页面尺寸、线条样式目录、形状目录与 SVG 路径 |

## 与通用规则的差异

1. 通用规则里的 `utils/`，本项目对应 `src/lib/`。`lib` 是**库层**而不是纯函数层：允许单例、模块级副作用、框架依赖。只有纯函数才放进 `src/lib/utils.ts`。
2. 不使用 `pages/` 目录。本应用是单窗口编辑器，`src/layout/` 承担页面级组织职责。
3. `src/lib/emitter.ts` 是预留的跨模块事件总线，后续用于元素更新通知，不属于死代码。
4. 组件一律具名导出；入口 `src/main.tsx` 对根组件 `App` 保留默认导入，属于框架约定的例外。

## 依赖方向

- 组件层（`src/layout/`）可以读写 `src/store/`，也可以通过 `src/lib/` 操作画布。
- `src/lib/` 可以依赖 `src/store/` 的类型与运行时映射表；反向不允许（`store/` 不得 import `lib/element-registry` 这类带副作用的模块）。
- `src/base/` 只导出常量与数据，不依赖任何运行时模块。
- 状态的写入统一走 `store/coordination` 或对应的 store 方法，组件不直接改 store 的 `state` 字段。

## 拆分

- 按职责内聚拆文件，不按行数硬拆。画布这类状态机集中在一个文件里是合理的。
