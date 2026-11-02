# 项目特有规则 · frontend-style

通用规则见 [../rules/frontend-style.md](../rules/frontend-style.md)。

本文件只写**本项目独有**的补充规则，不重复通用规则。

## 主题与颜色

1. 唯一的全局样式文件是 `src/global.css`，由根组件 `src/App.tsx` 引入。
2. UI 颜色全部是 CSS 变量（`:root` / `.dark` 两套），组件只用语义类名（`bg-chrome`、`text-muted-foreground` 等），不写 hex、不写 `bg-[#xxx]`。
3. 文档颜色（报告页面底色、页面投影、形状默认填充/描边、线条默认色）同样定义在 `global.css` 的 `:root` 里，前缀 `--report-*`。它们属于**文档内容**而不是 UI 主题，因此不随深色模式变化。
4. fabric 只接受字面量颜色，统一由 `src/lib/theme-tokens.ts` 的 `getReportPalette()` 读取令牌，组件与元素定义里不出现颜色字面量。

## 字号

只用刻度里已有的档位：`text-xs`（12px，正文与次要信息）、`text-sm`（14px，标题）。

- 设计稿量出来是 10、11、13 这类非标值时，取**最接近的档位**；不要新增 `--text-2xs` 之类的非标档位，也不要写 `text-[13px]`。
- 换档位后出现的 ±1px 对不齐，用 flex 居中（`items-center` / `justify-center`）解决，不要靠补固定高度或行高去凑。

## Tailwind + shadcn

- 根类名与「文件头声明可覆盖的类名」在本项目**不强制**：对外样式入口就是 `className`。
- 引入或生成的 shadcn 组件若带 `dark:` 变体，需要清理成令牌（见通用样式第 8 条）。

## 画布

- 画布尺寸等于可视区，缩放由 `viewportTransform` 承担，页面对象本身保持 1920×1080 原始尺寸。
- 点阵背景是容器上的 CSS 背景，不参与缩放。
