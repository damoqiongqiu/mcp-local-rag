# Changelog

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
