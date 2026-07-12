# v0.18.7 发版: AST 级代码智能 — find_definition + find_references

## 提交

`2f46d40` → `origin/main` + tag `v0.18.7`

## 新增功能

| 功能 | 说明 |
|------|------|
| `find_definition` | MCP 工具 — 基于 AST 元数据（entities/scope）精确匹配符号定义位置 |
| `find_references` | MCP 工具 — 两阶段策略：import 元数据扫描 + FTS 全文搜索 |
| `codeMeta` 端到端管道 | CodeChunker 提取 → VectorChunk 序列化 → LanceDB JSON 列 → SearchResult 反序列化 |
| LanceDB schema 自动迁移 | 启动时检测并添加 `codeMeta` 列，向后兼容旧数据库 |
| 新查询方法 | `getCodeChunksWithMeta()` / `findTextReferences()` |

## Bug 修复

| Bug | 修复 |
|-----|------|
| `toSearchResult()` 丢失 codeMeta | 新增 `parseCodeMeta()` 调用，反序列化 LanceDB JSON 字符串 |
| `toVectorChunk()` 丢失 codeMeta | 同上 |
| `LanceDBRawResult` 缺少 `codeMeta` 字段 | 补充 `codeMeta?: string \| null` 类型定义（发版 pre-push hook 拦截） |

## 发布流程

1. CHANGELOG.md 更新 + version bump (0.18.6 → 0.18.7)
2. Biome pre-commit hooks ✅ + tsc pre-push hooks ✅
3. 推送到 GitHub → `2f46d40` with tag `v0.18.7`
4. 12 files changed, +1102 / -14

---

# P0 修复: loadGitignore stopAbove 完整补全

## 问题

`list_files` / `ingest_directory` 在用户指定的 `baseDir` 位于被父级 `.gitignore` 忽略的目录下时（如 `tmp/`），会错误地过滤掉所有文件。具体表现：`rag-server.files.integration.test.ts` AC-007 测试返回 0 个文件（预期 3）。

## 根因

`loadGitignore()` 从 `baseDir` 向上遍历到文件系统根，加载了项目根 `.gitignore` 的 `tmp/` 规则，导致 `tmp/test-data-ac007/` 下的所有测试文件被过滤。

## 修复方案

新增 `stopAbove` 可选参数到 `loadGitignore()`，向上遍历到指定目录即停止。所有调用端统一传 `stopAbove = baseDir`。

## 修改文件（6 个）

| 文件 | 改动 |
|------|------|
| `src/utils/gitignore.ts` | 新增 `stopAbove?: string` 参数 + JSDoc + 遍历逻辑 |
| `src/server/index.ts:843` | `loadGitignore(baseDir)` → `loadGitignore(baseDir, baseDir)` |
| `src/server/index.ts:1011` | `loadGitignore(args.path)` → `loadGitignore(args.path, args.path)` |
| `src/cli/file-collection.ts:59` | `loadGitignore(resolved)` → `loadGitignore(resolved, resolved)` |
| `src/cli/list.ts:317` | `loadGitignore(root)` → `loadGitignore(root, root)` |

## 附带修复（3 个）

| 文件 | 改动 |
|------|------|
| `src/__tests__/security/security.test.ts` | S-001 URL 过滤覆盖完整镜像链 |
| `src/__tests__/embedder/embedder-device.test.ts` | TS 类型断言 `err as Error` |
| `src/embedder/__tests__/lazy-initialization.test.ts` | 移除未使用 import |

## 验证结果

- ✅ AC-007 文件管理测试 15/15 通过
- ✅ S-001 安全测试 10/10 通过
- ✅ Biome lint/format/check 无错误
- ✅ TypeScript 类型检查通过
- ✅ knip 未使用导出报告（6 项，预存在，与本次改动无关）
