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
> Local code intelligence engine for AI coding assistants. AST-level semantic chunking + keyword boost for pinpointing functions, classes, and APIs — fully private, zero setup.

📖 [中文文档](README_CN.md)

---

## Table of Contents

1. [Features](#1-features)
2. [Quick Start](#2-quick-start)
   - 2.1 [Configure Your AI Coding Tool](#21-configure-your-ai-coding-tool)
   - 2.2 [CLI Quick Start](#22-cli-quick-start)
   - 2.3 [First-Time Project Indexing](#23-first-time-project-indexing)
3. [Core Concepts](#3-core-concepts)
   - 3.1 [Dual-Strategy Chunking](#31-dual-strategy-chunking)
   - 3.2 [Hybrid Search](#32-hybrid-search)
   - 3.3 [Security Boundary](#33-security-boundary)
4. [MCP Tool Reference](#4-mcp-tool-reference)
   - 4.1 [Ingest Tools](#41-ingest-tools)
   - 4.2 [Search Tools](#42-search-tools)
   - 4.3 [Management Tools](#43-management-tools)
   - 4.4 [Code Intelligence](#44-code-intelligence)
   - 4.5 [System Tools](#45-system-tools)
5. [CLI](#5-cli)
   - 5.1 [Basic Commands](#51-basic-commands)
   - 5.2 [CLI Configuration](#52-cli-configuration)
6. [Network & Models](#6-network--models)
   - 6.1 [Mirror Auto-Detection](#61-mirror-auto-detection)
   - 6.2 [Model Selection](#62-model-selection)
   - 6.3 [File Watching](#63-file-watching)
7. [Search Tuning](#7-search-tuning)
8. [Configuration Reference](#8-configuration-reference)
9. [Troubleshooting](#9-troubleshooting)
10. [Development](#10-development)

---

## 1. Features

- **Smart dual-strategy chunking** — AST-level code chunking via tree-sitter (splits at function/class/method boundaries, injects scope chain + imports). Semantic chunking for documents (splits by meaning, not character count).
- **Semantic search + keyword boost** — Vector search first, then keyword matching boosts exact terms. `useEffect`, error codes, class names rank higher — not just semantically guessed.
- **15 MCP tools** — Ingest, search, manage, code intelligence, and system ops in one server.
- **AST code intelligence** — `find_definition` and `find_references` for IDE-level code navigation, powered by tree-sitter metadata captured at ingest time.
- **Three-tier mirror auto-fallback** — `huggingface.co → hf-mirror.com → modelscope.cn`, zero config for users in mainland China.
- **Runs entirely locally** — No API keys, no cloud, no data leaving your machine. Works offline after the first model download.
- **Zero-friction setup** — One `npx` command. No Docker, Python, or servers to manage.

---

## 2. Quick Start

Set `BASE_DIR` to the folder you want to search (`BASE_DIRS` for multiple roots — see [Configuration](#8-configuration-reference)).

### 2.1 Configure Your AI Coding Tool

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

> ⚠️ WorkBuddy: you MUST click "Trust" in the Custom Connectors list after adding, otherwise the server is silently blocked.

### 2.2 CLI Quick Start

No MCP needed — run directly from the terminal:

```bash
npx @damoqiongqiu/mcp-local-rag ingest ./src/
npx @damoqiongqiu/mcp-local-rag query "auth middleware"
npx @damoqiongqiu/mcp-local-rag status
```

That's it. No Docker, Python, or server setup.

### 2.3 First-Time Project Indexing

```
You: "Index the src directory of this project"
Assistant: Successfully ingested 156 files (2,847 chunks created)

You: "Where's the middleware that handles API rate limiting?"
Assistant: src/middleware/rateLimiter.ts — useRateLimiter(), lines 42–89

You: "How is the database connection pool configured?"
Assistant: src/config/database.ts — createPool() default max: 20, idle: 5
```

---

## 3. Core Concepts

### 3.1 Dual-Strategy Chunking

Chunking strategy is chosen per file type:

- **Code files** (50+ languages) — `CodeChunker` parses source via tree-sitter AST, splits at structural boundaries (functions, classes, methods). Each chunk's `contextualizedText` includes its scope chain and import context for precise semantic search.
- **Documents** (PDF/DOCX/TXT/MD/HTML) — `SemanticChunker` splits into sentences, groups by embedding similarity to find natural topic boundaries. Markdown code blocks remain intact — never split mid-block.

### 3.2 Hybrid Search

Search = semantic similarity + keyword boost (`RAG_HYBRID_WEIGHT`, default 0.6):

1. Query vectorization → semantic search finds most relevant chunks
2. Quality filters apply (distance threshold, grouping)
3. Keyword matching boosts exact-term rankings

Exact identifiers like `useEffect` are never buried by semantic approximations.

### 3.3 Security Boundary

Only files under `BASE_DIR` / `BASE_DIRS` are accessible for ingest, list, delete, or read-neighbor operations. Symlinks resolved outside roots are rejected. Sibling-prefix paths (e.g., `/foo/barista` when root is `/foo/bar`) are also blocked — prevents path traversal attacks.

---

## 4. MCP Tool Reference

15 tools organized into 5 categories.

### 4.1 Ingest Tools

| # | Tool | Purpose | Example |
|---|------|---------|---------|
| 1 | `ingest_file` | Single file (PDF/DOCX/TXT/MD/code) | `"Ingest ./docs/api-spec.pdf"` |
| 2 | `ingest_data` | In-memory text/HTML | `"Fetch this page and ingest the HTML"` |
| 3 | `ingest_directory` | Bulk directory ingest | `"Ingest everything under ./src"` |

**`ingest_file`** supports 50+ code languages. PDFs support an optional visual mode — a local VLM generates captions for figure pages, making visual content searchable. Two profiles available:

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

**`ingest_data`** runs Readability → Markdown → index. Perfect for web content fetched by your AI assistant. Re-ingesting replaces old versions automatically.

**`ingest_directory`** scans recursively, respects `.gitignore`, shows real-time progress via MCP notifications.

### 4.2 Search Tools

| # | Tool | Purpose | Key Parameters |
|---|------|---------|----------------|
| 4 | `query_documents` | Hybrid search (semantic + keyword) | `query`, `limit`, `scope`, `highlightContext`, `fromTimestamp` |
| 5 | `read_chunk_neighbors` | Expand context around results | `filePath`, `chunkIndex`, `before`, `after` |

**`query_documents`** — `scope` accepts a single path prefix or list, restricting results to that subtree. `highlightContext` returns snippets around matched terms. `fromTimestamp` / `untilTimestamp` enable time-range filtering.

**`read_chunk_neighbors`** — defaults to 2 chunks before and after (like `grep -C 2`), max 50 each. Response includes the target chunk marked `isTarget: true`.

### 4.3 Management Tools

| # | Tool | Purpose |
|---|------|---------|
| 6 | `list_files` | List files with ingestion status (`ingested: true/false`) |
| 7 | `delete_file` | Delete by file path or source URL |
| 8 | `status` | Index stats: docs, chunks, memory, search mode |

`list_files` supports `scope` filtering with the same prefix-match semantics as search. In large directories, scope accelerates the scan by skipping out-of-scope subtrees.

### 4.4 Code Intelligence

| # | Tool | Purpose | Input |
|---|------|---------|-------|
| 9 | `find_definition` | Locate symbol definition (file, line range, scope) | Exact symbol name |
| 10 | `find_references` | Find all references (import + text mention) | Symbol name |

Both tools depend on AST metadata (imports, entities, scope chains) extracted by tree-sitter at ingest time. **Only works for code files ingested with `CodeChunker`** — files ingested before v0.18.7 lack this metadata and require `reindex_all` to rebuild.

**`find_references`** uses a two-phase strategy: (1) exact match in `codeMeta.imports` → (2) FTS full-text search for the symbol name. Results are deduplicated by (filePath, chunkIndex), with import references listed first.

### 4.5 System Tools

| # | Tool | Purpose |
|---|------|---------|
| 11 | `config` | Runtime hot read/write config — no restart needed |
| 12 | `dedup_check` | SHA256 + Jaccard similarity to detect duplicate files |
| 13 | `export_index` | Export entire index as JSON (backup or migration) |
| 14 | `reindex_all` | Full re-chunk + re-embed (after model change) |
| 15 | `reindex_stale` | Re-ingest only files modified on disk (incremental sync) |

**`config`** hot-swaps `hybridWeight`, `modelName`, `cacheDir`, `baseDir`/`baseDirs`, etc. Switching models auto-disposes the old Embedder and initializes the new one — note: changing models alters the embedding space and requires `reindex_all`.

**`dedup_check`** is especially useful in monorepos — `spot` ↔ `futures` mirror code is typically flagged with similarity 1.0.

---

## 5. CLI

### 5.1 Basic Commands

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

Global options (`--db-path`, `--cache-dir`, `--model-name`) go before the subcommand:

```bash
npx @damoqiongqiu/mcp-local-rag --help
```

> ⚠️ The CLI does NOT read your MCP client config (`mcp.json`, etc.). Configure via flags or environment variables.

### 5.2 CLI Configuration

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

Precedence: CLI flags > environment variables > defaults.

---

## 6. Network & Models

### 6.1 Mirror Auto-Detection

huggingface.co is inaccessible from mainland China. Built-in three-tier mirror chain with automatic fallback:

```
huggingface.co → hf-mirror.com → modelscope.cn
```

At startup, each mirror is HEAD-probed (3s timeout). The first reachable mirror with a complete API is selected:

- **With proxy** (`HTTPS_PROXY`) → direct to huggingface.co
- **No proxy** → auto-switch to hf-mirror.com
- **hf-mirror API unavailable** → fallback to modelscope.cn

**No manual `HF_ENDPOINT` required.** For manual control:

| Env Var | Effect |
|---------|--------|
| `HF_AUTO_MIRROR=false` | Disable auto-detection, use huggingface.co only |
| `HF_ENDPOINT=<url>` | Force a specific mirror, skip auto-detection |

> v0.18.5+ uses `setGlobalDispatcher(ProxyAgent)` — all Node.js 22 network requests go through the proxy.

### 6.2 Model Selection

6 embedding models with alias resolution via model-registry:

| Model | Alias | Size | Dims |
|-------|-------|------|------|
| `Xenova/all-MiniLM-L6-v2` (default) | `mini` | ~90 MB | 384 |
| `Xenova/all-MiniLM-L12-v2` | — | ~120 MB | 384 |
| `Xenova/bge-small-en-v1.5` | `bge-small` | ~130 MB | 384 |
| `Xenova/all-mpnet-base-v2` | `mpnet` | ~420 MB | 768 |
| `Xenova/bge-base-en-v1.5` | — | ~420 MB | 768 |
| `Xenova/multi-qa-mpnet-base-dot-v1` | `multi-qa` | ~420 MB | 768 |

**Guidance**: code repos → default model + high keyword boost; multilingual → consider `embeddinggemma-300m`; scientific papers → consider `allenai-specter`.

**RAG_DTYPE** controls ONNX precision (`fp32` / `fp16` / `q8`). Default `fp32`; use `q8` when memory-constrained. ⚠️ Changing models or dtype requires deleting `DB_PATH` and re-indexing.

### 6.3 File Watching

Set `RAG_WATCH=true` — the server starts recursive `fs.watch` on baseDirs (500ms debounce):

- File creation/modification → auto `ingest_file`
- File deletion → auto `delete_file`

Ideal for actively changing projects.

---

## 7. Search Tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `RAG_HYBRID_WEIGHT` | `0.6` | Keyword boost: 0 = semantic only, 1 = keyword only |
| `RAG_GROUPING` | unset | `similar` = top group only, `related` = top 2 groups |
| `RAG_MAX_DISTANCE` | unset | Filter low-relevance results (e.g., `0.5`) |
| `RAG_MAX_FILES` | unset | Limit results to top N files |

**Code-focused tuning (recommended default):**

```json
{ "RAG_HYBRID_WEIGHT": "0.7", "RAG_GROUPING": "similar" }
```

**Document-focused tuning:**

```json
{ "RAG_HYBRID_WEIGHT": "0.4", "RAG_GROUPING": "related" }
```

Keyword boost is applied *after* semantic filtering — improves precision without introducing noise.

---

## 8. Configuration Reference

MCP server: environment variables only (via your MCP client's `env` block).
CLI: environment variables + equivalent flags (flags take precedence).

| Env Var | CLI Flag | Default | Description |
|---------|----------|---------|-------------|
| `BASE_DIR` | `--base-dir` (repeatable) | `cwd` | Document root (security boundary) |
| `BASE_DIRS` | — | unset | JSON array of roots, overrides `BASE_DIR` |
| `DB_PATH` | `--db-path` | `./lancedb/` | Vector database path |
| `CACHE_DIR` | `--cache-dir` | `./models/` | Model cache — recommend absolute path |
| `MODEL_NAME` | `--model-name` | `all-MiniLM-L6-v2` | HuggingFace model ID |
| `MAX_FILE_SIZE` | `--max-file-size` | 100 MB | Max file size in bytes |
| `CHUNK_MIN_LENGTH` | `--chunk-min-length` | `50` | Min chunk length (1–10000 chars) |
| `RAG_DEVICE` | — | `cpu` | ONNX execution device |
| `RAG_DTYPE` | — | `fp32` | Quantization (`fp32`/`fp16`/`q8`) |
| `HTTPS_PROXY` | — | unset | Model download proxy. v0.18.5+ globally effective |
| `HF_ENDPOINT` | — | `huggingface.co` | Manual mirror override |
| `HF_AUTO_MIRROR` | — | `true` | Auto-detection toggle |
| `RAG_WATCH` | — | unset | File watching (`true`/`1`) |

**Root resolution order**: CLI `--base-dir` > `BASE_DIRS` > `BASE_DIR` > `cwd`. `BASE_DIRS` and `BASE_DIR` are never merged. Only JSON array syntax supported for `BASE_DIRS` — delimiter syntax is intentionally rejected.

---

## 9. Troubleshooting

<details open>
<summary><strong>Model download failed</strong></summary>

Symptoms: `fetch failed`, `status` shows `searchMode: fts` instead of `hybrid`.

**Solutions:**

1. **Network restriction** (mainland China, etc.) — use proxy:
   ```json
   "env": { "HTTPS_PROXY": "http://127.0.0.1:7890" }
   ```
   Set in your MCP client config, not the terminal. v0.18.5+ globally effective via `setGlobalDispatcher`.

2. **Auto-mirror fallback** (v0.18.2+, default) — three-tier probe. Usually works without any config.

3. **Manual override** — `HF_ENDPOINT=https://modelscope.cn` or [download models manually](https://huggingface.co/Xenova/all-MiniLM-L6-v2) into `CACHE_DIR`.

4. **npx cached old version** — clear and restart:
   ```bash
   rm -rf ~/.npm/_npx/
   ```

</details>

<details>
<summary><strong>MCP client doesn't see tools</strong></summary>

1. Verify config file syntax
2. WorkBuddy users: confirm "Trust" button clicked
3. Restart client completely (Cmd+Q on macOS)
4. Test directly: `npx @damoqiongqiu/mcp-local-rag` should run without errors

</details>

<details>
<summary><strong>Rebuilding the index</strong></summary>

After switching models or when the database is corrupted:

1. Stop the MCP service
2. Delete `DB_PATH` directory (default `./lancedb/`) — safe, doesn't affect source files
3. Restart MCP → fresh database auto-created
4. Bulk re-ingest:
   ```bash
   npx @damoqiongqiu/mcp-local-rag ingest ./src/
   ```

</details>

<details>
<summary><strong>FAQ</strong></summary>

- **Private?** Yes. After model download, nothing leaves your machine.
- **Offline?** Yes, once models are cached.
- **Supported formats?** 50+ code languages + PDF/DOCX/TXT/MD/HTML. No Excel, PPT, or images.
- **GPU acceleration?** Opt-in via `RAG_DEVICE`. Support depends on your system, Node.js version, and the ONNX backend.
- **Backup?** Copy the `DB_PATH` directory.

</details>

---

## 10. Development

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

## License

MIT License. Free for personal and commercial use.

## Acknowledgments

Built with [Model Context Protocol](https://modelcontextprotocol.io/) (Anthropic), [LanceDB](https://lancedb.com/), and [Transformers.js](https://huggingface.co/docs/transformers.js).
