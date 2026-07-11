# mcp-local-rag v0.17 — 第一梯队 + 骨架补齐

## 完成摘要

针对 11 项改进清单，Tier 1 全部完成，同时补齐了 3 个缺失的 handler 骨架（这些 handler 已在 tool-definitions.ts 中声明但无实现体）。

## 变更清单

### Tier 1 — 性价比极高（4/4 ✅）

| # | 项目 | 状态 | 说明 |
|---|------|------|------|
| 1 | `.gitignore` 自动遵守 | ✅ 早已实现 | `ingest_directory` line 873, `list_files` line 736 |
| 2 | `reindex_all` | ✅ 新增 handler | 遍历所有已索引文件全量 reingest，单次 optimize |
| 3 | 搜索片段高亮 | ✅ 增强 `handleQueryDocuments` | 新增 `buildMatchContexts()` 函数，提取 query terms 的 before/match/after |
| 4 | `status` 增强 | ✅ 增强 `handleStatus` | 返回 perFileChunkStats、modelName、hybridWeight、maxDistance、grouping、maxFiles、device、dtype、dbPath |

### 骨架补齐（同步完成）

| # | 项目 | 状态 | 说明 |
|---|------|------|------|
| 7 | `config` 工具 | ✅ 新增 handler | 运行时读写 hybridWeight/maxDistance/maxFiles/grouping，即时生效 |
| 8 | `dedup_check` | ✅ 新增 handler | SHA256 文本哈希 + Jaccard 相似度检测近重复文档 |
| 10 | `export_index` | ✅ 新增 handler | 全量导出索引到 JSON 文件 |

### 待完成

| # | 项目 | 难度 |
|---|------|------|
| 5 | `ingest_directory` 进度回调 | 中 |
| 6 | 文件监听 / `--watch` 模式 | 大 |
| 9 | 时间范围过滤（schema 已有，handler 未实现） | 小 |
| 11 | 多模型热切换 | 大 |

## 修改文件

```
src/server/index.ts       +319 行  — 4 新 handler + 2 增强
src/vectordb/index.ts     +36 行   — config getters + updateConfig()
```

## 编译状态

- ✅ `tsc --noEmit` 通过（严格模式）
- ✅ `tsc` build 通过
- ✅ Biome lint 通过（1 个预存在的 warning 与本次无关）
- ✅ 无循环依赖
- ⏳ 测试运行中
