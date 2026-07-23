# QA 评估报告: mcp-local-rag v0.20.0

| Field | Value |
|-------|-------|
| **Date** | 2026-07-23 |
| **Package** | `@damoqiongqiu/mcp-local-rag` v0.20.0 |
| **Type** | MCP 服务器 + CLI 工具 |
| **Branch** | main |
| **Tier** | **Exhaustive** |
| **Scope** | 全项目（测试覆盖、CI/CD、错误处理、性能、回归风险） |
| **Duration** | 全量分析 |
| **Test Files** | 78 (src 内) |
| **Total Tests** | 1214 |

---

## Health Score: 62/100

| Category | Score | 说明 |
|----------|-------|------|
| 测试覆盖 | 55 | 8 个模块零测试，关键管道 untest |
| CI/CD 质量 | 78 | 矩阵完备但缺性能/安全扫描 |
| 错误处理 | 75 | 结构良好但测试覆盖不足 |
| 可观测性 | 65 | 日志分层清晰但集成失败率高 |
| 回归防护 | 55 | 快速迭代周期，集成测试失败多 |
| 性能测试 | 40 | 仅 1 个 P95 测试，无基准/压力 |
| 发布流程 | 70 | 双通道发布但缺预发布验证 |

---

## Top 3 Things to Fix

1. **QA-001: 8 个源模块零单元测试** — `ingest/compute.ts`、`ingest/visual.ts`、`cli/file-collection.ts`、`utils/gitignore.ts`、`utils/limits.ts`、`pdf-visual/captioners/fast.ts`、`pdf-visual/captioners/shared.ts`、`bin/install-skills.ts` 完全没有对应测试文件，这些模块是摄入管道的核心计算逻辑
2. **QA-002: 集成测试 ~53 个真实失败** — 排除 SAFE_DELETE sandbox 限制后，仍有大量集成/e2e 测试失败，涉及 multi-root、delete、dispatcher、ingest、search 等关键路径
3. **QA-003: 零性能基准测试** — 项目无 benchmark suite、无压力测试、无大仓库摄入性能数据，仅 1 个 read_chunk_neighbors P95 测试

---

## 1. 测试覆盖盲区

### 1.1 模块级覆盖分析

