<!-- conv v0.1.0 | 2026-11-01 | source: frontend-structure/rules.md | 由 conv 管理，执行 `conv update` 可更新。 -->

# 组件与目录规则清单

只有规则，没有解释和示例。

1. 文件命名一律 **kebab-case**，全小写，组件文件也不例外。
2. 除框架要求的 default 导出外，一律使用具名导出。
3. 组件、函数、hook 在同一模块内不允许重名。
4. 工具函数放 `utils/`，按用途分文件，一个文件一个主题。
5. `utils/` 里只允许纯函数：无副作用、不发请求、不依赖 React。
6. 全局 hook 放 `hooks/`，文件名以 `use` 开头。
7. hook 返回对象，不返回数组。
8. 接口放 `services/`，按功能分目录，每个目录 `index.ts` + `interface.ts`。
9. `interface.ts` 只放类型；`index.ts` 只放函数调用和传参。
10. `services/` 内一个函数只对应一个后端接口，不允许互相调用。
11. 多接口协调放 `hooks/` 或页面组件，不放 `services/`，也不放 `utils/`。
12. `services/` 不碰 UI：不发提示、不跳路由、不读写 localStorage。
13. 展示组件不直接调 `services/`，数据获取在页面或 hook 里做。
14. 依赖方向单向：`pages → components / services / hooks / utils`；`components` 不引 `pages`，`services` 不引任何 UI。
15. `utils/` 和 `hooks/` 各有一个 `index.ts` 做导出入口；模块内部文件不得从自己的 `index.ts` 引入。
16. `index.ts` 只做导出，不写逻辑。
17. 只有被 2 个以上模块使用的类型才进 `types/`，否则留在使用它的 `services/*/interface.ts`。
18. 跨三层以上目录一律用 `@/` 别名，不写 `../../../`。
19. 单个组件的 props 用 `interface` 声明，命名为 `XxxProps`；联合、基础类型用 `type`。
20. 组件按功能模块细分；单个组件 200–300 行以内，超了就拆。
21. 列表渲染的 `key` 必须用数据的稳定唯一标识（如 `id`），禁止用数组 `index`。
