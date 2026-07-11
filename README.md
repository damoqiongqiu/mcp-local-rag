<p align="center">
  <img src="assets/banner.jpg" alt="MCP Local RAG — 在表层之下搜索。 / Search below the surface." width="600" />
</p>

# MCP Local RAG

[![GitHub stars](https://img.shields.io/github/stars/damoqiongqiu/mcp-local-rag?style=social)](https://github.com/damoqiongqiu/mcp-local-rag)
[![npm version](https://img.shields.io/npm/v/@damoqiongqiu/mcp-local-rag.svg)](https://www.npmjs.com/package/@damoqiongqiu/mcp-local-rag)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-green.svg)](https://registry.modelcontextprotocol.io/)

> 🍴 Forked from [shinpr/mcp-local-rag](https://github.com/shinpr/mcp-local-rag) — original work by [Shinsuke Kagawa](https://github.com/shinpr)
>
> AI 编程助手的本地代码智能引擎。AST 级语义分块 + 关键词加权，精准命中函数、类、API——完全私密，零配置。让你的 AI 真正理解你的代码库。
>
> Local code intelligence engine for AI coding assistants. AST-level semantic chunking + keyword boost for pinpointing functions, classes, and APIs — fully private, zero setup. Let your AI truly understand your codebase.

---

## 特性 / Features

- **智能双策略分块 / Smart dual-strategy chunking**
  代码文件使用 AST 级分块（tree-sitter 在函数/类边界切分，注入作用域链 + import 上下文）。文档使用语义分块（按含义而非字符数切分）。
  AST-level code chunking for source files (splits at function/class boundaries via tree-sitter, injects scope chain and imports into embeddings). Semantic chunking for documents (splits by meaning, not character count).

- **语义搜索 + 关键词加权 / Semantic search with keyword boost**
  先向量搜索，再通过关键词匹配提升精确匹配项的排名。`useEffect`、错误码、类名等术语会被优先召回——而不是仅靠语义猜测。
  Vector search first, then keyword matching boosts exact matches. Terms like `useEffect`, error codes, and class names rank higher—not just semantically guessed.

- **质量优先的结果过滤 / Quality-first result filtering**
  按相关性差距分组，而非任意的 top-K 截断。用更少但更可信的块获得更好的结果。
  Groups results by relevance gaps instead of arbitrary top-K cutoffs. Get fewer but more trustworthy chunks.

- **完全本地运行 / Runs entirely locally**
  无需 API Key，无需云端，数据不离开你的机器。首次模型下载后可完全离线工作。
  No API keys, no cloud, no data leaving your machine. Works fully offline after the first model download.

- **零摩擦上手 / Zero-friction setup**
  一条 `npx` 命令搞定。无需 Docker、无需 Python、无需管理服务器。可通过 MCP 或 CLI 使用。可选的 [Agent Skills](#agent-skills--agent-skills) 帮助 AI 助手更好地构建查询和解读结果。
  One `npx` command. No Docker, no Python, no servers to manage. Use via MCP, CLI, or both. Optional [Agent Skills](#agent-skills--agent-skills) help AI assistants form better queries and interpret results.

---

## 快速开始 / Quick Start

将 `BASE_DIR` 设置为你想要搜索的文件夹（多个根目录请用 `BASE_DIRS`——参见[配置](#配置--configuration)）。文档必须位于配置的根目录之下。

Set `BASE_DIR` to the folder you want to search (or `BASE_DIRS` for multiple roots — see [Configuration](#配置--configuration)). Documents must live under one of the configured roots.

### 配置 AI 编程工具 / Configure Your AI Coding Tool

**Cursor** — 添加到 `~/.cursor/mcp.json` / Add to `~/.cursor/mcp.json`：
```json
{
  "mcpServers": {
    "local-rag": {
      "command": "npx",
      "args": ["-y", "@damoqiongqiu/mcp-local-rag"],
      "env": {
        "BASE_DIR": "/path/to/your/documents"
      }
    }
  }
}
```

**Codex** — 添加到 `~/.codex/config.toml` / Add to `~/.codex/config.toml`：
```toml
[mcp_servers.local-rag]
command = "npx"
args = ["-y", "@damoqiongqiu/mcp-local-rag"]

[mcp_servers.local-rag.env]
BASE_DIR = "/path/to/your/documents"
```

**Claude Code** — 运行以下命令 / Run this command：
```bash
claude mcp add local-rag --scope user --env BASE_DIR=/path/to/your/documents -- npx -y @damoqiongqiu/mcp-local-rag
```

**WorkBuddy** — 打开「设置 → 自定义连接器 → 添加自定义连接器」/ Open Settings → Custom Connectors → Add Custom Connector：

```json
{
  "mcpServers": {
    "local-rag": {
      "command": "npx",
      "args": ["-y", "@damoqiongqiu/mcp-local-rag"],
      "env": {
        "BASE_DIR": "/path/to/your/documents"
      }
    }
  }
}
```

> ⚠️ **首次添加后，必须在「自定义连接器」列表中点击「信任」按钮**，否则 MCP 服务器不会启动。这是 WorkBuddy 的安全机制——未经信任的自定义连接器会被静默阻止。

> ⚠️ **After adding the connector for the first time, you MUST click the "Trust" button in the Custom Connectors list**, otherwise the MCP server won't start. This is WorkBuddy's security mechanism — untrusted custom connectors are silently blocked.

重启工具后即可使用 / Restart your tool, then start using it：

```
你: "索引这个项目"                              / You: "Index this project"
助手: 成功摄入 156 个文件（生成 2,847 个块）       / Assistant: Successfully ingested 156 files (2,847 chunks created)

你: "处理 API 限流的中间件在哪里？"               / You: "Where's the middleware that handles API rate limiting?"
助手: 在 src/middleware/rateLimiter.ts 中。        / Assistant: Found in src/middleware/rateLimiter.ts.
      useRateLimiter() 函数，第 42-89 行...       /           The useRateLimiter() function, lines 42-89...

你: "数据库连接池是怎么配置的？"                  / You: "How is the database connection pool configured?"
助手: 在 src/config/database.ts 里，               / Assistant: In src/config/database.ts,
      createPool() 默认 max: 20, idle: 5...       /           createPool() with default max: 20, idle: 5...
```

**也可直接作为 CLI 使用——无需启动 MCP 服务器 / Or use directly as CLI — no MCP server needed：**

```bash
npx @damoqiongqiu/mcp-local-rag ingest ./src/
npx @damoqiongqiu/mcp-local-rag query "认证中间件"    # or "auth middleware"
```

就这些。无需 Docker，无需 Python，无需配置服务器。
That's it. No Docker, no Python, no server setup.

---

## 为什么会有这个项目 / Why This Exists

你的 AI 编程助手很聪明，但它不了解你的代码库。它不知道你的 middleware 怎么写的、数据库 schema 长什么样、错误处理用什么模式——除非你每次都复制粘贴大量上下文给它。

Your AI coding assistant is smart, but it doesn't know your codebase. It doesn't know how your middleware works, what your database schema looks like, or which error-handling patterns you use—unless you copy-paste massive context every time.

**代码库理解 / Codebase understanding。** 索引你的项目后，AI 可以直接搜索函数定义、类实现、API 用法、配置模式——就像 Sourcegraph 的本地替代，但和你的 AI 工具深度集成。
Index your project and your AI can directly search for function definitions, class implementations, API usage, config patterns—like a local Sourcegraph, deeply integrated with your AI coding tool.

**隐私 / Privacy。** 代码可能包含敏感逻辑或密钥。这个工具完全在本地运行——没有人能看到你的代码。
Your code may contain sensitive logic or keys. This runs entirely locally—nobody sees your code.

**精确匹配 / Exact matching。** 纯语义搜索会遗漏 `useEffect` 或 `ERR_CONNECTION_REFUSED` 这样的精确术语。我们先用 tree-sitter 做 AST 级分块保证代码结构完整，再用关键词加权捕捉精确匹配。
Pure semantic search misses exact terms like `useEffect` or `ERR_CONNECTION_REFUSED`. We use tree-sitter for AST-level chunking to preserve code structure, then keyword boost to catch exact matches.

**离线可用 / Offline。** 配置完成之后无需联网即可使用。
Works without internet after setup.

---

## 使用方式 / Usage

mcp-local-rag 提供两种接口：**MCP 服务器**（供 AI 编程工具使用）和 **CLI**（供终端直接使用）。
mcp-local-rag provides two interfaces: an **MCP server** for AI coding tools and a **CLI** for direct use from the terminal.

### 通过 MCP 使用 / Using with MCP

MCP 服务器提供 7 个工具：`ingest_file`、`ingest_data`、`query_documents`、`read_chunk_neighbors`、`list_files`、`delete_file`、`status`。
The MCP server provides 7 tools: `ingest_file`, `ingest_data`, `query_documents`, `read_chunk_neighbors`, `list_files`, `delete_file`, `status`.

#### 摄入文档 / Ingesting Documents

```
"摄入 /Users/me/docs/api-spec.pdf 这个文档"     / "Ingest the document at /Users/me/docs/api-spec.pdf"
```

支持 50+ 种代码文件格式（TypeScript、JavaScript、Python、Go、Rust、Java、C/C++ 等），以及 PDF、DOCX、TXT、Markdown、HTML。服务器提取文本、切分成块（文档用语义分块，代码用 AST 分块）、在本地生成嵌入向量，并将所有内容存储到本地向量数据库中。

Supports 50+ code file types (TypeScript, JavaScript, Python, Go, Rust, Java, C/C++, and more), plus PDF, DOCX, TXT, Markdown, and HTML. The server extracts text, splits it into chunks (semantic for documents, AST-based for code), generates embeddings locally, and stores everything in a local vector database.

重复摄入同一文件会自动替换旧版本。
Re-ingesting the same file replaces the old version automatically.

##### 摄入含图表的 PDF（视觉模式） / Ingesting PDFs with figures (visual mode)

含有图表、表格或示意图的 PDF 可以选择在文档索引中添加由本地 VLM 生成的描述文字，使视觉内容在同一个向量 + 全文检索的管道中获得可搜索的文本表示。描述文字是辅助性文本——不是图片搜索，不是 OCR，也不是对图片内容的真实转录。

PDFs with charts, tables, or diagrams can optionally add local VLM-generated captions to the document index, giving visual content some searchable representation in the same vector + FTS pipeline. Captions are auxiliary text — not image search, not OCR, and not a faithful transcription of the figure.

**通过 MCP 使用 / Via MCP**：
```
"用 visual: true 摄入 /Users/me/docs/api-spec.pdf"    / "Ingest /Users/me/docs/api-spec.pdf with visual: true"
```

**通过 CLI 使用 / Via CLI**：
```bash
npx @damoqiongqiu/mcp-local-rag ingest ./docs/spec.pdf --visual
```

每条描述文字会以独立块的形式输出，格式为 `[Visual content on page N: …]`，与页面正文块一起存放。它流经现有的嵌入器和 FTS 索引——没有模式差异，也没有单独的索引。

Each caption is emitted as its own chunk with the envelope `[Visual content on page N: …]`, alongside the page-body chunks. It flows through the existing embedder and FTS index — no schema differences, no separate index.

视觉模式是可选功能；普通摄入不会加载 VLM。每个页面的 VLM 失败会被容忍——该页面仅以纯文本形式继续处理。
Visual mode is opt-in; normal ingest does not load the VLM. Per-page VLM failures are tolerated — that page proceeds with text only.

###### 选择视觉质量配置 / Choosing a visual-quality profile

视觉模式提供两种配置，每次摄入时选择：
Visual mode offers two profiles, selected per ingest call:

| 配置 / Profile | 模型 / Model | 磁盘缓存 / Disk (cache) | 单页推理耗时 / Per-page inference | 适用场景 / Suited for |
|---|---|---|---|---|
| `fast`（默认/default） | `HuggingFaceTB/SmolVLM-256M-Instruct` | ~250 MB | 基准 / baseline | 轻量视觉索引，快速首次运行 / Light visual indexing, quick first-run setup. |
| `quality` | `onnx-community/Qwen2.5-VL-3B-Instruct-ONNX` | ~2.9 GB | ~2× `fast` | 图片内含文本（坐标轴标签、面板子标签、注释）的场景 / Figures with in-image text where caption fidelity matters more. |

以上数据是在开发阶段使用项目测试 PDF 在 CPU 上测得的；可能随模型更新或因你的硬件而异。
The numbers above are measured on CPU during development on the project's probe PDFs; they may shift with model updates or differ on your hardware.

**通过 MCP 使用 / Via MCP** — `ingest_file` 接受可选的 `visualQuality` 参数（枚举：`'fast' | 'quality'`，默认 `'fast'`；`visual` 为 false 时忽略）：
```
"用 visual: true 和 visualQuality: 'quality' 摄入 /Users/me/docs/research-paper.pdf"
"Ingest /Users/me/docs/research-paper.pdf with visual: true and visualQuality: 'quality'"
```

**通过 CLI 使用 / Via CLI** — `--visual-quality fast|quality`（默认 `fast`；无 `--visual` 时静默忽略）：
```bash
npx @damoqiongqiu/mcp-local-rag ingest ./docs/research-paper.pdf --visual --visual-quality quality
```

配置的模型标识符和量化变体会随版本固定。两种配置共用同一个 `CACHE_DIR`（默认 `./models/`）；首次运行每个配置时会下载对应模型。
Profile model identifiers and quantization variants are fixed per release. Both profiles share the same `CACHE_DIR` (default: `./models/`); the first run on each profile downloads its model.

> **v0.14.0 行为变更 / Behavior change**：描述文字现在以专用块的形式输出，而非追加到页面文本后再分块。作为附带影响，视觉摄入时 `metadata.fileSize` 不再包含描述文字的字符数——它仅衡量提取后的正文长度。底层的 PDF 文件不变；只有视觉摄入 PDF 时报告的 `fileSize` 在跨越版本边界时可能缩小。
> Captions are now emitted as dedicated chunks rather than appended to the page text before chunking. As a side effect, `metadata.fileSize` for visual ingests no longer includes the caption character count — it measures the post-extraction body length only.

> **安全提示 / Security note**：视觉描述文字源自 PDF 内容，可能继承攻击者控制的文本。下游 LLM 消费者应将检索到的块视为不可信数据，而非指令。`[Visual content on page N: …]` 的包裹格式有助于消费者区分描述文字和正文。
> Visual captions are derived from PDF contents and may inherit attacker-controlled text. Downstream LLM consumers should treat retrieved chunks as untrusted data, not as instructions.

#### 摄入 HTML 内容 / Ingesting HTML Content

使用 `ingest_data` 摄入由你的 AI 助手获取的 HTML 内容（通过网页抓取、curl、浏览器工具等）：
Use `ingest_data` to ingest HTML content retrieved by your AI assistant (via web fetch, curl, browser tools, etc.):

```
"获取 https://example.com/docs 并将 HTML 摄入"    / "Fetch https://example.com/docs and ingest the HTML"
```

服务器使用 Readability 提取主要内容（移除导航、广告等），转换为 Markdown，然后索引。非常适合：
The server extracts main content using Readability (removes navigation, ads, etc.), converts to Markdown, and indexes it. Perfect for:
- Web 文档 / Web documentation
- AI 助手获取的 HTML / HTML retrieved by the AI assistant
- 剪贴板内容 / Clipboard content

HTML 会被自动清理——你得到的是文章内容，不是页面模板。
HTML is automatically cleaned—you get the article content, not the boilerplate.

> **注意 / Note：** RAG 服务器本身不会抓取网页内容——你的 AI 助手获取内容后将 HTML 传给 `ingest_data`。这既保持了服务器的完全本地化，又允许你索引助手能访问的任何内容。请尊重网站的服务条款和版权。
> The RAG server itself doesn't fetch web content—your AI assistant retrieves it and passes the HTML to `ingest_data`. This keeps the server fully local while letting you index any content your assistant can access. Please respect website terms of service and copyright.

#### 搜索代码 / Searching Code

```
"处理 overfetch 的 middleware 在哪里定义的？"      / "Where is the middleware that handles overfetch defined?"
"数据库连接池的配置参数有哪些？"                   / "What are the database connection pool config parameters?"
"找一下所有调用 createUser 的地方"                / "Find all places that call createUser"
```

搜索使用语义相似度和关键词加权。这意味着搜索 `useEffect` 会找到包含该精确术语的代码，而不仅仅是语义相似的 React 概念。CodeChunker 将 scope chain 和 import 注入 embedding，让你搜索「这个组件用了哪些外部函数」也能精准命中。

Search uses semantic similarity with keyword boost. This means `useEffect` finds code containing that exact term, not just semantically similar React concepts. The CodeChunker injects scope chains and imports into embeddings, so queries like "what external functions does this component use" hit precisely.

搜索结果包含文本内容、来源文件、文档标题和相关性分数。文档标题为每个块提供上下文，帮助识别结果属于哪个文档。可通过 `limit`（1-20，默认 10）调整结果数量。

Results include text content, source file, document title, and relevance score. The document title provides context for each chunk, helping identify which document a result belongs to. Adjust result count with `limit` (1-20, default 10).

用 `scope` 缩小搜索范围到语料库的一部分——可以是一个路径前缀或前缀列表。结果限制为块的文件路径等于该前缀或在其之下的块（精确匹配或后代匹配）。例如 `"/docs/api"` 匹配 `/docs/api` 和 `/docs/api/auth.md`，但不匹配 `/docs/apiv2`；文件前缀如 `"/docs/readme.md"` 仅匹配该文件。前缀使用服务器操作系统的路径格式。

Narrow a search to part of your corpus with `scope` — one path prefix or a list of them. Results are restricted to chunks whose file path equals a prefix or sits under it (exact-or-descendant). For example, `"/docs/api"` matches `/docs/api` and `/docs/api/auth.md` but not `/docs/apiv2`; a file prefix like `"/docs/readme.md"` matches just that file.

#### 扩展结果的上下文 / Expanding Context Around a Result

当搜索结果需要更多上下文时，使用 `read_chunk_neighbors` 读取该结果前后的块：
When a search result needs more surrounding context, use `read_chunk_neighbors` to read the chunks before and after it:

```
"那个关于认证的结果看起来相关——读取周围的块获取完整解释"
"That result about authentication looks relevant — read the surrounding chunks for the full explanation"
```

传入搜索结果中的 `filePath` 和 `chunkIndex`。响应包含目标块（标记为 `isTarget: true`）及其相邻块，按 chunk index 排序。默认前后各 2 个块（各自最大可调至 50）。

Pass the `filePath` and `chunkIndex` from the search result. The response includes the target chunk (marked `isTarget: true`) plus its neighbors, sorted by chunk index. Defaults to 2 chunks before and 2 after (adjustable up to 50 each).

#### 管理文件 / Managing Files

```
"列出配置的基础目录中所有文件及其摄入状态"             / "List all files in configured base directories and their ingested status"
"从 RAG 中删除 old-spec.pdf"                        / "Delete old-spec.pdf from RAG"
"显示 RAG 服务器状态"                                / "Show RAG server status"
```

用 `scope` 缩小 `list_files` 的列表范围——可以是一个路径前缀或前缀列表。结果限制为文件的路径等于或在前缀之下的文件（精确匹配或后代匹配）；例如 `"/docs/api"` 匹配 `/docs/api` 和 `/docs/api/auth.md`，但不匹配 `/docs/apiv2`。来自 `ingest_data` 的原始数据源会无视 scope 始终列出。在大数据量下，scope 还能通过跳过扫描时不在范围内的目录来加速列表。

Narrow the listing with `scope` on `list_files` — one path prefix or a list of them. Results are restricted to files reachable at a path equal to or under a prefix (exact-or-descendant); for example, `"/docs/api"` matches `/docs/api` and `/docs/api/auth.md` but not `/docs/apiv2`. Raw-data sources (from `ingest_data`) stay listed regardless of scope.

### 作为 CLI 使用 / Using as CLI

所有 MCP 工具也可以通过 CLI 命令使用——无需启动 MCP 服务器：
All MCP tools are also available as CLI commands — no MCP server needed:

```bash
npx @damoqiongqiu/mcp-local-rag ingest ./docs/               # 批量摄入文件 / Bulk ingest files
npx @damoqiongqiu/mcp-local-rag query "认证 API"              # 搜索文档 / Search documents
npx @damoqiongqiu/mcp-local-rag query "auth" --scope /docs/api --scope /docs/guide  # 限制到路径前缀 / Restrict to path prefixes
npx @damoqiongqiu/mcp-local-rag read-neighbors --file-path /abs/path.md --chunk-index 5  # 扩展上下文 / Expand context
npx @damoqiongqiu/mcp-local-rag list                          # 显示摄入状态 / Show ingestion status
npx @damoqiongqiu/mcp-local-rag list --scope /docs/api --scope /docs/guide  # 限制列表到路径前缀 / Restrict listing
npx @damoqiongqiu/mcp-local-rag status                        # 数据库统计 / Database stats
npx @damoqiongqiu/mcp-local-rag delete ./docs/old.pdf         # 删除内容 / Remove content
npx @damoqiongqiu/mcp-local-rag delete --source "https://..."  # 按来源 URL 删除 / Remove by source URL
```

`query`、`read-neighbors`、`list`、`status` 和 `delete` 输出 JSON 到 stdout（可用于管道，如 `| jq`）。`ingest` 输出进度到 stderr。全局选项（`--db-path`、`--cache-dir`、`--model-name`）放在子命令之前。运行 `npx @damoqiongqiu/mcp-local-rag --help` 查看详情。

`query`, `read-neighbors`, `list`, `status`, and `delete` output JSON to stdout for piping (e.g., `| jq`). `ingest` outputs progress to stderr. Global options (`--db-path`, `--cache-dir`, `--model-name`) go before the subcommand. Run `npx @damoqiongqiu/mcp-local-rag --help` for details.

> ⚠️ CLI **不会**读取你的 MCP 客户端配置（`mcp.json`、`config.toml` 等）。通过命令行标志或环境变量配置 CLI，如下所示。
> The CLI does **not** read your MCP client config (`mcp.json`, `config.toml`, etc.). Configure the CLI via flags or environment variables as shown below.

#### 配置 / Configuration

**CLI 标志 / CLI flags** — 全局选项放在子命令之前，子命令选项放在子命令之后 / global options go before the subcommand, subcommand options go after：

```bash
npx @damoqiongqiu/mcp-local-rag --db-path ./my-db query "auth" --base-dir ./docs
```

`--base-dir` 标志在 `ingest` 和 `list` 上可重复使用；每个根目录传一次 / The `--base-dir` flag is repeatable on `ingest` and `list`; pass it once per root：

```bash
npx @damoqiongqiu/mcp-local-rag ingest --base-dir ./docs --base-dir ./specs ./docs/readme.md
npx @damoqiongqiu/mcp-local-rag list --base-dir ./docs --base-dir ./specs
```

**环境变量 / Environment variables** — 在你的 shell 中设置 / set in your shell：

```bash
export DB_PATH=./my-db
export BASE_DIR=./docs
npx @damoqiongqiu/mcp-local-rag query "auth"
```

多根目录使用 `BASE_DIRS`（包含非空路径字符串的 JSON 数组）/ For multiple roots, use `BASE_DIRS` (JSON array of non-empty path strings)：

```bash
export BASE_DIRS='["/Users/me/Documents/work","/Users/me/Projects/specs"]'
npx @damoqiongqiu/mcp-local-rag list
```

配置按以下顺序解析 / Configuration is resolved in this order：

1. CLI 标志（最高优先级）/ CLI flags (highest priority)
2. 环境变量 / Environment variables
3. 默认值 / Defaults

完整 CLI 标志、环境变量和默认值列表参见[配置](#配置--configuration) / For the full list of CLI flags, environment variables, and defaults, see [Configuration](#配置--configuration).

> ⚠️ **CLI 的 `--model-name` 必须与 MCP 服务器的 `MODEL_NAME` 环境变量匹配。** 使用不同的嵌入模型操作已有数据库会产生不兼容的向量，静默降低搜索质量。
> **CLI `--model-name` must match the MCP server's `MODEL_NAME` env var.** Using a different embedding model against an existing database produces incompatible vectors, silently degrading search quality.

---

## 搜索调优 / Search Tuning

根据你的场景调整以下参数 / Adjust these for your use case：

| 变量 / Variable | 默认值 / Default | 描述 / Description |
|------|--------|------|
| `RAG_HYBRID_WEIGHT` | `0.6` | 关键词加权系数。0 = 仅语义，更高的值 = 更强的关键词权重。 / Keyword boost factor. 0 = semantic only, higher = stronger keyword boost. |
| `RAG_GROUPING` |（未设置/not set）| `similar` 仅返回最相关组，`related` 返回前两个相关组。 / `similar` for top group only, `related` for top 2 groups. |
| `RAG_MAX_DISTANCE` |（未设置/not set）| 过滤低相关度结果（例如 `0.5`）。 / Filter out low-relevance results (e.g., `0.5`). |
| `RAG_MAX_FILES` |（未设置/not set）| 限制结果到前 N 个文件（例如 `1` 仅返回最佳单个文件）。 / Limit results to top N files (e.g., `1` for single best file). |

### 面向代码的调优（默认推荐） / Code-focused tuning (recommended default)

对于代码库，增加关键词权重使精确标识符（`useEffect`、`ERR_*`、类名、函数名）主导排名：
For codebases, increase keyword boost so exact identifiers (`useEffect`, `ERR_*`, class names, function names) dominate ranking:

```json
"env": {
  "BASE_DIR": "/path/to/your/project",
  "RAG_HYBRID_WEIGHT": "0.7",
  "RAG_GROUPING": "similar"
}
```

- `0.7` — 语义 + 关键词平衡 / balanced semantic + keyword
- `1.0` — 激进模式；精确匹配会大幅重新排序结果 / aggressive; exact matches strongly rerank results

### 面向文档的调优 / Document-focused tuning

对于长文本文档（技术规格、论文），降低关键词权重使语义理解为主：
For long-form documents (tech specs, papers), lower keyword boost for better semantic understanding:

```json
"env": {
  "BASE_DIR": "/path/to/your/documents",
  "RAG_HYBRID_WEIGHT": "0.4",
  "RAG_GROUPING": "related"
}
```

关键词加权在语义过滤**之后**应用，因此它能提升精度而不会引入无关匹配。
Keyword boost is applied *after* semantic filtering, so it improves precision without surfacing unrelated matches.

---

## 工作原理 / How It Works

**简要 / TL;DR：**
- 代码文件通过 tree-sitter AST 分块，在函数/类/方法边界切分，注入 scope chain + import 上下文
- 文档按语义相似度分块，而非固定字符数
- 每个块通过 Transformers.js 在本地生成嵌入向量
- 搜索使用语义相似度加上关键词精确匹配的加权
- 结果根据相关性差距过滤，而非原始分数

**Brief / TL;DR:**
- Code files are chunked via tree-sitter AST at function/class/method boundaries, with scope chain + import context
- Documents are chunked by semantic similarity, not fixed character counts
- Each chunk is embedded locally using Transformers.js
- Search uses semantic similarity with keyword boost for exact matches
- Results are filtered based on relevance gaps, not raw scores

### 详细说明 / Details

当你摄入文档时，解析器根据文件类型提取文本（PDF 通过 `mupdf`，DOCX 通过 `mammoth`，代码和文本文件通过 `parseContent`）。
When you ingest a document, the parser extracts text based on file type (PDF via `mupdf`, DOCX via `mammoth`, code and text files via `parseContent`).

分块策略按文件类型自动选择：
The chunker strategy is selected automatically by file type:

- **代码文件 / Code files**：CodeChunker 使用 tree-sitter 将源码解析为 AST，然后在结构边界（函数、类、方法等）处分块。每个块包含 `contextualizedText`——原始代码加上作用域链和 import 上下文——从而对源代码实现更准确的语义搜索。
  The CodeChunker uses tree-sitter to parse source code into an AST, then splits at structural boundaries (functions, classes, methods, etc.). Each chunk includes `contextualizedText`—the original code augmented with its scope chain and import context.

- **文档（PDF/DOCX/TXT/MD/HTML）/ Documents**：语义分块器将文本拆分为句子，然后利用嵌入相似度将其分组。它会在语义转换处寻找自然的话题边界——将相关内容保留在一起，而不是在任意字符限制处切断。Markdown 代码块会保持完整——绝不会在代码块中间拆分。
  The semantic chunker splits text into sentences, then groups them using embedding similarity. It finds natural topic boundaries where the meaning shifts. Markdown code blocks are kept intact—never split mid-block.

每个块经过 Transformers.js 嵌入模型处理（默认 `all-MiniLM-L6-v2`，可通过 `MODEL_NAME` 配置），将文本转换为向量。向量存储在 LanceDB 中，这是一个基于文件的向量数据库，无需服务进程。

Each chunk goes through a Transformers.js embedding model (default: `all-MiniLM-L6-v2`, configurable via `MODEL_NAME`), converting text into vectors. Vectors are stored in LanceDB, a file-based vector database requiring no server process.

当你搜索时 / When you search：
1. 查询使用同样模型转换为向量 / Your query becomes a vector using the same model
2. 语义（向量）搜索找到最相关的块 / Semantic (vector) search finds the most relevant chunks
3. 质量过滤器应用（距离阈值、分组）/ Quality filters apply (distance threshold, grouping)
4. 关键词匹配提升精确术语匹配的排名 / Keyword matches boost rankings for exact term matching

关键词加权确保 `useEffect` 或错误码等精确术语匹配时排名更高。
The keyword boost ensures exact terms like `useEffect` or error codes rank higher when they match.

---

## Agent Skills / Agent Skills

[Agent Skills](https://agentskills.io/) 提供优化的提示词，帮助 AI 助手更有效地使用 RAG 工具。安装 Skills 以获得更好的查询形成、结果解读和摄入工作流：
[Agent Skills](https://agentskills.io/) provide optimized prompts that help AI assistants use RAG tools more effectively:

```bash
# Claude Code（项目级别 / project-level）
npx @damoqiongqiu/mcp-local-rag skills install --claude-code

# Claude Code（用户级别 / user-level）
npx @damoqiongqiu/mcp-local-rag skills install --claude-code --global

# Codex
npx @damoqiongqiu/mcp-local-rag skills install --codex
```

Skills 包括 / Skills include：
- **查询优化 / Query optimization**：更好的搜索查询构建 / Better search query formulation
- **结果解读 / Result interpretation**：分数阈值和过滤指南 / Score thresholds and filtering guidelines
- **HTML 摄入 / HTML ingestion**：格式选择和来源命名 / Format selection and source naming

---

## 配置 / Configuration

### 环境变量和 CLI 标志 / Environment Variables and CLI Flags

MCP 服务器仅通过环境变量配置——通过 MCP 客户端的 `env` 块传入。CLI 接受相同的环境变量加上等效的标志（优先级：CLI 标志 > 环境变量 > 默认值）。

The MCP server is configured by environment variables only — pass them through your MCP client's `env` block. The CLI accepts the same env vars plus equivalent flags (priority: CLI flag > env > default).

| 环境变量 / Env Variable | CLI 标志 / CLI Flag | 默认值 / Default | 描述 / Description |
|---------|----------|--------|------|
| `BASE_DIR` | `--base-dir`（可重复/repeatable）| 当前目录 / current dir | 单个文档根目录（安全边界）。 / Single document root (security boundary). |
| `BASE_DIRS` | — |（未设置/unset）| JSON 数组形式的文档根目录（安全边界）。优先级高于 `BASE_DIR`。 / JSON array of document roots. Takes precedence over `BASE_DIR`. |
| `DB_PATH` | `--db-path` | `./lancedb/` | 向量数据库位置 / Vector database location |
| `CACHE_DIR` | `--cache-dir` | `./models/` | 嵌入模型缓存目录。模型自动下载到 `<CACHE_DIR>/Xenova/<模型名>/`。建议使用绝对路径。 / Embedding model cache. Models auto-download to `<CACHE_DIR>/Xenova/<model>/`. An absolute path is recommended. |
| `MODEL_NAME` | `--model-name` | `Xenova/all-MiniLM-L6-v2` | HuggingFace 模型 ID（[可用模型/available models](https://huggingface.co/models?library=transformers.js&pipeline_tag=feature-extraction)） |
| `MAX_FILE_SIZE` | `--max-file-size` | `104857600`（100MB）| 最大文件大小（字节）/ Maximum file size in bytes |
| `CHUNK_MIN_LENGTH` | `--chunk-min-length` | `50` | 最小块长度（字符数，1–10000）/ Minimum chunk length in characters |
| `RAG_DEVICE` | — | `cpu` | 执行设备。直接传给 ONNX Runtime。 / Execution device passed to ONNX Runtime. |
| `RAG_DTYPE` | — | `fp32` | 嵌入向量量化数据类型。 / Embedding quantization dtype. |
| `HTTPS_PROXY` | — |（未设置/unset）| HTTP 代理地址，用于下载模型（如 `http://127.0.0.1:7890`）。v0.16.3+ 支持。 / HTTP proxy for model downloads (e.g., `http://127.0.0.1:7890`). Supported since v0.16.3. |
| `HTTP_PROXY` | — |（未设置/unset）| 同上，HTTP 协议的别名。两者同时设置时 `HTTPS_PROXY` 优先。 / Alias for HTTP. `HTTPS_PROXY` takes precedence when both are set. |
| `HF_ENDPOINT` | — | `https://huggingface.co` | HuggingFace 镜像端点（v0.16.2+）。注意：部分公开镜像仅做 308 重定向而非缓存文件，下载大模型仍可能失败。建议优先使用 `HTTPS_PROXY` 代理直连。 / HuggingFace mirror endpoint. Note: some public mirrors only do 308 redirects without caching, which may still fail for large models. Prefer `HTTPS_PROXY` for direct proxied access. |

**模型选择建议 / Model choice tips：**
- 多语言文档 / Multilingual docs → 如 `onnx-community/embeddinggemma-300m-ONNX`（支持 100+ 语言）
- 科研论文 / Scientific papers → 如 `sentence-transformers/allenai-specter`（支持引文感知 / citation-aware）
- 代码仓库 / Code repositories → 默认模型通常足够；关键词加权作用更大 / default often suffices; keyword boost matters more

⚠️ 更改 `MODEL_NAME` 会改变嵌入维度。切换模型后请删除 `DB_PATH` 并重新摄入。
Changing `MODEL_NAME` changes embedding dimensions. Delete `DB_PATH` and re-ingest after switching models.

### 文档根目录（`BASE_DIR` 和 `BASE_DIRS`）/ Document Roots

mcp-local-rag 强制执行安全边界：只有位于配置根目录下的文件才能被摄入、列表、删除或读取相邻块。
mcp-local-rag enforces a security boundary: only files under a configured root are accessible to ingest, list, delete, or read-neighbor operations.

**单个根目录 / Single root** — 使用 `BASE_DIR`：
```bash
export BASE_DIR=/Users/me/Documents/work
```

**多个根目录 / Multiple roots** — 使用 `BASE_DIRS` 配合 JSON 数组：
```bash
export BASE_DIRS='["/Users/me/Documents/work","/Users/me/Projects/specs"]'
```

仅支持 JSON 数组语法。分隔符语法如 `BASE_DIRS=/a:/b` **不支持**（避免空格、冒号、逗号和 Windows 路径的歧义）。
Only JSON-array syntax is supported. Delimiter syntax such as `BASE_DIRS=/a:/b` is intentionally **not** supported.

**解析顺序 / Resolution order**（高优先级优先 / highest precedence first）：

1. CLI `--base-dir <path>` 标志（在 `ingest` 和 `list` 上可重复 / repeatable on `ingest` and `list`）
2. `BASE_DIRS` 环境变量
3. `BASE_DIR` 环境变量
4. `process.cwd()`（当前工作目录 / current working directory）

CLI 根目录**替换**（而非合并）环境变量中的根目录。`BASE_DIRS` 和 `BASE_DIR` 也绝不合并：两者同时设置时 `BASE_DIRS` 优先。
CLI roots **replace** env roots — they are never merged. `BASE_DIRS` and `BASE_DIR` are never merged either: `BASE_DIRS` wins when both are set.

---

<details>
<summary><strong>性能 / Performance</strong></summary>

在 MacBook Pro M1（16GB RAM）、Node.js 22 上测试 / Tested on MacBook Pro M1 (16GB RAM), Node.js 22：

**查询速度 / Query Speed**：~1.2 秒（10,000 个块，p90 < 3s） / ~1.2 seconds for 10,000 chunks (p90 < 3s)

**摄入（10MB PDF）/ Ingestion**：
- PDF 解析 / PDF parsing：~8s
- 分块 / Chunking：~2s
- 嵌入生成 / Embedding：~30s
- 数据库写入 / DB insertion：~5s

**内存 / Memory**：空闲 ~200MB，峰值 ~800MB（摄入 50MB 文件时） / ~200MB idle, ~800MB peak (50MB file ingestion)

**并发 / Concurrency**：处理 5 个并行查询无性能下降 / Handles 5 parallel queries without degradation.

</details>

<details>
<summary><strong>故障排查 / Troubleshooting</strong></summary>

### "没有找到结果" / "No results found"

文档必须先摄入。运行 `"列出所有已摄入的文件"` 进行验证。
Documents must be ingested first. Run `"List all ingested files"` to verify.

### 模型下载失败 / Model download failed

**症状**：启动日志中出现 `fetch failed` 或 `Unable to get model file path or buffer`，`status` 显示 `searchMode: fts`（而非 `hybrid`）。

**原因与排查**：

1. **网络无法直连 HuggingFace** — 如果你在中国大陆或受限网络环境中，直连 `huggingface.co` 会超时。配置代理：
   ```json
   "env": {
     "HTTPS_PROXY": "http://127.0.0.1:7890"
   }
   ```
   注意：需要在 MCP 客户端配置中设置此变量，而非在终端中 export。仅 v0.16.3+ 支持。

2. **模型文件未写入 `CACHE_DIR`** — 首次运行时会下载约 80MB 的 ONNX 模型到 `CACHE_DIR/Xenova/all-MiniLM-L6-v2/`。确认该目录存在且包含 `onnx/model_quantized.onnx` 等文件。如果之前用不同的 `CACHE_DIR` 下载过模型，更新路径指向已有缓存即可避免重复下载：
   ```json
   "env": {
     "CACHE_DIR": "/path/to/your/existing/models/"
   }
   ```
   默认值 `./models/` 是相对于工作目录的，建议使用绝对路径。

3. **`HF_ENDPOINT` 指向的镜像不可用** — 部分公开的 HuggingFace 镜像（如 `hf-mirror.com`）仅做 HTTP 308 重定向，并不缓存模型文件。大文件（80MB+）下载仍可能因网络问题失败。建议用 `HTTPS_PROXY` 代理直连官方源。

4. **npx 缓存了旧版本** — 如果之前用过旧版，npx 可能缓存了不支持代理的版本。清除缓存后重启：
   ```bash
   rm -rf ~/.npm/_npx/
   ```

也可以[手动下载模型](https://huggingface.co/Xenova/all-MiniLM-L6-v2)放入 `CACHE_DIR`。

---

Symptoms: `fetch failed` or `Unable to get model file path or buffer` during startup, `status` showing `searchMode: fts` instead of `hybrid`.

Causes & fixes:

1. **Network cannot reach HuggingFace** — Set the proxy (v0.16.3+):
   ```json
   "env": { "HTTPS_PROXY": "http://127.0.0.1:7890" }
   ```
   This must be set in your MCP client config, not in the terminal.

2. **Model files not written to `CACHE_DIR`** — On first run, ~80MB ONNX models download to `CACHE_DIR/Xenova/all-MiniLM-L6-v2/`. Verify this directory contains `onnx/model_quantized.onnx`. If you previously downloaded models with a different `CACHE_DIR`, just point to the existing cache:
   ```json
   "env": { "CACHE_DIR": "/path/to/your/existing/models/" }
   ```
   The default `./models/` is relative to the working directory — using an absolute path is recommended.

3. **`HF_ENDPOINT` mirror is a redirect-only proxy** — Some mirrors only return HTTP 308 redirects without caching files. Large model downloads (80MB+) may still fail. Use `HTTPS_PROXY` to connect to the official source through a real proxy instead.

4. **npx cached an old version** — Clear npx cache and restart:
   ```bash
   rm -rf ~/.npm/_npx/
   ```

You can also [manually download the model](https://huggingface.co/Xenova/all-MiniLM-L6-v2) into `CACHE_DIR`.

### "文件太大" / "File too large"

默认限制为 100MB。拆分大文件或增加 `MAX_FILE_SIZE`。
Default limit is 100MB. Split large files or increase `MAX_FILE_SIZE`.

### 查询缓慢 / Slow queries

通过 `status` 检查块数量。包含大量块的大文档可能使查询变慢。考虑拆分为更小的文件。
Check chunk count with `status`. Large documents with many chunks may slow queries. Consider splitting very large files.

### "路径不在 BASE_DIR 内" / "Path outside BASE_DIR"

确保文件路径位于配置的根目录之一。使用绝对路径。
Ensure file paths are within one of the configured roots. Use absolute paths.

### "BASE_DIRS must be a JSON array..."

`BASE_DIRS` 仅接受包含一个或多个非空路径字符串的 JSON 数组 / accepts only a JSON array of one or more non-empty path strings：
- 有效 / Valid：`BASE_DIRS='["/Users/me/work","/Users/me/specs"]'`
- 无效 / Invalid：`BASE_DIRS=/a:/b`（不支持分隔符语法 / delimiter syntax not supported）
- 无效 / Invalid：`BASE_DIRS='[]'`（空数组 / empty array）

### MCP 客户端看不到工具 / MCP client doesn't see tools

1. 验证配置文件语法 / Verify config file syntax
2. **WorkBuddy 用户**：检查「设置 → 自定义连接器」中该连接器的「信任」按钮是否已点击。未经信任的自定义连接器会被静默阻止。 / **WorkBuddy users**: check whether the "Trust" button for this connector has been clicked in Settings → Custom Connectors. Untrusted connectors are silently blocked.
3. 完全重启客户端（Mac 上 Cmd+Q 退出 Cursor）/ Restart client completely (Cmd+Q on Mac for Cursor)
4. 直接测试：`npx @damoqiongqiu/mcp-local-rag` 应能正常运行，无错误 / Test directly: `npx @damoqiongqiu/mcp-local-rag` should run without errors

### 重建索引 / Rebuilding the Index

当切换嵌入模型、数据库损坏、或需要从头开始索引时，需要完全重建索引：

1. **停止 MCP 服务**（关闭 MCP 面板中的连接）
2. **删除向量数据库**：删除 `DB_PATH` 目录（默认 `./lancedb/`）
3. **重启 MCP 服务**，数据库将自动重新创建
4. **批量重新摄入**：通过 CLI 或 MCP 工具摄入所有文件。对于大型项目，建议用 CLI 批量模式：
   ```bash
   npx @damoqiongqiu/mcp-local-rag ingest ./src/
   npx @damoqiongqiu/mcp-local-rag ingest ./docs/
   ```

注意：删除 `DB_PATH` 是安全的——不会影响源代码文件或模型缓存（`CACHE_DIR`）。重建后需重新摄入所有文件。

---

To fully rebuild the index (e.g., after switching models or when the database is corrupted):

1. **Stop the MCP service** (disconnect in your MCP client)
2. **Delete the vector database**: remove the `DB_PATH` directory (default: `./lancedb/`)
3. **Restart MCP** — a fresh database is created automatically
4. **Re-ingest all files**: use CLI bulk mode for large projects:
   ```bash
   npx @damoqiongqiu/mcp-local-rag ingest ./src/
   npx @damoqiongqiu/mcp-local-rag ingest ./docs/
   ```

Note: deleting `DB_PATH` is safe — it does not affect your source files or model cache (`CACHE_DIR`).

</details>

<details>
<summary><strong>常见问题 / FAQ</strong></summary>

**这真的私密吗？ / Is this really private?**
是的。在模型下载之后，没有任何数据离开你的机器。可用网络监控验证。
Yes. After model download, nothing leaves your machine. Verify with network monitoring.

**可以离线使用吗？ / Can I use this offline?**
可以，只要所需模型已缓存到本地。
Yes, after the required models are cached locally.

**与云端 RAG 相比如何？ / How does this compare to cloud RAG?**
云端服务在规模上提供更好的准确性，但需要将数据发送到外部。这个工具用一些准确性换取了完全的隐私和零运行时成本。
Cloud services offer better accuracy at scale but require sending data externally. This trades some accuracy for complete privacy and zero runtime cost.

**支持哪些文件格式？ / What file formats are supported?**
50+ 种代码文件扩展名（TypeScript、JavaScript、Python、Go、Rust、Java、Kotlin、C/C++ 等），以及 PDF、DOCX、TXT、Markdown、HTML（通过 `ingest_data`）。暂不支持：Excel、PowerPoint、图片。
50+ code file extensions (TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C/C++, and more), plus PDF, DOCX, TXT, Markdown, HTML (via `ingest_data`). Not yet: Excel, PowerPoint, images.

**能否更换嵌入模型？ / Can I change the embedding model?**
可以，但必须删除数据库并重新摄入所有文档。不同模型产生不兼容的向量维度。
Yes, but you must delete your database and re-ingest all documents. Different models produce incompatible vector dimensions.

**GPU 加速？ / GPU acceleration?**
可选，通过 `RAG_DEVICE` 开启。GPU 支持高度依赖你的系统、Node.js 版本和底层 ONNX 后端。
Opt-in via `RAG_DEVICE`. GPU support is highly dependent on your system, Node.js version, and the underlying ONNX backend.

**多用户支持？ / Multi-user support?**
不支持。专为单用户本地访问设计。
No. Designed for single-user, local access.

**如何备份？ / How to backup?**
复制 `DB_PATH` 目录（默认 `./lancedb/`）。
Copy `DB_PATH` directory (default: `./lancedb/`).

</details>

<details>
<summary><strong>开发 / Development</strong></summary>

### 从源码构建 / Building from Source

```bash
git clone https://github.com/damoqiongqiu/mcp-local-rag.git
cd mcp-local-rag
pnpm install
```

### 测试 / Testing

```bash
pnpm test              # 运行所有测试 / Run all tests
pnpm run test:watch    # 监视模式 / Watch mode
```

### 代码质量 / Code Quality

```bash
pnpm run type-check    # TypeScript 检查
pnpm run check:fix     # Lint 和格式化 / Lint and format
pnpm run check:deps    # 循环依赖检查 / Circular dependency check
pnpm run check:all     # 全量质量检查 / Full quality check
```

### 项目结构 / Project Structure

```
src/
  index.ts      # 入口点 / Entry point
  server/       # MCP 工具处理器 / MCP tool handlers
  cli/          # CLI 子命令 / CLI subcommands
  parser/       # PDF、DOCX、TXT、MD 及代码文件解析 / PDF, DOCX, TXT, MD, and code file parsing
  chunker/      # 文本分块（文档用 SemanticChunker，代码用 CodeChunker）/ Text splitting (SemanticChunker for docs, CodeChunker for code)
  embedder/     # Transformers.js 嵌入 / Transformers.js embeddings
  vectordb/     # LanceDB 操作 / LanceDB operations
  __tests__/    # 测试套件 / Test suites
```

</details>

---

## 贡献 / Contributing

欢迎贡献！参见 [CONTRIBUTING.md](CONTRIBUTING.md) 了解环境搭建和指南。
Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and guidelines.

## 许可证 / License

MIT License。免费用于个人和商业用途。
MIT License. Free for personal and commercial use.

## 博客文章 / Blog Posts

- [Building a Local RAG for Agentic Coding](https://www.norsica.jp/blog/local-rag-agentic-coding) — 语义分块和混合搜索设计的技术深度解析 / Technical deep-dive into the semantic chunking and hybrid search design.

## 致谢 / Acknowledgments

使用 [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic、[LanceDB](https://lancedb.com/) 和 [Transformers.js](https://huggingface.co/docs/transformers.js) 构建。
Built with [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic, [LanceDB](https://lancedb.com/), and [Transformers.js](https://huggingface.co/docs/transformers.js).