| 目录 | 源文件数 | 测试文件数 | 覆盖率评估 |
|------|---------|-----------|-----------|
| src/server/ | 6 | 19 | ★★★★☆ 最高 |
| src/parser/ | 5 | 7 | ★★★★☆ |
| src/pdf-visual/ | 8 | 5 | ★★★☆☆ 有缺 |
| src/chunker/ | 4 | 3 | ★★★☆☆ 有缺 |
| src/utils/ | 9 | 7 | ★★★☆☆ 有缺 |
| src/embedder/ | 3 | 3 | ★★★★☆ |
| src/instances/ | 4 | 3 | ★★★☆☆ 有缺 |
| src/vectordb/ | 3 | 2 | ★★★☆☆ |
| src/cli/ | 9 | 14 | ★★★★☆ |
| **src/ingest/** | **2** | **0** | ★☆☆☆☆ **零测试** |
| src/ + 入口 | 3 | 4 | ★★★☆☆ e2e 覆盖 |
| src/bin/ | 1 | 0 | ★☆☆☆☆ **零测试** |

### 1.2 零测试模块详细列表

| 模块 | 风险级别 | 说明 |
|------|---------|------|
| `ingest/compute.ts` | **HIGH** | 共享 chunk+embed 计算管道，MCP 和 CLI 双路径依赖。`buildChunksAndEmbeddings` 和 `buildVectorChunks` 是整个摄入流程的计算核心，零测试意味着：空文本、超长文本、embedding 对齐失败、chunk/embedding 索引不匹配等边界情况完全未验证 |
| `ingest/visual.ts` | **HIGH** | 视觉 PDF 富集管道，`prepareVisualPdfChunks` 包含动态 import、captioner 创建、VLM 调用、doc.destroy() 清理等多步骤复杂流程。仅通过集成测试间接覆盖，错误路径（captioner 失败、destroy 失败、零页面）未验证 |
| `cli/file-collection.ts` | **MEDIUM** | CLI 文件收集逻辑，包含路径解析、扩展名验证、base-dir 安全检查、gitignore 集成。当前仅通过集成测试覆盖 |
| `utils/gitignore.ts` | **MEDIUM** | gitignore 加载与过滤，包含向上遍历、多 profile 匹配、目录尾斜杠模式。无单元测试意味着模式匹配逻辑未验证 |
| `utils/limits.ts` | **LOW** | 数值常量定义（MAX_SCAN_DEPTH、SKIP_DIR_NAMES 等）。虽为常量，但无测试验证常量值一致性 |
| `pdf-visual/captioners/fast.ts` | **MEDIUM** | SmolVLM fast 配置文件，包含模型加载、PNG 解码、chat template、生成选项。仅通过 orchestrator 集成测试间接覆盖 |
| `pdf-visual/captioners/shared.ts` | **MEDIUM** | 共享的模型加载器（state machine）、PNG 解码、后处理管线（控制字符剥离、截断）。两个 profile 都依赖此模块 |
| `bin/install-skills.ts` | **LOW** | Skills 安装脚本，无测试 |

### 1.3 关键路径覆盖评估

| 关键路径 | 覆盖程度 | 评估 |
|---------|---------|------|
| **Ingest Pipeline** (parse → chunk → embed → persist) | 中等 | compute.ts + visual.ts 零单元测试，仅通过集成测试覆盖 |
| **Embedder 懒加载** | 良好 | 有 lazy-initialization.test.ts、model-registry.test.ts、connectivity.test.ts |
| **多实例路由** | 中等 | router.test.ts 有测试，但 multi-root-integration 全部失败 |
| **错误边界** | 中等 | error-utils.boundary.test.ts 存在，但 dispatcher-mapping 测试失败 |
| **AST 分块 (CodeChunker)** | 良好 | 35 个单元测试覆盖 TS/JS/Python |
| **删除/回滚** | 差 | delete.integration 测试失败，ingest-rollback 测试失败 |
| **搜索 (FTS + 向量)** | 中等 | search.integration 和 vectordb.test 有覆盖，但测试失败 |

### 1.4 边界条件测试覆盖

| 边界条件 | 状态 | 说明 |
|---------|------|------|
| 空文件 | ✅ | code-chunker 有 boundary 测试 |
| 大文件 | ⚠️ | MAX_FILE_SIZE 有常量定义但无超限拒绝测试 |
| 损坏文件 | ✅ | parsePdf-destroy、parsePdf-foreign-error 有测试 |
| 并发摄入 | ❌ | 无并发测试 |
| 磁盘满 | ❌ | 无测试 |
| 空 embedding/零 chunk | ⚠️ | compute.ts 有快速返回逻辑但无测试 |
| LIKE 注入 | ✅ | vectordb scope prefilter 有注入中性化测试 |

---

## 2. CI/CD 质量

### 2.1 流水线评估

| 门禁 | 状态 | 评价 |
|------|------|------|
| Lint (biome) | ✅ 3 平台 | 标准 |
| Format check | ✅ 3 平台 | 标准 |
| Type check (tsc) | ✅ 3 平台 | 标准 |
| Unit + Integration Tests | ✅ 3 平台 | CPU 矩阵，mock 隔离得当 |
| WebGPU Tests | ✅ 2 平台 | Linux + Windows，Vulkan setup 复杂但正确 |
| Package Smoke | ✅ | 安装 tarball 验证生产导入图 |
| Coverage | ✅ | v8 provider，阈值：70% lines / 60% branches / 65% functions |
| **Dependency Audit** | ❌ | **缺失** — 无 `npm audit` / `pnpm audit` 步骤 |
| **Security Scan** | ❌ | **缺失** — 无 SAST/secret scanning |
| **Performance Regression** | ❌ | **缺失** — 无基准测试或 perf 回归检测 |
| **Code Size / Bundle Analysis** | ❌ | **缺失** |
| **Changelog Validation** | ❌ | **缺失** — 无 CHANGELOG 格式/版本一致性检查 |

### 2.2 CI 配置亮点

1. **模型缓存策略优秀**: `prepare-models` job 作为单点下载 hub，跨 OS 缓存共享，测试 job 用 `HF_HUB_OFFLINE=1` 完全离线运行
2. **Mock 隔离处理正确**: mock-dependent 测试独立进程运行，避免 `vi.doMock` 泄漏
3. **Stable CI gate**: `ci` aggregate job 保持固定名称，适配 branch protection ruleset
4. **WebGPU CI 设置复杂但完善**: Vulkan SDK + SwiftShader/Lavapipe 软件光栅化处理得当

### 2.3 覆盖率门禁评估

vitest.config.mjs 中阈值**已定义但被注释掉**:
```js
// TODO: set thresholds after establishing baseline
// thresholds: { lines: 70, branches: 60, functions: 65, statements: 70 },
```

- **70% lines** — 合理，但考虑到 8 个模块零测试，当前可能不达标
- **60% branches** — 偏低，建议逐步提升至 70%
- **65% functions** — 合理
- 建议：先取消注释启用门禁，获取 baseline 数据后再调整

### 2.4 发布流程风险

| 风险点 | 严重程度 | 说明 |
|--------|---------|------|
| npm → MCP Registry 时序竞态 | LOW | 已通过 2 分钟轮询缓解，但 `workflow_dispatch` 无同样保护 |
| 缺预发布验证 | **HIGH** | tag push 直接发布，无 staging/canary 步骤 |
| 双通道独立发布 | MEDIUM | npm 失败不影响 MCP Registry，可能导致版本不一致 |
| 无回滚机制 | MEDIUM | npm 72h unpublish 窗口后无法回滚 |
| server.json 版本同步 | LOW | 已修复但无 CI 验证（可用 diff check） |

---

## 3. 错误处理与可观测性

### 3.1 错误分类体系

错误处理架构设计良好：

```
AppError (abstract base)
├── layer: 'embedder' | 'parser' | 'vectordb' | 'config' | 'pdf-visual'
├── kind: 'validation' | 'io' | 'config' | 'internal'
└── cause: Error | undefined (链式传播)
     ↓
toMcpError(error, context)
├── McpError → 透传
├── AppError → validation/config → InvalidParams, 其余 → InternalError
└── native Error → InternalError + context.prefix
```

**优点**:
- `formatErrorForClient` vs `formatErrorForLog` 清晰分离，客户端永不泄露 stack trace
- `getCauseChain` 防御自引用循环
- `TOOL_ERROR_CONTEXT` 表统一管理 per-tool 消息策略

**风险**:
- 如果 `AppError` 子类的 `layer`/`kind` 枚举扩展，需要确保 `toMcpError` 的 switch 覆盖所有新值
- `toMcpError` 中 `error.kind === 'validation' || error.kind === 'config'` 是硬编码的白名单，新增 kind 默认为 InternalError

### 3.2 错误信息质量

| 方面 | 评分 | 说明 |
|------|------|------|
| 用户可操作性 | ★★★★☆ | AppError 消息具体（如 `DatabaseError`），但某些原生错误消息不够友好 |
| 日志完整性 | ★★★★☆ | `logError` 输出完整 cause chain + stack |
| MCP 客户端感知 | ★★★★☆ | McpError 携带正确 ErrorCode，annotations 有 audience/priority |
| 错误恢复 | ★★★☆☆ | 摄入有 rollback，但 compute/visual 模块的错误传播未充分测试 |

### 3.3 日志级别

| 级别 | 使用场景 | 评价 |
|------|---------|------|
| `console.error` | 所有错误日志 | 缺少 warn/info/debug 分层 |
| `console.warn` | doc.destroy() 失败 | 使用正确但场景有限 |

**建议**: 引入结构化日志级别（warn for non-fatal, info for status, debug for trace）

---

## 4. 回归风险

### 4.1 发版节奏分析

```
v0.18.7 → v0.18.8 → v0.18.9 → v0.19.0 → v0.19.2 → v0.19.3 → v0.19.4 → v0.19.5 → v0.20.0
  7/12      7/12      7/12      7/21      7/21      7/22      7/22      7/22      7/22
```

从 0.19.2 到 0.20.0 的 7 天内密集发布了 **6 个版本**，这是**高风险模式**:
- 每次发布间隔数小时到 1 天
- 大量"修 CI"类发布（0.19.4、0.19.5）
- 集成测试在多个版本中失败

### 4.2 核心功能测试状态

| 功能 | 测试状态 | 风险 |
|------|---------|------|
| 多实例 (v0.19.0) | multi-root-integration **全部 6 个测试失败** | **HIGH** |
| AST 分块 (v0.18.7) | code-chunker 35 测试通过 ✅ | LOW |
| 模型切换 | dtype 测试通过（mock 隔离）| LOW |
| 文件删除 | delete.integration **失败** | **HIGH** |
| 摄入回滚 | ingest-rollback **失败** | **HIGH** |
| 搜索 FTS | search.integration **失败** | **HIGH** |
| 协议集成 | protocol.integration **失败** | MEDIUM |
| Dispatcher 映射 | dispatcher-mapping **全部失败** | **HIGH** |
| 安全 | security.test **失败** | **HIGH** |

### 4.3 集成测试失败根因分析

```
失败分类（排除 SAFE_DELETE）:
- 路径/scope 相关: multi-root, list-scope (基础设施问题)
- 数据库状态残留: delete, rollback (测试隔离不足)
- 真实功能回归: search, protocol, dispatcher (需逐一排查)
```

---

## 5. 性能测试

### 5.1 现状

| 类型 | 数量 | 详情 |
|------|------|------|
| P95 延迟测试 | 1 | `read_chunk_neighbors` P95 < 100ms on 10k chunks |
| Benchmark suite | 0 | 完全缺失 |
| 大仓库摄入测试 | 0 | 无 10 万+ 文件摄入性能数据 |
| 内存压力测试 | 0 | 无大文件/多文件并发内存监控 |
| 搜索性能基准 | 0 | 无向量搜索延迟基准 |

### 5.2 风险

- 宣传为 "code intelligence for AI coding assistants"，但无实际大代码库性能数据
- `@huggingface/transformers` 模型加载时间是冷启动瓶颈，未量化
- 无 `RAG_DTYPE` (fp32/fp16/q8) 的性能对比基准

---

## 6. 测试执行实际结果

### 6.1 本次测试结果

```
Test Files:  32 failed | 46 passed (78 total)
Tests:       136 failed | 1065 passed | 13 skipped (1214 total)
```

### 6.2 失败分类

| 类别 | 数量 | 说明 |
|------|------|------|
| SAFE_DELETE sandbox | 83 | WorkBuddy sandbox 限制大量文件删除，非代码问题 |
| **真实失败** | **53** | 需修复的 bug/env 问题 |

### 6.3 真实失败分布

| 模块 | 失败数 | 代表性问题 |
|------|--------|-----------|
| read-neighbors integration | 10 | 全部 11 个测试失败 |
| multi-root integration | 6 | 全部测试失败 |
| dispatcher-mapping | 3 | 全部测试失败 |
| files integration | 5 | AC-006/007/008 |
| delete integration | 1 | 删除功能 |
| search integration | 2 | 向量搜索 |
| protocol integration | 2 | MCP 协议 |
| security | 1 | 安全测试 |
| e2e (rag-workflow, html-workflow) | 2 | 端到端流程 |
| 其他 | 21 | CLI, server 等 |

---

## 7. 建议优先级

### Critical (立即修复)
1. **修复 53 个真实测试失败** — 特别是 multi-root、delete、dispatcher、read-neighbors
2. **为 `ingest/compute.ts` 添加单元测试** — 摄入管道的计算核心
3. **为 `ingest/visual.ts` 添加单元测试** — 视觉 PDF 管道

### High (本版本)
4. 启用覆盖率门禁（取消注释 thresholds）
5. 添加 `cli/file-collection.ts` 单元测试
6. 添加 `utils/gitignore.ts` 单元测试
7. 添加 CI `pnpm audit` 安全扫描步骤
8. 添加性能基准测试框架（至少摄入 + 搜索的基准）

### Medium (下版本)
9. 添加 `pdf-visual/captioners/fast.ts` 和 `shared.ts` 单元测试
10. 为 `server.json` 版本同步添加 CI 验证
11. 添加并发摄入测试
12. 添加预发布 smoke test（类似 package-smoke 但针对功能）
13. 引入结构化日志级别（warn/info/debug）

### Low (backlog)
14. 添加 `utils/limits.ts` 常量一致性测试
15. 添加 `bin/install-skills.ts` 测试
16. 添加大仓库（10 万+文件）摄入性能基准

---

## Ship Readiness

| Metric | Value |
|--------|-------|
| Health score | **62/100** |
| Issues found | 16 categorized |
| Test pass rate (excl. sandbox) | ~95.3% (53 failures out of 1131) |
| CI completeness | 6/10 gates present |
| Regression risk | HIGH (6 releases in 7 days) |

**Verdict: NOT SHIP-READY.** 53 个真实测试失败 + 8 个模块零测试 + 零性能基准。建议在修复 Critical 和 High 优先级问题后再发布 v0.20.1。
