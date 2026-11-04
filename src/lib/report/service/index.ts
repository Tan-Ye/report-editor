/**
 * 报告服务的统一出口。
 *
 * 调用方一律从 `@/lib/report/service` 引，不直接引下面这些模块 ——
 * 内部怎么拆（上下文 / 报告 / 草稿 / 模板 / 数据目录）随时可以调整。
 */
export * from "./context";
export * from "./data-dirs";
export * from "./draft";
export * from "./report";
export * from "./template";
