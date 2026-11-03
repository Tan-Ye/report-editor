# 金标报告（golden report）

`report-v1.json` 是**当前文件格式的代表样本**。三个用途：

1. **回归基准**：`pnpm test` 会解析它、断言零警告，再走一遍「解析 → 序列化 → 再解析」的幂等检查
2. **格式文档**：想知道某个字段长什么样，看它比看源码快
3. **给 agent 的 few-shot 样例**：接入 agent 之后，这份文件就是"合法文档长什么样"的模板

## 维护规则

**改文件格式时先改这份报告，再看测试挂在哪一条。** 挂掉的那条就是这次改动破坏了什么。

序列化测试断言的是**幂等**（两次序列化结果完全一致），不是和这份文件逐字节比对 ——
所以新增字段只要在报告里体现出来即可，不用手工维护期望值。

## 它覆盖了什么

| 内容 | 在哪 |
|---|---|
| 文本元素（字号/字重/行高/颜色） | 第 1 页 `el-fixture-title` |
| 矩形 + 描边 + 阴影 | 第 1 页 `el-fixture-card` |
| 图片元素（`attrs.fill` 里的 image） | 第 1 页 `el-fixture-photo`（引用 `media/tiny.png`） |
| 线条（起点 + 角度 + 长度） | 第 1 页 `el-fixture-divider` |
| 页面背景渐变 | 第 1 页 `style.fill` |
| 参考线（按 10 单位取整） | 第 1 页 `guides` |
| 形状（路径型元素） | 第 2 页 `el-fixture-bubble` |
| 画笔（`attrs.path` 存轨迹） | 第 2 页 `el-fixture-stroke` |

## 字段速查

```jsonc
{
  "version": 1,                 // 文件格式版本，读取时按它决定要不要迁移
  "reportId": "…",              // 报告身份，不是目录名；缺了会重新生成
  "reportName": "…",
  "pageWidth": 1920,            // 页面尺寸随文件走，不依赖运行时常量
  "pageHeight": 1080,
  "pages": [
    {
      "pageId": "…",
      "pageName": "封面",
      "style": { "fill": FillSpec },        // 绘制区域背景
      "guides": [{ "axis": "x", "position": 120 }],
      "elements": [
        { "id": "…", "elementType": "rect", "attrs": ElementAttrs }
      ]
    }
  ]
}
```

`FillSpec` 三种形态：

```jsonc
{ "kind": "solid", "color": "#ffffff" }
{ "kind": "gradient", "type": "linear", "angle": 90, "stops": [{ "offset": 0, "color": "#fff", "alpha": 1 }] }
{ "kind": "image", "source": "media/<内容hash>.<ext>", "fit": "cover" }   // fit: cover|contain|tile|center|original
```

`full image` 的 `source` 始终相对报告目录，所以换数据目录不用改写文件。

## 元素类型

`rect`、`text`、`image`、`brush`、`ellipse`、`triangle`、`diamond`、`parallelogram`、
`trapezoid`、`pentagon`、`hexagon`、`star`、`arrow`、`bubble`、`line-solid`、`line-dashed`、
`line-dotted`、`line-double`、`line-arrow`、`line-double-arrow`、`line-dashed-arrow`。

完整清单见 `src/base/elements.ts` 的 `KNOWN_ELEMENT_TYPES`；校验时遇到不认识的类型会
保留数据并给 `unknown-element-type` 警告（不会丢，但画布上不显示）。
