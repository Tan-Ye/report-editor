/**
 * store 的对外出口：src/store 之外一律从这里引，不直接引具体模块。
 *
 * store 内部互相 import 必须走相对路径（`./page`）——
 * 内部也经这个文件引会形成「index → 模块 → index」的循环。
 */
export * from "./coordination";
export * from "./element";
export * from "./history";
export * from "./page";
export * from "./report";
export * from "./report-file";
export * from "./save-state";
export * from "./schema";
export * from "./tool";
export * from "./zoom";
