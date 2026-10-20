# 评测报告归档

这里存放长期保留的实验报告：`<UTC 时间>-<A>_vs_<B>.json` + `.md`，与
`bench/strength/results/` 下产出的文件同名同内容。结果显示目录已 gitignore，
需要留档的实验把文件抄到这里即可。

## 两类文件

- **`.json`**：机器可读。当前 schema 含 `games`（逐局、逐手，含节点数 / 深度 /
  `ttHits` / `reason` / 耗时）、`meta.statistics`（Bootstrap 方法与种子）、
  `meta.openingsVersion`（开局集指纹）、`a/b.resolved`（实际生效参数）。
- **`.md`**：人读摘要。表头里的「完整数据」指向 `meta.resultFile`。

## 两点注意

1. **`2026-10-20_04-05-*` 那三份用的是旧 schema**：它们把逐局信息放在
   `gamesSummary` 里（开局、双方、结局、手数、耗时、错误），**没有逐手度量**，
   也没有 `resolved` / `openingsVersion` / `statistics`。这是当时代码的真实输出，
   不是归档时漏抄。要逐手数据只能重跑。
2. **`meta.resultFile` 指向产出的原始路径**（`bench/strength/results/…`，已 gitignore）。
   归档副本与该路径内容一致；原路径在本机之外不存在，这不影响报告本身的可读性。
