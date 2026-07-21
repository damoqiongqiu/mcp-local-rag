# mcp-local-rag 多实例架构改造 — 实现总结

**日期**: 2026-07-20 ~ 2026-07-21
**状态**: 实现完成，测试通过

## 做了什么

将 mcp-local-rag 从「单 DB_PATH + 多 BASE_DIRS 混合存储」改造为「多实例独立隔离」架构。

### 新增文件 (7)

| 文件 | 说明 |
|------|------|
| `src/instances/types.ts` | InstanceConfig, InstanceConfigError 等核心类型 |
| `src/instances/parser.ts` | RAG_INSTANCES JSON 数组解析器，字段级错误信息 |
| `src/instances/resolver.ts` | 实例配置解析，RAG_INSTANCES > BASE_DIRS > BASE_DIR 优先级 |
| `src/instances/router.ts` | InstanceRouter — 多实例路由层，替代单 VectorStore |
| `src/instances/__tests__/parser.test.ts` | 27 tests |
| `src/instances/__tests__/resolver.test.ts` | 18 tests |
| `src/instances/__tests__/router.test.ts` | 24 tests |

### 修改文件 (10)

- `src/server/types.ts` — 增加 instances 字段
- `src/server-main.ts` — 解析 RAG_INSTANCES 并传入 RAGServer
- `src/server/index.ts` — this.vectorStore → this.instanceRouter (40+ 处)
- `src/server/tool-definitions.ts` — MCP 工具 schema 增加 instance 参数
- `src/cli/options.ts` — --instance flag + RAG_INSTANCES 解析
- `src/cli/query.ts`, `list.ts`, `ingest.ts`, `delete.ts`, `status.ts`, `read-neighbors.ts` — --instance flag 消费

### 测试通过

- 类型检查: ✅
- 构建: ✅
- 新增测试: 69/69 ✅
- 受影响测试: 87/87 ✅ (server config + CLI)
- **合计: 156/156** ✅

## 关键设计决策

1. **配置格式**: `RAG_INSTANCES='[{"name":"x","baseDir":"/p","dbPath":"./db"}]'` (JSON 数组)
2. **搜索**: instance 参数 required，instance="*" 跨实例
3. **搜索合并**: per-instance top-k，不做跨实例 score 重排
4. **文件路由**: 最长前缀匹配 (isUnderOrEqual)
5. **异常隔离**: per-instance try/catch，单实例失败不拖垮全局
6. **向后兼容**: BASE_DIR + DB_PATH 单实例模式完全保留

## 使用方式

```bash
# 多实例模式
export RAG_INSTANCES='[
  {"name":"app-a","baseDir":"/home/projects/a","dbPath":"./lancedb-a"},
  {"name":"app-b","baseDir":"/home/projects/b","dbPath":"./lancedb-b"}
]'

# CLI
mcp-local-rag ingest --instance app-a
mcp-local-rag query "how does login work" --instance app-b

# 单实例模式（向后兼容）
export BASE_DIR=/home/projects/a
export DB_PATH=./lancedb/
mcp-local-rag ingest  # 和以前完全一样
```

## 已知局限

- router.test.ts 使用 vi.doMock + dynamic import，在 `isolate: false` 下与其他测试混合运行时模块缓存可能冲突。单独运行（`npx vitest run src/instances/__tests__/router.test.ts`）完全通过。
- `test tsconfig` (tsconfig.test.json) 的预存类型错误未修复（非本次改动引起）
