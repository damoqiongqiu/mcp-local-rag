<p align="center">
  <img src="assets/banner.jpg" alt="MCP Local RAG — 在表层之下搜索。" width="600" />
</p>

# MCP Local RAG

[![GitHub stars](https://img.shields.io/github/stars/shinpr/mcp-local-rag?style=social)](https://github.com/shinpr/mcp-local-rag)
[![npm version](https://img.shields.io/npm/v/mcp-local-rag.svg)](https://www.npmjs.com/package/mcp-local-rag)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-green.svg)](https://registry.modelcontextprotocol.io/)

面向开发者的本地 RAG，支持 MCP 与 CLI 两种使用方式。
语义搜索 + 关键词加权，精准命中技术术语——完全私密，零配置。

## 特性

- **语义搜索 + 关键词加权**
  先向量搜索，再通过关键词匹配提升精确匹配项的排名。`useEffect`、错误码、类名等术语会被优先召回——而不是仅靠语义猜测。

- **智能语义分块**
  按语义而非字符数切分文档。利用嵌入相似度寻找自然的话题边界——相关内容聚合在一起，在话题转换处分块。

- **质量优先的结果过滤**
  按相关性差距分组，而非任意的 top-K 截断。用更少但更可信的块获得更好的结果。

- **完全本地运行**
  无需 API Key，无需云端，数据不离开你的机器。首次模型下载后可完全离线工作。

- **零摩擦上手**
  一条 `npx` 命令搞定。无需 Docker、无需 Python、无需管理服务器。
  可通过 MCP 或 CLI 使用。可选的 [Agent Skills](#agent-skills) 帮助 AI 助手更好地构建查询和解读结果。

## 快速开始

将 `BASE_DIR` 设置为你想要搜索的文件夹（多个根目录请用 `BASE_DIRS`——参见[配置](#配置)）。文档必须位于配置的根目录之下。

### 配置 AI 编程工具

**Cursor** — 添加到 `~/.cursor/mcp.json`：
```json
{
  "mcpServers": {
    "local-rag": {
      "command": "npx",
      "args": ["-y", "mcp-local-rag"],
      "env": {
        "BASE_DIR": "/path/to/your/documents"
      }
    }
  }
}
```

**Codex** — 添加到 `~/.codex/config.toml`：
```toml
[mcp_servers.local-rag]
command = "npx"
args = ["-y", "mcp-local-rag"]

[mcp_servers.local-rag.env]
BASE_DIR = "/path/to/your/documents"
```

**Claude Code** — 运行以下命令：
```bash
claude mcp add local-rag --scope user --env BASE_DIR=/path/to/your/documents -- npx -y mcp-local-rag
```

重启工具后即可使用：

```
你: "摄入 api-spec.pdf"
助手: 成功摄入 api-spec.pdf（生成 47 个块）

你: "API 文档里关于认证是怎么说的？"
助手: 根据文档，认证使用 OAuth 2.0 和 JWT 令牌。
      具体流程在第 3.2 节中描述...
```

**也可直接作为 CLI 使用**——无需启动 MCP 服务器：

```bash
npx mcp-local-rag ingest ./docs/
npx mcp-local-rag query "认证 API"
```

就这些。无需 Docker，无需 Python，无需配置服务器。

## 为什么会有这个项目

你想让 AI 搜索你的文档——技术规格、研究论文、内部文档。但大多数方案都会把你的文件发送到外部 API。

**隐私。** 你的文档可能包含敏感数据。这个工具完全在本地运行。

**成本。** 外部嵌入 API 按次收费。这个工具在初始模型下载后完全免费。

**离线可用。** 配置完成之后无需联网即可使用。

**代码搜索。** 纯语义搜索会遗漏 `useEffect` 或 `ERR_CONNECTION_REFUSED` 这样的精确术语。关键词加权能同时捕捉语义和精确匹配。

**Agent 现实。** 实践中，很多 AI 环境主要使用工具调用。CLI 支持和 Agent Skills 使得即使没有完整 MCP 集成，也能使用同样的工作流。

## 使用方式

mcp-local-rag 提供两种接口：**MCP 服务器**（供 AI 编程工具使用）和 **CLI**（供终端直接使用）。

### 通过 MCP 使用

MCP 服务器提供 7 个工具：`ingest_file`、`ingest_data`、`query_documents`、`read_chunk_neighbors`、`list_files`、`delete_file`、`status`。

#### 摄入文档

```
"摄入 /Users/me/docs/api-spec.pdf 这个文档"
```

支持 PDF、DOCX、TXT 和 Markdown 格式。服务器提取文本、切分成块、在本地生成嵌入向量，并将所有内容存储到本地向量数据库中。

重复摄入同一文件会自动替换旧版本。

##### 摄入含图表的 PDF（视觉模式）

含有图表、表格或示意图的 PDF 可以选择在文档索引中添加由本地 VLM 生成的描述文字，使视觉内容在同一个向量 + 全文检索的管道中获得可搜索的文本表示。描述文字是辅助性文本——不是图片搜索，不是 OCR，也不是对图片内容的真实转录。

**通过 MCP 使用**：
```
"用 visual: true 摄入 /Users/me/docs/api-spec.pdf"
```

**通过 CLI 使用**：
```bash
npx mcp-local-rag ingest ./docs/spec.pdf --visual
```

每条描述文字会以独立块的形式输出，格式为 `[Visual content on page N: …]`，与页面正文块一起存放。它流经现有的嵌入器和 FTS 索引——没有模式差异，也没有单独的索引。

视觉模式是可选功能；普通摄入不会加载 VLM。每个页面的 VLM 失败会被容忍——该页面仅以纯文本形式继续处理。

###### 选择视觉质量配置

视觉模式提供两种配置，每次摄入时选择：

| 配置 | 模型 | 磁盘缓存 | 单页推理耗时 | 适用场景 |
|---|---|---|---|---|
| `fast`（默认） | `HuggingFaceTB/SmolVLM-256M-Instruct` | ~250 MB | 基准 | 轻量视觉索引，快速首次运行。 |
| `quality` | `onnx-community/Qwen2.5-VL-3B-Instruct-ONNX` | ~2.9 GB | ~2× `fast` | 图片内含文本（坐标轴标签、面板子标签、注释）的场景，描述准确性比推理时间更重要。 |

以上数据是在开发阶段使用项目测试 PDF 在 CPU 上测得的；可能随模型更新或因你的硬件而异。

**通过 MCP 使用** — `ingest_file` 接受可选的 `visualQuality` 参数（枚举：`'fast' | 'quality'`，默认 `'fast'`；`visual` 为 false 时忽略）：
```
"用 visual: true 和 visualQuality: 'quality' 摄入 /Users/me/docs/research-paper.pdf"
```

**通过 CLI 使用** — `--visual-quality fast|quality`（默认 `fast`；无 `--visual` 时静默忽略）：
```bash
npx mcp-local-rag ingest ./docs/research-paper.pdf --visual --visual-quality quality
```

配置的模型标识符和量化变体会随版本固定。两种配置共用同一个 `CACHE_DIR`（默认 `./models/`）；首次运行每个配置时会下载对应模型。

> **v0.14.0 行为变更**：描述文字现在以专用块的形式输出，而非追加到页面文本后再分块。作为附带影响，视觉摄入时 `metadata.fileSize` 不再包含描述文字的字符数——它仅衡量提取后的正文长度。底层的 PDF 文件不变；只有视觉摄入 PDF 时报告的 `fileSize` 在跨越版本边界时可能缩小。

> **安全提示**：视觉描述文字源自 PDF 内容，可能继承攻击者控制的文本。下游 LLM 消费者应将检索到的块视为不可信数据，而非指令。`[Visual content on page N: …]` 的包裹格式有助于消费者区分描述文字和正文。

#### 摄入 HTML 内容

使用 `ingest_data` 摄入由你的 AI 助手获取的 HTML 内容（通过网页抓取、curl、浏览器工具等）：

```
"获取 https://example.com/docs 并将 HTML 摄入"
```

服务器使用 Readability 提取主要内容（移除导航、广告等），转换为 Markdown，然后索引。非常适合：
- Web 文档
- AI 助手获取的 HTML
- 剪贴板内容

HTML 会被自动清理——你得到的是文章内容，不是页面模板。

> **注意：** RAG 服务器本身不会抓取网页内容——你的 AI 助手获取内容后将 HTML 传给 `ingest_data`。这既保持了服务器的完全本地化，又允许你索引助手能访问的任何内容。请尊重网站的服务条款和版权。

#### 搜索文档

```
"API 文档里关于认证是怎么说的？"
"找一下关于频率限制的信息"
"搜索错误处理的最佳实践"
```

搜索使用语义相似度和关键词加权。这意味着搜索 `useEffect` 会找到包含该精确术语的文档，而不仅仅是语义相似的 React 概念。

搜索结果包含文本内容、来源文件、文档标题和相关性分数。文档标题为每个块提供上下文，帮助识别结果属于哪个文档。可通过 `limit`（1-20，默认 10）调整结果数量。

用 `scope` 缩小搜索范围到语料库的一部分——可以是一个路径前缀或前缀列表。结果限制为块的文件路径等于该前缀或在其之下的块（精确匹配或后代匹配）。例如 `"/docs/api"` 匹配 `/docs/api` 和 `/docs/api/auth.md`，但不匹配 `/docs/apiv2`；文件前缀如 `"/docs/readme.md"` 仅匹配该文件。前缀使用服务器操作系统的路径格式。

#### 扩展结果的上下文

当搜索结果需要更多上下文时，使用 `read_chunk_neighbors` 读取该结果前后的块：

```
"那个关于认证的结果看起来相关——读取周围的块获取完整解释"
```

传入搜索结果中的 `filePath` 和 `chunkIndex`。响应包含目标块（标记为 `isTarget: true`）及其相邻块，按 chunk index 排序。默认前后各 2 个块（各自最大可调至 50）。

#### 管理文件

```
"列出配置的基础目录中所有文件及其摄入状态"   # 查看已索引内容
"从 RAG 中删除 old-spec.pdf"               # 删除文件
"显示 RAG 服务器状态"                       # 检查系统健康
```

用 `scope` 缩小 `list_files` 的列表范围——可以是一个路径前缀或前缀列表。结果限制为文件的路径等于或在前缀之下的文件（精确匹配或后代匹配）；例如 `"/docs/api"` 匹配 `/docs/api` 和 `/docs/api/auth.md`，但不匹配 `/docs/apiv2`。来自 `ingest_data` 的原始数据源会无视 scope 始终列出。在大数据量下，scope 还能通过跳过扫描时不在范围内的目录来加速列表。

### 作为 CLI 使用

所有 MCP 工具也可以通过 CLI 命令使用——无需启动 MCP 服务器：

```bash
npx mcp-local-rag ingest ./docs/               # 批量摄入文件
npx mcp-local-rag query "认证 API"              # 搜索文档
npx mcp-local-rag query "auth" --scope /docs/api --scope /docs/guide  # 限制到路径前缀（可重复）
npx mcp-local-rag read-neighbors --file-path /abs/path.md --chunk-index 5  # 扩展上下文
npx mcp-local-rag list                          # 显示摄入状态
npx mcp-local-rag list --scope /docs/api --scope /docs/guide  # 限制列表到路径前缀（可重复）
npx mcp-local-rag status                        # 数据库统计
npx mcp-local-rag delete ./docs/old.pdf         # 删除内容
npx mcp-local-rag delete --source "https://..."  # 按来源 URL 删除
```

`query`、`read-neighbors`、`list`、`status` 和 `delete` 输出 JSON 到 stdout（可用于管道，如 `| jq`）。`ingest` 输出进度到 stderr。全局选项（`--db-path`、`--cache-dir`、`--model-name`）放在子命令之前。运行 `npx mcp-local-rag --help` 查看详情。

> ⚠️ CLI **不会**读取你的 MCP 客户端配置（`mcp.json`、`config.toml` 等）。通过命令行标志或环境变量配置 CLI，如下所示。

#### 配置

**CLI 标志** — 全局选项放在子命令之前，子命令选项放在子命令之后：

```bash
npx mcp-local-rag --db-path ./my-db query "auth" --base-dir ./docs
```

`--base-dir` 标志在 `ingest` 和 `list` 上可重复使用；每个根目录传一次：

```bash
npx mcp-local-rag ingest --base-dir ./docs --base-dir ./specs ./docs/readme.md
npx mcp-local-rag list --base-dir ./docs --base-dir ./specs
```

`ingest` 的位置参数必须位于配置的根目录之一内部。提供至少一个 `--base-dir` 时，CLI 根目录会替换（而非合并）任何环境变量中的根目录。

**环境变量** — 在你的 shell 中设置：

```bash
export DB_PATH=./my-db
export BASE_DIR=./docs
npx mcp-local-rag query "auth"
```

多根目录使用 `BASE_DIRS`（包含非空路径字符串的 JSON 数组）：

```bash
export BASE_DIRS='["/Users/me/Documents/work","/Users/me/Projects/specs"]'
npx mcp-local-rag list
```

**MCP 与 CLI 共享配置** — 如果你的 MCP 客户端继承 shell 环境变量，你可以在 shell 配置（如 `~/.zshrc`）中设置它们，使两者使用相同的值。否则在 MCP 配置中也显式设置。

```bash
export BASE_DIR=/path/to/your/documents
export DB_PATH=/path/to/lancedb
```

配置按以下顺序解析：

1. CLI 标志（最高优先级）
2. 环境变量
3. 默认值

完整 CLI 标志、环境变量和默认值列表参见[配置](#配置)。

对于仅 CLI 的场景（不启动 MCP 服务器），安装 [Agent Skills](#agent-skills) 让你的 AI 助手更好地构建查询和解读结果。

> ⚠️ **CLI 的 `--model-name` 必须与 MCP 服务器的 `MODEL_NAME` 环境变量匹配。** 使用不同的嵌入模型操作已有数据库会产生不兼容的向量，静默降低搜索质量。

## 搜索调优

根据你的场景调整以下参数：

| 变量 | 默认值 | 描述 |
|------|--------|------|
| `RAG_HYBRID_WEIGHT` | `0.6` | 关键词加权系数。0 = 仅语义，更高的值 = 更强的关键词权重。 |
| `RAG_GROUPING` |（未设置）| `similar` 仅返回最相关组，`related` 返回前两个相关组。 |
| `RAG_MAX_DISTANCE` |（未设置）| 过滤低相关度结果（例如 `0.5`）。 |
| `RAG_MAX_FILES` |（未设置）| 限制结果到前 N 个文件（例如 `1` 仅返回最佳单个文件）。 |

### 面向代码的调优

对于代码库和 API 规范，增加关键词权重使精确标识符（`useEffect`、`ERR_*`、类名）主导排名：

```json
"env": {
  "RAG_HYBRID_WEIGHT": "0.7",
  "RAG_GROUPING": "similar"
}
```

- `0.7` — 语义 + 关键词平衡
- `1.0` — 激进模式；精确匹配会大幅重新排序结果

关键词加权在语义过滤**之后**应用，因此它能提升精度而不会引入无关匹配。

## 工作原理

**简要：**
- 文档按语义相似度分块，而非固定字符数
- 每个块通过 Transformers.js 在本地生成嵌入向量
- 搜索使用语义相似度加上关键词精确匹配的加权
- 结果根据相关性差距过滤，而非原始分数

### 详细说明

当你摄入文档时，解析器根据文件类型提取文本（PDF 通过 `mupdf`，DOCX 通过 `mammoth`，文本文件直接读取）。

语义分块器将文本拆分为句子，然后利用嵌入相似度将其分组。它会在语义转换处寻找自然的话题边界——将相关内容保留在一起，而不是在任意字符限制处切断。这样生成的块是连贯的语义单元，通常为 500-1000 字符。Markdown 代码块会保持完整——绝不会在代码块中间拆分——确保搜索结果中的代码可以直接复制粘贴。

每个块经过 Transformers.js 嵌入模型处理（默认 `all-MiniLM-L6-v2`，可通过 `MODEL_NAME` 配置），将文本转换为向量。向量存储在 LanceDB 中，这是一个基于文件的向量数据库，无需服务进程。

当你搜索时：
1. 查询使用同样模型转换为向量
2. 语义（向量）搜索找到最相关的块
3. 质量过滤器应用（距离阈值、分组）
4. 关键词匹配提升精确术语匹配的排名

关键词加权确保 `useEffect` 或错误码等精确术语匹配时排名更高。

## Agent Skills

[Agent Skills](https://agentskills.io/) 提供优化的提示词，帮助 AI 助手更有效地使用 RAG 工具。安装 Skills 以获得更好的查询形成、结果解读和摄入工作流：

```bash
# Claude Code（项目级别）
npx mcp-local-rag skills install --claude-code

# Claude Code（用户级别）
npx mcp-local-rag skills install --claude-code --global

# Codex
npx mcp-local-rag skills install --codex
```

Skills 包括：
- **查询优化**：更好的搜索查询构建
- **结果解读**：分数阈值和过滤指南
- **HTML 摄入**：格式选择和来源命名

### 确保 Skill 激活

Skills 在大多数情况下自动加载——AI 助手扫描 skill 元数据并在需要时加载相关指令。为确保一致行为：

**方案 1：显式请求（自然语言）**
在 RAG 操作前，用自然语言请求：
- "Use the mcp-local-rag skill for this search"
- "Apply RAG best practices from skills"

**方案 2：添加到 agent 指令文件**
添加到你项目的 `AGENTS.md`、`CLAUDE.md` 或其他 agent 指令文件中：
```
When using query_documents, ingest_file, or ingest_data tools,
apply the mcp-local-rag skill for better query formulation and result interpretation.
```

## 配置

### 环境变量和 CLI 标志

MCP 服务器仅通过环境变量配置——通过 MCP 客户端的 `env` 块传入。CLI 接受相同的环境变量加上等效的标志（优先级：CLI 标志 > 环境变量 > 默认值）。CLI 标志不接受在 `mcp-local-rag` 无子命令直接启动（MCP 服务器模式）时。

| 环境变量 | CLI 标志 | 默认值 | 描述 |
|---------|----------|--------|------|
| `BASE_DIR` | `--base-dir`（可重复）| 当前目录 | 单个文档根目录（安全边界）。多根目录设置参见[文档根目录](#文档根目录-base_dir-和-base_dirs)。 |
| `BASE_DIRS` | — |（未设置）| JSON 数组形式的文档根目录（安全边界）。优先级高于 `BASE_DIR`。参见[文档根目录](#文档根目录-base_dir-和-base_dirs)。 |
| `DB_PATH` | `--db-path` | `./lancedb/` | 向量数据库位置 |
| `CACHE_DIR` | `--cache-dir` | `./models/` | 模型缓存目录 |
| `MODEL_NAME` | `--model-name` | `Xenova/all-MiniLM-L6-v2` | HuggingFace 模型 ID（[可用模型](https://huggingface.co/models?library=transformers.js&pipeline_tag=feature-extraction)） |
| `MAX_FILE_SIZE` | `--max-file-size` | `104857600`（100MB）| 最大文件大小（字节） |
| `CHUNK_MIN_LENGTH` | `--chunk-min-length` | `50` | 最小块长度（字符数，1–10000） |
| `RAG_DEVICE` | — | `cpu` | 执行设备。直接传给 ONNX Runtime。参见 [Transformers.js 设备源码](https://github.com/huggingface/transformers.js/blob/main/packages/transformers/src/utils/devices.js) 获取受支持的后端名称列表。初始化失败时，服务器会抛出错误。 |
| `RAG_DTYPE` | — | `fp32` | 嵌入向量量化数据类型。可选功能，直接透传；接受模型提供的任何数据类型（`fp32`、`fp16`、`q8`、`int8`……）。如果模型缺少请求的变体，服务器会抛出错误，列出它提供的数据类型。更改 `RAG_DEVICE`/`RAG_DTYPE` 会改变嵌入空间——需要重新摄入现有数据。 |

**模型选择建议：**
- 多语言文档 → 如 `onnx-community/embeddinggemma-300m-ONNX`（支持 100+ 语言）
- 科研论文 → 如 `sentence-transformers/allenai-specter`（支持引文感知）
- 代码仓库 → 默认模型通常足够；关键词加权作用更大（或使用 `jinaai/jina-embeddings-v2-base-code`）

⚠️ 更改 `MODEL_NAME` 会改变嵌入维度。切换模型后请删除 `DB_PATH` 并重新摄入。

### 文档根目录（`BASE_DIR` 和 `BASE_DIRS`）

mcp-local-rag 强制执行安全边界：只有位于配置根目录下的文件才能被摄入、列表、删除或读取相邻块。

**单个根目录** — 使用 `BASE_DIR`：

```bash
export BASE_DIR=/Users/me/Documents/work
```

**多个根目录** — 使用 `BASE_DIRS` 配合 JSON 数组：

```bash
export BASE_DIRS='["/Users/me/Documents/work","/Users/me/Projects/specs"]'
```

仅支持 JSON 数组语法。分隔符语法如 `BASE_DIRS=/a:/b` **不支持**（避免空格、冒号、逗号和 Windows 路径的歧义）。

**解析顺序**（高优先级优先）：

1. CLI `--base-dir <path>` 标志（在 `ingest` 和 `list` 上可重复）
2. `BASE_DIRS` 环境变量
3. `BASE_DIR` 环境变量
4. `process.cwd()`（当前工作目录）

CLI 根目录**替换**（而非合并）环境变量中的根目录。`BASE_DIRS` 和 `BASE_DIR` 也绝不合并：两者同时设置时 `BASE_DIRS` 优先。

**优先级警告** — 当 `BASE_DIRS` 和 `BASE_DIR` 同时设置（且未提供 CLI `--base-dir`）时，`BASE_DIR` 被忽略，并显示警告。警告可见于：

- MCP 工具响应中（作为额外的内容块，所有工具均出现——包括 `status`、`query_documents`、`ingest_file`、`ingest_data`、`list_files`、`delete_file`、`read_chunk_neighbors`）。
- CLI 的 `stderr` 输出中。

取消设置 `BASE_DIR`（或移除 `BASE_DIRS`）以消除警告。

**嵌套根目录剪枝** — 如果 realpath 解析后一个配置的根目录位于另一个根目录内部，嵌套的子目录会被丢弃以避免重复扫描。剪枝警告的显示方式与优先级警告相同。存活的父根目录仍定义安全边界。

**无效的 `BASE_DIRS`** — 当 `BASE_DIRS` 不是有效的非空字符串 JSON 数组时（格式错误的 JSON、空数组、非字符串元素……），依赖根目录的 MCP 工具返回结构化错误，CLI 子命令退出非零。**不会静默回退**到 `BASE_DIR` 或 `cwd`。MCP `status` 工具保持可调用状态，以便你通过 MCP 客户端诊断配置错误。

### 各客户端配置

**Cursor** — 全局：`~/.cursor/mcp.json`，项目：`.cursor/mcp.json`

**Codex** — `~/.codex/config.toml`（注意：必须使用下划线 `mcp_servers`）

**Claude Code**：
```bash
claude mcp add local-rag --scope user \
  --env BASE_DIR=/path/to/your/documents \
  -- npx -y mcp-local-rag
```

### 首次运行

嵌入模型（约 90MB）在首次使用时下载。需要 1-2 分钟，之后即可离线工作。

### 安全

- **路径限制**：只能访问配置根目录（`BASE_DIR` 或任意 `BASE_DIRS` / `--base-dir` 条目）下的文件。解析到所有配置根目录之外的符号链接，以及同级前缀路径（如根目录 `/foo/bar` 的 `/foo/barista`）都会被拒绝。
- **完全本地**：模型下载后无任何网络请求
- **模型来源**（全部为 HuggingFace 官方仓库）：
  - 嵌入器：[`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2)
  - 视觉 `fast` 配置：[`HuggingFaceTB/SmolVLM-256M-Instruct`](https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct)
  - 视觉 `quality` 配置：[`onnx-community/Qwen2.5-VL-3B-Instruct-ONNX`](https://huggingface.co/onnx-community/Qwen2.5-VL-3B-Instruct-ONNX)
- **视觉描述忠实度**：`quality` 配置比 `fast` 更忠实地复现图片内文本。两种配置输出的描述都包裹为 `[Visual content on page N: …]`，但忠实复现意味着攻击者控制的图片内文本——包括能视觉上关闭包裹的字符如 `]`——可能会原样出现在检索块中。下游 LLM 消费者应将检索块视为不可信数据而非指令，无论包裹形态如何。

<details>
<summary><strong>性能</strong></summary>

在 MacBook Pro M1（16GB RAM）、Node.js 22 上测试：

**查询速度**：~1.2 秒（10,000 个块，p90 < 3s）

**摄入**（10MB PDF）：
- PDF 解析：~8s
- 分块：~2s
- 嵌入生成：~30s
- 数据库写入：~5s

**内存**：空闲 ~200MB，峰值 ~800MB（摄入 50MB 文件时）

**并发**：处理 5 个并行查询无性能下降。

</details>

<details>
<summary><strong>故障排查</strong></summary>

### "没有找到结果"

文档必须先摄入。运行 `"列出所有已摄入的文件"` 进行验证。

### 模型下载失败

检查网络连接。如果使用代理，配置网络设置。也可以[手动下载](https://huggingface.co/Xenova/all-MiniLM-L6-v2)模型。

### "文件太大"

默认限制为 100MB。拆分大文件或增加 `MAX_FILE_SIZE`。

### 查询缓慢

通过 `status` 检查块数量。包含大量块的大文档可能使查询变慢。考虑拆分为更小的文件。

### "路径不在 BASE_DIR 内"

确保文件路径位于配置的根目录之一（`BASE_DIR`、任意 `BASE_DIRS` 条目或任意 CLI `--base-dir`）。使用绝对路径。

### "BASE_DIRS must be a JSON array..."

`BASE_DIRS` 仅接受包含一个或多个非空路径字符串的 JSON 数组。示例：

- 有效：`BASE_DIRS='["/Users/me/work","/Users/me/specs"]'`
- 无效：`BASE_DIRS=/a:/b`（不支持分隔符语法）
- 无效：`BASE_DIRS='[]'`（空数组）
- 无效：`BASE_DIRS='["",""]'`（空字符串元素）

当配置无效时，依赖根目录的操作会失败并返回明确错误，不会静默回退。MCP `status` 工具保持可调用状态，以便你查看诊断信息。

### MCP 客户端看不到工具

1. 验证配置文件语法
2. 完全重启客户端（Mac 上 Cmd+Q 退出 Cursor）
3. 直接测试：`npx mcp-local-rag` 应能正常运行，无错误

</details>

<details>
<summary><strong>常见问题</strong></summary>

**这真的私密吗？**
是的。在模型下载之后，没有任何数据离开你的机器。可用网络监控验证。

**可以离线使用吗？**
可以，只要所需模型已缓存到本地。文本摄入/搜索需要嵌入模型。PDF 视觉模式是可选的，首次使用时也需要 VLM 模型；默认 `fast` 配置（SmolVLM-256M）下载约 250MB，`quality` 配置（Qwen2.5-VL-3B）约 2.9GB，缓存于 `CACHE_DIR`（默认 `./models/`）。

**与云端 RAG 相比如何？**
云端服务在规模上提供更好的准确性，但需要将数据发送到外部。这个工具用一些准确性换取了完全的隐私和零运行时成本。

**支持哪些文件格式？**
PDF、DOCX、TXT、Markdown 和 HTML（通过 `ingest_data`）。暂不支持：Excel、PowerPoint、图片。

**能否更换嵌入模型？**
可以，但必须删除数据库并重新摄入所有文档。不同模型产生不兼容的向量维度。

**GPU 加速？**
可选，通过 `RAG_DEVICE` 开启。设备类型直接传给 ONNX Runtime。GPU 支持高度依赖你的系统、Node.js 版本和底层 ONNX 后端。参见 [Transformers.js 设备源码](https://github.com/huggingface/transformers.js/blob/main/packages/transformers/src/utils/devices.js) 获取受支持的后端名称列表。如果请求的设备初始化失败，服务器会抛出错误——设置 `RAG_DEVICE=cpu` 来恢复到 CPU。

**能否更改嵌入精度（dtype）？**
可选，通过 `RAG_DTYPE`（默认 `fp32`）；可接受的值见上方的环境变量表。一个已识别的但模型缺失的数据类型会报错并列出可用的选项；一个无法识别的值（输入错误）会静默回退到 `fp32`。更改 `RAG_DEVICE`/`RAG_DTYPE` 会改变嵌入空间——需要删除 `DB_PATH` 并重新摄入。

**多用户支持？**
不支持。专为单用户本地访问设计。多用户需要身份验证/访问控制。

**如何备份？**
复制 `DB_PATH` 目录（默认 `./lancedb/`）。

</details>

<details>
<summary><strong>开发</strong></summary>

### 从源码构建

```bash
git clone https://github.com/shinpr/mcp-local-rag.git
cd mcp-local-rag
pnpm install
```

### 测试

```bash
pnpm test              # 运行所有测试
pnpm run test:watch    # 监视模式
```

### 代码质量

```bash
pnpm run type-check    # TypeScript 检查
pnpm run check:fix     # Lint 和格式化
pnpm run check:deps    # 循环依赖检查
pnpm run check:all     # 全量质量检查
```

### 项目结构

```
src/
  index.ts      # 入口点
  server/       # MCP 工具处理器
  cli/          # CLI 子命令（ingest、query、list、delete、read-neighbors 等）
  parser/       # PDF、DOCX、TXT、MD 解析
  chunker/      # 文本分块
  embedder/     # Transformers.js 嵌入
  vectordb/     # LanceDB 操作
  __tests__/    # 测试套件
```

</details>

## 贡献

欢迎贡献！参见 [CONTRIBUTING.md](CONTRIBUTING.md) 了解环境搭建和指南。

## 许可证

MIT License。免费用于个人和商业用途。

## 博客文章

- [Building a Local RAG for Agentic Coding](https://www.norsica.jp/blog/local-rag-agentic-coding) — 语义分块和混合搜索设计的技术深度解析。

## 致谢

使用 [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic、[LanceDB](https://lancedb.com/) 和 [Transformers.js](https://huggingface.co/docs/transformers.js) 构建。
