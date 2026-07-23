# Changelog

## [0.21.0] — 2026-07-23

### Added

- **searchMode 预设参数** — `query_documents` 新增 `searchMode` 枚举 (`exact`/`code`/`doc`)，一行参数切换搜索策略，无需手动调 `hybridWeight`
- **LRU 查询缓存** — 相同搜索词缓存结果，任意写入操作（ingest/delete/reindex/config）自动失效
- **handler 直测** — `handleDeleteFile` 6 用例 + `handleDedupCheck` 7 用例，dep 注入模式验证 handler 独立逻辑
- **类型对齐** — `handlers/ingest.ts` 消除 3 处 `args: any`，改为精确类型

### Changed

- **Server 巨石拆分** — `server/index.ts` 从 2147 → 611 行 (-71.5%)，17 个 handler 提取为 8 个独立模块
- **孤儿注释清理** — 移除 17 块遗留 JSDoc (-133 行)

### Fixed

- **安全修复 (P0)** — 配置 dump 脱敏 proxy URL、find_definition/find_references 运行时参数校验、undici→7.28.0 / fast-uri→4.1.1
- **管理工具校验 (P1)** — config/dedup_check/export_index 添加运行时参数校验
- **reindex_all 崩溃** — `this.`→`deps.` 替换丢失参数导致 `ingestFileCore` 调用缺 deps 第一参数

### Tests

- 新增 13 个 handler 直测 + 开源测试补充 124 例
- 全量测试 1,144/1,328 通过，回归稳定
- 实战验证：voox-saas 1,816 文档全量重索引 99.8% 成功率，14/14 API 通过

## [0.19.5] — 2026-07-22

### Fixed

- **CI macOS WebGPU** — 从 webgpu-main-path 矩阵移除 macOS（无 Vulkan 支持）
- **coverage-v8 版本匹配** — `@vitest/coverage-v8` 降级至 4.1.9 与 `vitest` 4.1.9 对齐

## [0.19.4] — 2026-07-22

### Added

- **CodeChunker 单元测试** — 35 个测试覆盖 TS/JS/Python 分块、AST entity 提取、import 元数据、scope chain、空文件边界、isCodeChunkExtension 工具函数

### CI/CD

- **覆盖率门禁** — `vitest --coverage` (v8 provider)，初始阈值 70% lines / 60% branches / 65% functions
- **macOS runner** — static-checks 和 test job 矩阵新增 `macos-latest`
- **coverage job** — CI 流水线新增覆盖率专用 job，作为 `ci` 门禁的一环

## [0.19.3] — 2026-07-22

### Security

- **TOCTOU 竞态条件修复** — `validateFilePath` 现在返回已解析的 realpath，所有内部 `readFile` 调用使用验证后的路径，消除路径验证与文件读取之间的符号链接交换窗口
- **`export_index` 路径约束** — 自定义 `outputPath` 参数现在必须位于 `dbPath` 目录内，阻止任意文件写入
- **`ingest_data` 大小限制** — 新增 `MAX_INGEST_DATA_SIZE` (100MB) 防止通过超大内联内容耗尽内存
- **代理 URL 凭证脱敏** — 日志中的代理 URL 现在仅记录 `protocol://host`，密码/用户名不再暴露

### Fixed

- **`server.json` 版本同步** — 修复长期存在的 `server.json` (0.18.9) 与 `package.json` (0.19.2) 版本不一致问题，现已同步至 0.19.3

### CI/CD

- **新增 `publish-npm.yml`** — `v*` tag push 时自动将包发布到 npm
- **修复 `publish-mcp-registry.yml`**：
  - `workflow_dispatch` 手动触发时版本号从 `package.json` 读取（修复 `refs/heads/main` 写入 server.json 的 bug）
  - 新增 npm 版本就绪轮询（最多等待 2 分钟），解决 npm publish 与 MCP Registry publish 的时序竞态
  - `checkout` action 使用固定 SHA（供应链安全）

## [0.19.2] — 2026-07-21

### Fixed

- **Parser 根目录路径校验** — `validateFilePath` 用 `isUnderOrEqual` 替换 `startsWith`，修复传入 baseDir 本身时报 "outside all configured roots" 的边界 bug

## [0.19.0] — 2026-07-21

### Added

