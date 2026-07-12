<p align="center">
  <img src="assets/banner.jpg" alt="MCP Local RAG — Search below the surface." width="600" />
</p>

# MCP Local RAG

[![GitHub stars](https://img.shields.io/github/stars/damoqiongqiu/mcp-local-rag?style=social)](https://github.com/damoqiongqiu/mcp-local-rag)
[![npm version](https://img.shields.io/npm/v/@damoqiongqiu/mcp-local-rag.svg)](https://www.npmjs.com/package/@damoqiongqiu/mcp-local-rag)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-green.svg)](https://registry.modelcontextprotocol.io/)

> 🍴 Forked from [shinpr/mcp-local-rag](https://github.com/shinpr/mcp-local-rag) — original work by [Shinsuke Kagawa](https://github.com/shinpr)
>
> Local code intelligence engine for AI coding assistants. AST-level semantic chunking + keyword boost for pinpointing functions, classes, and APIs — fully private, zero setup. Let your AI truly understand your codebase.
>
> AI 编程助手的本地代码智能引擎。AST 级语义分块 + 关键词加权，精准命中函数、类、API——完全私密，零配置。

📖 [中文](README_CN.md)

---

## Table of Contents / 目录

1. [Features / 特性](#1-features--特性)
2. [Quick Start / 快速开始](#2-quick-start--快速开始)
   - 2.1 [Configure Your AI Coding Tool / 配置 AI 编程工具](#21-configure-your-ai-coding-tool--配置-ai-编程工具)
   - 2.2 [CLI Quick Start / CLI 快速上手](#22-cli-quick-start--cli-快速上手)
   - 2.3 [First-Time Project Indexing / 首次索引项目](#23-first-time-project-indexing--首次索引项目)
3. [Core Concepts / 核心概念](#3-core-concepts--核心概念)
   - 3.1 [Dual-Strategy Chunking / 双策略分块](#31-dual-strategy-chunking--双策略分块)
   - 3.2 [Hybrid Search / 混合搜索](#32-hybrid-search--混合搜索)
   - 3.3 [Security Boundary / 安全边界](#33-security-boundary--安全边界)
4. [MCP Tool Reference / MCP 工具参考](#4-mcp-tool-reference--mcp-工具参考)
   - 4.1 [Ingest Tools / 摄入工具](#41-ingest-tools--摄入工具)
   - 4.2 [Search Tools / 搜索工具](#42-search-tools--搜索工具)
   - 4.3 [Management Tools / 管理工具](#43-management-tools--管理工具)
   - 4.4 [Code Intelligence / 代码智能](#44-code-intelligence--代码智能)
   - 4.5 [System Tools / 系统工具](#45-system-tools--系统工具)
5. [CLI / CLI 命令行](#5-cli--cli-命令行)
   - 5.1 [Basic Commands / 基础命令](#51-basic-commands--基础命令)
   - 5.2 [CLI Configuration / CLI 配置](#52-cli-configuration--cli-配置)
6. [Network & Models / 网络与模型](#6-network--models--网络与模型)
   - 6.1 [Mirror Auto-Detection / 镜像自动检测](#61-mirror-auto-detection--镜像自动检测)
   - 6.2 [Model Selection / 模型选择](#62-model-selection--模型选择)
   - 6.3 [File Watching / 文件监听](#63-file-watching--文件监听)
7. [Search Tuning / 搜索调优](#7-search-tuning--搜索调优)
8. [Configuration Reference / 配置参考](#8-configuration-reference--配置参考)
9. [Troubleshooting / 故障排查](#9-troubleshooting--故障排查)
10. [Development / 开发](#10-development--开发)

---

## 1. Features / 特性

- **Smart dual-strategy chunking / 智能双策略分块** — AST-level code chunking via tree-sitter (splits at function/class/method boundaries, injects scope chain + imports). Semantic chunking for documents (splits by meaning, not character count).
- **Semantic search + keyword boost / 语义搜索 + 关键词加权** — Vector search first, then keyword matching boosts exact terms. `useEffect`, error codes, class names rank higher — not just semantically guessed.
- **15 MCP tools** — Ingest, search, manage, code intelligence, and system ops in one server.
- **AST code intelligence / AST 代码智能** — `find_definition` and `find_references` for IDE-level code navigation.
- **Three-tier mirror auto-fallback / 三级镜像自动回退** — `huggingface.co → hf-mirror.com → modelscope.cn`, zero config for China.
- **Runs entirely locally / 完全本地运行** — No API keys, no cloud, no data leaving your machine.
- **Zero-friction setup / 零摩擦上手** — One `npx` command. No Docker, Python, or servers to manage.

---

## 2. Quick Start / 快速开始

Set `BASE_DIR` to the folder you want to search (`BASE_DIRS` for multiple roots — see [Configuration](#8-configuration-reference--配置参考)).

### 2.1 Configure Your AI Coding Tool / 配置 AI 编程工具

**Cursor** — `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "local-rag": {
      "command": "npx",
      "args": ["-y", "@damoqiongqiu/mcp-local-rag"],
      "env": { "BASE_DIR": "/path/to/your/project" }
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add local-rag --scope user --env BASE_DIR=/path/to/your/project -- npx -y @damoqiongqiu/mcp-local-rag
```

**Codex** — `~/.codex/config.toml`:

```toml
[mcp_servers.local-rag]
command = "npx"
args = ["-y", "@damoqiongqiu/mcp-local-rag"]

[mcp_servers.local-rag.env]
BASE_DIR = "/path/to/your/project"
```

**WorkBuddy** — Settings → Custom Connectors → Add:

```json
{
  "mcpServers": {
    "local-rag": {
      "command": "npx",
      "args": ["-y", "@damoqiongqiu/mcp-local-rag"],
      "env": { "BASE_DIR": "/path/to/your/project" }
    }
  }
}
```

> ⚠️ WorkBuddy: you MUST click "Trust" in the Custom Connectors list, otherwise the server is silently blocked.
> 必须在「自定义连接器」列表中点击「信任」。

### 2.2 CLI Quick Start / CLI 快速上手

No MCP needed — run directly:

```bash
npx @damoqiongqiu/mcp-local-rag ingest ./src/
npx @damoqiongqiu/mcp-local-rag query "auth middleware"
npx @damoqiongqiu/mcp-local-rag status
```

That's it. No Docker, Python, or server setup.

### 2.3 First-Time Project Indexing / 首次索引项目

```
You: "Index the src directory of this project"
Assistant: Successfully ingested 156 files (2,847 chunks created)

You: "Where's the middleware that handles API rate limiting?"
Assistant: src/middleware/rateLimiter.ts — useRateLimiter(), lines 42-89

You: "How is the database connection pool configured?"
Assistant: src/config/database.ts — createPool() default max: 20, idle: 5
```

---

## 3. Core Concepts / 核心概念

### 3.1 Dual-Strategy Chunking / 双策略分块

Chunking strategy is chosen per file type:

- **Code files** (50+ languages) — `CodeChunker` parses source via tree-sitter AST, splits at structural boundaries (functions, classes, methods). Each chunk's `contextualizedText` includes the scope chain and import context for accurate semantic search.
- **Documents** (PDF/DOCX/TXT/MD/HTML) — `SemanticChunker` splits into sentences, groups by embedding similarity. Finds natural topic boundaries — related content stays together. Markdown code blocks remain intact.

### 3.2 Hybrid Search / 混合搜索

Search = semantic similarity + keyword boost (`RAG_HYBRID_WEIGHT`, default 0.6):

1. Query vectorization → semantic search finds most relevant chunks
2. Quality filters apply (distance threshold, grouping)
3. Keyword matching boosts exact-term rankings

Exact identifiers like `useEffect` are never buried by semantic approximations.

### 3.3 Security Boundary / 安全边界

Only files under `BASE_DIR` / `BASE_DIRS` are accessible for ingest, list, delete, or read-neighbor operations. Symlinks resolved outside roots are rejected. Sibling-prefix paths (e.g., `/foo/barista` when root is `/foo/bar`) are also blocked — prevents path traversal attacks.

---

## 4. MCP Tool Reference / MCP 工具参考

15 tools in 5 categories.

### 4.1 Ingest Tools / 摄入工具

| # | Tool | Purpose | Example |
|---|------|---------|---------|
| 1 | `ingest_file` | Single file (PDF/DOCX/TXT/MD/code) | `"Ingest ./docs/api-spec.pdf"` |
| 2 | `ingest_data` | In-memory text/HTML | `"Fetch this page and ingest the HTML"` |
| 3 | `ingest_directory` | Bulk directory ingest | `"Ingest everything under ./src"` |

**`ingest_file`** supports 50+ code languages. PDFs support optional visual mode — a local VLM generates captions for figure pages:

| Profile | Model | Cache | Suited for |
|---------|------|------|------------|
| `fast` (default) | SmolVLM-256M | ~250 MB | Light visual indexing |
| `quality` | Qwen2.5-VL-3B-ONNX | ~2.9 GB | Figures with in-image text |

```bash
# CLI
npx @damoqiongqiu/mcp-local-rag ingest ./spec.pdf --visual --visual-quality quality
# MCP
"Ingest ./spec.pdf with visual: true, visualQuality: 'quality'"
```

**`ingest_data`** runs Readability → Markdown → index. Perfect for web content fetched by your AI assistant.

**`ingest_directory`** scans recursively, respects `.gitignore`, shows real-time progress. Re-ingesting replaces old versions.

### 4.2 Search Tools / 搜索工具

| # | Tool | Purpose | Key Parameters |
|---|------|---------|----------------|
| 4 | `query_documents` | Hybrid search (semantic + keyword) | `query`, `limit`, `scope`, `highlightContext`, `fromTimestamp` |
| 5 | `read_chunk_neighbors` | Expand context around results | `filePath`, `chunkIndex`, `before`, `after` |

**`query_documents`** — `scope` accepts a single path prefix or list, restricting results to that subtree. `highlightContext` returns snippets around matched terms.

**`read_chunk_neighbors`** — defaults to 2 chunks before/after (like `grep -C 2`), max 50 each.

### 4.3 Management Tools / 管理工具

| # | Tool | Purpose |
|---|------|---------|
| 6 | `list_files` | List files with ingestion status (`ingested: true/false`) |
| 7 | `delete_file` | Delete by file path or source URL |
| 8 | `status` | Index stats: docs, chunks, memory, search mode |

`list_files` also supports `scope` filtering — same semantics as search, plus large-dir acceleration.

### 4.4 Code Intelligence / 代码智能

| # | Tool | Purpose | Input |
|---|------|---------|-------|
| 9 | `find_definition` | Locate symbol definition | Exact symbol name |
| 10 | `find_references` | Find all references (import + text) | Symbol name |

Both depend on AST metadata (imports, entities, scope) extracted by tree-sitter at ingest time. **Only works for code files ingested with `CodeChunker`** — files ingested before v0.18.7 lack AST metadata and require `reindex_all` to rebuild.

**`find_references`** uses two-phase strategy: (1) exact match in `codeMeta.imports` → (2) FTS full-text search by symbol name. Results deduplicated by (filePath, chunkIndex), with import references prioritized.

### 4.5 System Tools / 系统工具

| # | Tool | Purpose |
|---|------|---------|
| 11 | `config` | Runtime hot read/write config (no restart) |
| 12 | `dedup_check` | SHA256 + Jaccard duplicate detection |
| 13 | `export_index` | Export entire index as JSON (backup/migration) |
| 14 | `reindex_all` | Full re-chunk + re-embed (after model switch) |
| 15 | `reindex_stale` | Re-ingest only modified files (incremental sync) |

**`config`** hot-swaps `hybridWeight`, `modelName`, `cacheDir`, etc. Model hot-swap auto-disposes the old Embedder and loads the new one (note: changing models requires `reindex_all`).

**`dedup_check`** is especially useful in monorepos — spot ↔ futures mirror code is typically flagged.

---

## 5. CLI / CLI 命令行

### 5.1 Basic Commands / 基础命令

```bash
# Ingest
npx @damoqiongqiu/mcp-local-rag ingest ./src/

# Search (with scope)
npx @damoqiongqiu/mcp-local-rag query "auth middleware"
npx @damoqiongqiu/mcp-local-rag query "auth" --scope /docs/api

# Context expansion
npx @damoqiongqiu/mcp-local-rag read-neighbors --file-path /abs/path.md --chunk-index 5

# Management
npx @damoqiongqiu/mcp-local-rag list --scope /docs/api
npx @damoqiongqiu/mcp-local-rag status
npx @damoqiongqiu/mcp-local-rag delete ./docs/old.pdf
npx @damoqiongqiu/mcp-local-rag delete --source "https://..."
```

`query`, `read-neighbors`, `list`, `status`, `delete` emit JSON to stdout (pipe to `jq`). `ingest` emits progress to stderr.

Global options go before the subcommand:

```bash
npx @damoqiongqiu/mcp-local-rag --help
```

> ⚠️ The CLI does NOT read your MCP client config (`mcp.json`, etc.). Configure via flags or env vars.

### 5.2 CLI Configuration / CLI 配置

**Flags** — global options before, subcommand options after:

```bash
npx @damoqiongqiu/mcp-local-rag --db-path ./my-db query "auth" --base-dir ./docs
```

`--base-dir` is repeatable on `ingest` and `list`:

```bash
npx @damoqiongqiu/mcp-local-rag ingest --base-dir ./docs --base-dir ./specs ./docs/readme.md
```

**Environment variables**:

```bash
export DB_PATH=./my-db
export BASE_DIR=./docs
npx @damoqiongqiu/mcp-local-rag query "auth"
```

For multiple roots, use `BASE_DIRS` (JSON array):

```bash
export BASE_DIRS='["/Users/me/work","/Users/me/specs"]'
```

Precedence: CLI flags > env vars > defaults.

---

## 6. Network & Models / 网络与模型

### 6.1 Mirror Auto-Detection / 镜像自动检测

huggingface.co is blocked in mainland China. Built-in three-tier mirror chain with automatic fallback:

```
huggingface.co → hf-mirror.com → modelscope.cn
```

At startup, each mirror is HEAD-probed (3s timeout) and the first reachable mirror with a complete API is selected:

- **With proxy** (`HTTPS_PROXY`) → direct to huggingface.co
- **No proxy** → auto-switch to hf-mirror.com
- **hf-mirror API unavailable** → fallback to modelscope.cn

**No manual `HF_ENDPOINT` required.** If you do need manual control:

| Env Var | Effect |
|---------|--------|
| `HF_AUTO_MIRROR=false` | Disable auto-detection, use huggingface.co only |
| `HF_ENDPOINT=<url>` | Force a specific mirror, skip auto-detection |

> v0.18.5+ uses `setGlobalDispatcher(ProxyAgent)` — all Node.js 22 network requests go through the proxy.

### 6.2 Model Selection / 模型选择

6 embedding models, with alias resolution via model-registry:

| Model | Alias | Size | Dims |
|-------|-------|------|------|
| `Xenova/all-MiniLM-L6-v2` (default) | `mini` | ~90 MB | 384 |
| `Xenova/all-MiniLM-L12-v2` | — | ~120 MB | 384 |
| `Xenova/bge-small-en-v1.5` | `bge-small` | ~130 MB | 384 |
| `Xenova/all-mpnet-base-v2` | `mpnet` | ~420 MB | 768 |
| `Xenova/bge-base-en-v1.5` | — | ~420 MB | 768 |
| `Xenova/multi-qa-mpnet-base-dot-v1` | `multi-qa` | ~420 MB | 768 |

**Guidance**: code repos → default model + high keyword boost; multilingual → consider `embeddinggemma-300m`.

**RAG_DTYPE** controls ONNX precision (`fp32` / `fp16` / `q8`). Default `fp32`; use `q8` when memory-constrained. ⚠️ Changing models or dtype requires deleting `DB_PATH` and re-indexing.

### 6.3 File Watching / 文件监听

Set `RAG_WATCH=true` — the server starts recursive `fs.watch` on baseDirs (500ms debounce):

- File creation/modification → auto `ingest_file`
- File deletion → auto `delete_file`

Ideal for actively changing projects.

---

## 7. Search Tuning / 搜索调优

| Variable | Default | Description |
|----------|---------|-------------|
| `RAG_HYBRID_WEIGHT` | `0.6` | Keyword boost: 0 = semantic only, 1 = keyword only |
| `RAG_GROUPING` | unset | `similar` = top group, `related` = top 2 groups |
| `RAG_MAX_DISTANCE` | unset | Filter low-relevance (e.g., `0.5`) |
| `RAG_MAX_FILES` | unset | Limit to top N files |

**Code-focused tuning (recommended):**

```json
{ "RAG_HYBRID_WEIGHT": "0.7", "RAG_GROUPING": "similar" }
```

**Document-focused tuning:**

```json
{ "RAG_HYBRID_WEIGHT": "0.4", "RAG_GROUPING": "related" }
```

Keyword boost is applied *after* semantic filtering — improves precision without noise.

---

## 8. Configuration Reference / 配置参考

MCP server: env vars only. CLI: env vars + equivalent flags (flags take precedence).

| Env Var | CLI Flag | Default | Description |
|---------|----------|---------|-------------|
| `BASE_DIR` | `--base-dir` (repeatable) | `cwd` | Document root |
| `BASE_DIRS` | — | unset | JSON array of roots, overrides `BASE_DIR` |
| `DB_PATH` | `--db-path` | `./lancedb/` | Vector DB path |
| `CACHE_DIR` | `--cache-dir` | `./models/` | Model cache. Recommend absolute path |
| `MODEL_NAME` | `--model-name` | `all-MiniLM-L6-v2` | Embedding model ID |
| `MAX_FILE_SIZE` | `--max-file-size` | 100MB | Max file size (bytes) |
| `CHUNK_MIN_LENGTH` | `--chunk-min-length` | `50` | Min chunk length (1–10000 chars) |
| `RAG_DEVICE` | — | `cpu` | ONNX execution device |
| `RAG_DTYPE` | — | `fp32` | Quantization (`fp32`/`fp16`/`q8`) |
| `HTTPS_PROXY` | — | unset | Model download proxy. v0.18.5+ global |
| `HF_ENDPOINT` | — | `huggingface.co` | Manual mirror override |
| `HF_AUTO_MIRROR` | — | `true` | Auto-detection toggle |
| `RAG_WATCH` | — | unset | File watching (`true`/`1`) |

**Root resolution order**: CLI `--base-dir` > `BASE_DIRS` > `BASE_DIR` > `cwd`. `BASE_DIRS` and `BASE_DIR` are never merged — `BASE_DIRS` wins. Only JSON array syntax supported — no delimiters.

---

## 9. Troubleshooting / 故障排查

<details open>
<summary><strong>Model download failed / 模型下载失败</strong></summary>

Symptoms: `fetch failed`, `status` shows `searchMode: fts` instead of `hybrid`.

1. **Network restriction** (mainland China, etc.) — use proxy first:
   ```json
   "env": { "HTTPS_PROXY": "http://127.0.0.1:7890" }
   ```
   Set this in your MCP client config, not in the terminal. v0.18.5+ globally effective via `setGlobalDispatcher`.

2. **Auto-mirror fallback** (v0.18.2+, default) — three-tier probe, usually works without config.

3. **Manual override** — `HF_ENDPOINT=https://modelscope.cn` or [download models manually](https://huggingface.co/Xenova/all-MiniLM-L6-v2) into `CACHE_DIR`.

4. **npx cached old version** — clear and restart:
   ```bash
   rm -rf ~/.npm/_npx/
   ```

</details>

<details>
<summary><strong>MCP client doesn't see tools / 客户端看不到工具</strong></summary>

1. Verify config file syntax
2. WorkBuddy users: confirm "Trust" button clicked
3. Restart client completely (Cmd+Q on Mac)
4. Test directly: `npx @damoqiongqiu/mcp-local-rag` should run without errors

</details>

<details>
<summary><strong>Rebuilding the index / 重建索引</strong></summary>

After switching models or when DB is corrupted:

1. Stop the MCP service
2. Delete `DB_PATH` directory (default `./lancedb/`) — safe, doesn't affect source files
3. Restart MCP → fresh DB auto-created
4. Bulk re-ingest:
   ```bash
   npx @damoqiongqiu/mcp-local-rag ingest ./src/
   ```

</details>

<details>
<summary><strong>FAQ / 常见问题</strong></summary>

- **Private? / 私密吗？** Yes. After model download, nothing leaves your machine.
- **Offline? / 离线可用？** Yes, once models are cached.
- **Formats? / 支持格式？** 50+ code languages + PDF/DOCX/TXT/MD/HTML. No Excel, PPT, or images.
- **GPU?** Opt-in via `RAG_DEVICE`.
- **Backup? / 如何备份？** Copy `DB_PATH` directory.

</details>

---

## 10. Development / 开发

```bash
git clone https://github.com/damoqiongqiu/mcp-local-rag.git
cd mcp-local-rag
pnpm install
```

```bash
pnpm test              # All tests
pnpm run type-check    # TypeScript check
pnpm run check:fix     # Lint + format
pnpm run check:all     # Full CI pipeline
```

```text
src/
  index.ts      # Entry point
  server/       # MCP tool handlers
  cli/          # CLI subcommands
  parser/       # PDF/DOCX/TXT/MD/code parsing
  chunker/      # SemanticChunker + CodeChunker
  embedder/     # Transformers.js embeddings
  vectordb/     # LanceDB operations
  utils/        # Shared utilities (security, scan, scope)
  __tests__/    # Test suites
```

---

## License / 许可证

MIT License. Free for personal and commercial use.

## Acknowledgments / 致谢

Built with [Model Context Protocol](https://modelcontextprotocol.io/) (Anthropic), [LanceDB](https://lancedb.com/), and [Transformers.js](https://huggingface.co/docs/transformers.js).