- **多实例架构** — `RAG_INSTANCES` 配置支持独立 LanceDB 实例，每个 `{name, baseDir, dbPath}` 对形成完全隔离的项目存储空间
- **`--instance` CLI flag** — 所有 6 个子命令支持 `--instance <name>` 精确选择目标实例
- **MCP 工具 `instance` 参数** — `query_documents`、`list_files`、`status` 新增 `instance` 参数
- **`src/instances/` 模块** — InstanceRouter 路由层，支持 per-instance 搜索合并、文件归属路由、异常隔离
- **向后兼容** — `BASE_DIR` + `DB_PATH` 单实例模式完全保留

## [0.18.9] — 2026-07-12

### Docs

- **README 重构** — 11 个编号章节，工具分 5 类表格，中英分离
- **新增「性能调优」章节** — `RAG_DTYPE`（fp32/fp16/q8）、`RAG_DEVICE`（cpu/webgpu）、`CHUNK_MIN_LENGTH` 的完整文档，覆盖配置方法、验证手段、失败处理、推荐组合

## [0.18.8] — 2026-07-12

### Docs

- **README.md / README_CN.md 全面更新** — 工具数 7 → 15，新增 6 个章节：
  - AST 代码智能 (`find_definition`、`find_references`)
  - 批量摄入 (`ingest_directory`)
  - 运行时配置 (`config` 工具)
  - 系统管理工具 (`dedup_check`、`export_index`、`reindex_all`、`reindex_stale`)
  - 镜像自动检测 (huggingface.co → hf-mirror.com → modelscope.cn 三级链)
  - 文件监听 (`RAG_WATCH`)
  - 模型选择 (6 模型表 + 别名解析 + `RAG_DTYPE`)
- **server.json**: 新增 `HF_ENDPOINT`、`HF_AUTO_MIRROR` 环境变量，描述更新提及 AST code intelligence

### Fixed

- **CI: Windows PowerShell `--exclude` 解析错误** — 多行 `\` 续行在 Windows 下被 PowerShell 解释为一元运算符 `--` 语法错误。改为单行命令，Windows 测试通过
- **测试 mock 隔离修复 (6 → 0 失败)** — vitest `isolate: false` 导致的三类问题：
  - `connectivity.js` mock 在 5 个测试文件中泄漏
  - 4 个测试文件的 symlink `EEXIST` 残留
  - `files.integration` AC-007 的 LanceDB 状态残留（改用 `mkdtempSync`）
- **CI workflow 重构**: mock 依赖测试先行独立进程运行，主力测试组用 `HF_HUB_OFFLINE=1` 跑缓存模型

### Changed

- **CI 全绿**: Ubuntu + Windows 双平台，9 jobs 全部通过

## [0.18.7] — 2026-07-12

### Added

- **`find_definition` MCP 工具** — AST 级符号定义查找。基于 `CodeChunker` 摄入时提取的 AST 元数据（entities/scope），精确匹配符号名并返回定义位置（文件路径、行范围、作用域链）
- **`find_references` MCP 工具** — 两阶段引用查找：(1) import 元数据扫描 — 查找 `codeMeta.imports` 中精确匹配符号的 chunk；(2) FTS 全文搜索 — 在所有文档中搜索符号文本提及，支持文件路径过滤
- **`CodeChunkMetaRow` / `TextReferenceRow` 类型** — `getCodeChunksWithMeta()` 和 `findTextReferences()` 的返回值类型
- **`codeMeta` 端到端管道** — 从 `CodeChunker` 提取 → `VectorChunk` 序列化 → LanceDB JSON 列 → `SearchResult` 反序列化，完整保留 AST 上下文（imports、entities、scope）
- **LanceDB schema 自动迁移** — 启动时检测并自动添加 `codeMeta` 列，兼容旧版本数据库
- **`VectorStore` 新增查询方法**：
  - `getCodeChunksWithMeta()` — 读取所有携带 AST 元数据的代码 chunk（排除语义分块）
  - `findTextReferences(queryText, limit, filePathFilter?)` — 基于 ngram FTS 索引的全文符号搜索

### Fixed

- **`toSearchResult()` 丢失 `codeMeta`** — 搜索结果的 `codeMeta` 字段始终为 `undefined`。LanceDB 将 codeMeta 存储为 JSON 字符串，但 `toSearchResult()` 未调用 `parseCodeMeta()` 进行反序列化。修复后搜索结果正确包含 AST 元数据，`codeMeta` 断言不再失败
- **`toVectorChunk()` 丢失 `codeMeta`** — 同上，读取 chunk 时也需要反序列化 codeMeta JSON

### Changed

- **`CodeChunker` 生成 `codeMeta`** — 分块时从 tree-sitter AST 提取 imports、entities（定义类型 + 行范围）、scope 链，写入 `TextChunk.codeMeta`。仅当至少一个子字段非空时才附加（非代码 chunk 保持 null）
- **`VectorChunk` / `SearchResult` / `ChunkRow` 新增 `codeMeta?: CodeMeta` 可选字段**
- **`VectorStore.insert()` 序列化 codeMeta** — 写入 LanceDB 前将 `CodeMeta` 对象序列化为 JSON 字符串（兼容 Arrow 字符串列类型，空值写 `''`）

## [0.18.6] — 2026-07-11

### Docs

- setup SKILL.md: 重写「国内网络注意事项」章节，代理优先 + 三级镜像链说明
- README.md: 修正过时描述，`HTTPS_PROXY` 说明升级到 v0.18.5，hf-mirror 描述修正为三级回退

## [0.18.5] — 2026-07-11

### Fixed

- **fallback 路径中 `env.fetch` 被置为 `undefined`** — 非 ModelScope 的 fallback mirror 时 `env.fetch` 被重置为 undefined，导致 `pipeline()` 报 `env.fetch is not a function`。修复：fallback 时恢复为全局 `fetch`（已被 `setGlobalDispatcher` 代理化）
- **`remotePathTemplate` 中多余的 `{file}` 占位符** — `@huggingface/transformers` v3 默认模板不包含 `{file}`，MIRROR_CHAIN 写了 `{model}/resolve/{revision}/{file}` 导致 URL 中出现字面量 `{file}`。修复：全局替换为 `{model}/resolve/{revision}/`

### Changed

- 代理实现从 `env.fetch` wrapper 重构为 `setGlobalDispatcher(new ProxyAgent(...))` — Node.js 22 内置 undici 不读取 `HTTPS_PROXY` 环境变量，此方式确保所有 `fetch()` 调用（包括 Transformers.js 内部的）都走代理

## [0.18.4] — 2026-07-11

### Added

- **ModelScope.cn 第三级镜像回退** — 镜像链从 2 级扩展为 3 级：`huggingface.co → hf-mirror.com → modelscope.cn`
- `MirrorConfig` 类型化配置重构：`{ url, pathTemplate, urlStyle }` 替代之前的字符串数组
  - `hf-hub` 风格: 通过 `/api/models/` JSON probe 检测 API 完整性
  - `modelscope` 风格: 直接文件存在性探测，使用不同的 URL 结构（`api/v1/models`）
- `ResolvedEndpoint.remotePathTemplate` 字段，支持不同镜像的不同路径模板
- ModelScope URL fixup：自动去除 `FilePath=` 参数中的前导 `/`

### Changed

- Embedder `initialize()` 完整重写，支持三级镜像链自动回退

## [0.18.3] — 2026-07-11

### Added

- **镜像 API 完整性探测** (`probeApiEndpoint`) — 检测镜像是否支持完整的 Hub API（`/api/models/`）。hf-mirror.com 仅 CDN 缓存文件下载，不支持 API，导致 Transformers.js 无法列出模型文件
- `ResolvedEndpoint.apiComplete` 布尔字段
- `hubApiBroken` 标记，防止对 API 不完整的镜像做无效重试
- 指向性诊断消息，引导用户设置 `HF_ENDPOINT` 或 `HTTPS_PROXY`

### Tests

- 5 new test cases for `probeApiEndpoint`，connectivity 测试从 11 增至 16 个

## [0.18.2] — 2026-07-11

### Added

- **自动镜像检测与回退链** — 首次下载模型前自动探测 `huggingface.co` 连通性（3 秒超时），不可达时自动切换到 `hf-mirror.com`
- `MIRROR_CHAIN` 配置数组 + `probeEndpoint()` 探测函数
- `resolveEndpoint()` 自动选择最佳镜像
- `HF_AUTO_MIRROR` 环境变量（默认 `true`），设为 `false` 禁用自动检测
- `HF_ENDPOINT` 显式覆盖跳过自动检测
- 下载失败后的镜像重试机制

### Design

三层回退：probe → auto-switch → retry，90% 用户零配置

## [0.18.1] — 2026-07-11

### Added

- **模型注册表** (`src/embedder/model-registry.ts`)：已知模型白名单 + 别名解析 + 动态 size hint
- CLI `--model` 别名扩展（如 `minilm` → `Xenova/all-MiniLM-L6-v2`）
- `.dart` 文件解析支持（`TEXT_CODE_EXTENSIONS` 增至 56 种）
- `ConfigResult` / `StatusResponse` 增加 `modelSizeMb` 和 `modelDimension` 字段
- README: WorkBuddy connector JSON 配置示例 + ⚠️ 信任按钮提醒（中英双语）

## [0.18.0] — 2026-07-11

### Added (11 enhancements)

- **`.gitignore` 自动遵循** — `list_files` 和 `ingest_directory` 扫描时向上遍历并应用 `.gitignore` 规则
- **`reindex_all`** — 一键重索引所有已入库文件
- **搜索高亮** — `buildMatchContexts()` 返回每个 chunk 的匹配片段
- **`status` 增强** — 单文件 chunk 统计、stale 文件列表、完整配置 dump
- **`ingest_directory` 进度通知** — 原生 MCP progressToken 进度推送
- **`--watch` / `RAG_WATCH`** — 文件系统监控，500ms 防抖自动重索引
- **`config` 工具** — 运行时读写配置，即时生效
- **`dedup_check`** — SHA256 哈希 + Jaccard 相似度检测
- **时间范围过滤** — `buildTimePredicate` WHERE 条件过滤
- **`export_index`** — 全量索引导出 JSON
- **多模型热切换** — 通过 `config.modelName` 触发 dispose + 重新 init Embedder

## [0.17.1] — 2026-07-11

### Fixed

- `list_files` and CLI `list`/`ingest` scans now skip common build/dependency directories across languages:
  **JS/TS**: `node_modules`, `.next`, `.nuxt`, `.output`, `.turbo`, `.parcel-cache`, `.svelte-kit`, `bower_components`, `dist`, `build`
  **Python**: `__pycache__`, `.venv`, `venv`
  **Java/Kotlin**: `.gradle`, `target`
  **PHP**: `vendor`
  **Ruby**: `.bundle`
  **Rust**: `target` (shared with Java)
  **Go**: `vendor` (shared with PHP)
  **General**: `.git`, `.cache`, `coverage`, `.nyc_output`, `.terraform`, `.serverless`
- Previously these were traversed and listed (but not indexed), causing massive output (e.g. 54k `node_modules` entries → 290k-line / 13MB responses). The exclusion list is defined once in `src/utils/limits.ts` as `SKIP_DIR_NAMES` and shared across both scan paths (`list-scanner.ts` and `scan.ts`).

## [0.17.0] — 2026-07-11

### Added

- `ingest_directory` MCP tool: batch ingest all supported files in a directory with extension filtering
- `reindex_stale` MCP tool: re-ingest files whose disk mtime is newer than their ingestion timestamp
- `list_files` stale detection: ingested files with newer disk mtime are flagged with `stale: true`
- `ingestFileCore` internal helper: parse→chunk→embed→insert pipeline without per-file backup/optimize

## [0.16.4] — 2026-07-11

### Docs

- README: add `HTTPS_PROXY` / `HTTP_PROXY` / `HF_ENDPOINT` to configuration table
- README: expand `CACHE_DIR` description with directory structure and path advice
- README: add step-by-step model download troubleshooting (proxy → path → mirror → npx cache)
- README: add "Rebuilding the Index" guide with CLI batch ingestion example

## [0.16.3] — 2026-07-11

### Added

- Proxy-aware fetch via `undici.ProxyAgent` for `HTTPS_PROXY` / `HTTP_PROXY`
- Custom fetch injected into `@huggingface/transformers` `env.fetch`

## [0.16.2] — 2026-07-11

### Added

- `HF_ENDPOINT` env var support for custom HuggingFace mirrors
- `remoteHost` config in Embedder

### Fixed

- Embedding model download blocked behind proxy (partial fix; completed in 0.16.3)
