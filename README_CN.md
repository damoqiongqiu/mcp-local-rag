<p align="center">
  <img src="assets/banner.jpg" alt="MCP Local RAG — 在表层之下搜索。" width="600" />
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

📖 [English](README.md)

---

## 特性

- **智能双策略分块**
  代码文件使用 AST 级分块（tree-sitter 在函数/类边界切分，注入作用域链 + import 上下文）。文档使用语义分块（按含义而非字符数切分）。
- **语义搜索 + 关键词加权**
  先向量搜索，再通过关键词匹配提升精确匹配项的排名。`useEffect`、错误码、类名等术语会被优先召回——而不是仅靠语义猜测。
- **质量优先的结果过滤**
  按相关性差距分组，而非任意的 top-K 截断。用更少但更可信的块获得更好的结果。
- **完全本地运行**
  无需 API Key，无需云端，数据不离开你的机器。首次模型下载后可完全离线工作。
- **零摩擦上手**
  一条 `npx` 命令搞定。无需 Docker、无需 Python、无需管理服务器。可通过 MCP 或 CLI 使用。可选的 [Agent Skills](#agent-skills) 帮助 AI 助手更好地构建查询和解读结果。

---

## 快速开始

将 `BASE_DIR` 设置为你想要搜索的文件夹（多个根目录请用 `BASE_DIRS`——参见[配置](#配置)）。文档必须位于配置的根目录之下。

### 配置 AI 编程工具

**Cursor** — 添加到 `~/.cursor/mcp.json`：

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

**Codex** — 添加到 `~/.codex/config.toml`：

```toml
[mcp_servers.local-rag]
command = "npx"
args = ["-y", "@damoqiongqiu/mcp-local-rag"]

[mcp_servers.local-rag.env]
BASE_DIR = "/path/to/your/documents"
```

**Claude Code** — 运行以下命令：

```bash
claude mcp add local-rag --scope user --env BASE_DIR=/path/to/your/documents -- npx -y @damoqiongqiu/mcp-local-rag
```

**WorkBuddy** — 打开「设置 → 自定义连接器 → 添加自定义连接器」：

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

重启工具后即可使用：

```
你: "索引这个项目"
助手: 成功摄入 156 个文件（生成 2,847 个块）

你: "处理 API 限流的中间件在哪里？"
助手: 在 src/middleware/rateLimiter.ts 中。
      useRateLimiter() 函数，第 42-89 行...

你: "数据库连接池是怎么配置的？"
助手: 在 src/config/database.ts 里，
      createPool() 默认 max: 20, idle: 5...
```

**也可直接作为 CLI 使用——无需启动 MCP 服务器：**

```bash
npx @damoqiongqiu/mcp-local-rag ingest ./src/
npx @damoqiongqiu/mcp-local-rag query "认证中间件"
```

就这些。无需 Docker，无需 Python，无需配置服务器。

---

## 为什么会有这个项目

你的 AI 编程助手很聪明，但它不了解你的代码库。它不知道你的 middleware 怎么写的、数据库 schema 长什么样、错误处理用什么模式——除非你每次都复制粘贴大量上下文给它。

**代码库理解。** 索引你的项目后，AI 可以直接搜索函数定义、类实现、API 用法、配置模式——就像 Sourcegraph 的本地替代，但和你的 AI 工具深度集成。

**隐私。** 代码可能包含敏感逻辑或密钥。这个工具完全在本地运行——没有人能看到你的代码。

**精确匹配。** 纯语义搜索会遗漏 `useEffect` 或 `ERR_CONNECTION_REFUSED` 这样的精确术语。我们先用 tree-sitter 做 AST 级分块保证代码结构完整，再用关键词加权捕捉精确匹配。

**离线可用。** 配置完成之后无需联网即可使用。

---

## 使用方式

mcp-local-rag 提供两种接口：**MCP 服务器**（供 AI 编程工具使用）和 **CLI**（供终端直接使用）。

### 通过 MCP 使用

MCP 服务器提供 15 个工具：`query_documents`、`ingest_file`、`ingest_data`、`ingest_directory`、`delete_file`、`list_files`、`status`、`read_chunk_neighbors`、`find_definition`、`find_references`、`config`、`dedup_check`、`export_index`、`reindex_all`、`reindex_stale`。

#### 摄入文档

```
"摄入 /Users/me/docs/api-spec.pdf 这个文档"
```

支持 50+ 种代码文件格式（TypeScript、JavaScript、Python、Go、Rust、Java、C/C++ 等），以及 PDF、DOCX、TXT、Markdown、HTML。服务器提取文本、切分成块（文档用语义分块，代码用 AST 分块）、在本地生成嵌入向量，并将所有内容存储到本地向量数据库中。

重复摄入同一文件会自动替换旧版本。

##### 摄入含图表的 PDF（视觉模式）

含有图表、表格或示意图的 PDF 可以选择在文档索引中添加由本地 VLM 生成的描述文字，使视觉内容在同一个向量 + 全文检索的管道中获得可搜索的文本表示。描述文字是辅助性文本——不是图片搜索，不是 OCR，也不是对图片内容的真实转录。

**通过 MCP 使用**：

```
"用 visual: true 摄入 /Users/me/docs/api-spec.pdf"
```

**通过 CLI 使用**：

```bash
npx @damoqiongqiu/mcp-local-rag ingest ./docs/spec.pdf --visual
```

每条描述文字会以独立块的形式输出，格式为 `[Visual content on page N: …]`，与页面正文块一起存放。它流经现有的嵌入器和 FTS 索引——没有模式差异，也没有单独的索引。

视觉模式是可选功能；普通摄入不会加载 VLM。每个页面的 VLM 失败会被容忍——该页面仅以纯文本形式继续处理。

###### 选择视觉质量配置

视觉模式提供两种配置，每次摄入时选择：

| 配置             | 模型                                           | 磁盘缓存 | 单页推理耗时 | 适用场景                                             |
| ---------------- | ---------------------------------------------- | -------- | ------------ | ---------------------------------------------------- |
| `fast`（默认） | `HuggingFaceTB/SmolVLM-256M-Instruct`        | ~250 MB  | 基准         | 轻量视觉索引，快速首次运行。                         |
| `quality`      | `onnx-community/Qwen2.5-VL-3B-Instruct-ONNX` | ~2.9 GB  | ~2×`fast` | 图片内含文本（坐标轴标签、面板子标签、注释）的场景。 |

以上数据是在开发阶段使用项目测试 PDF 在 CPU 上测得的；可能随模型更新或因你的硬件而异。

**通过 MCP 使用** — `ingest_file` 接受可选的 `visualQuality` 参数（枚举：`'fast' | 'quality'`，默认 `'fast'`；`visual` 为 false 时忽略）：

```
"用 visual: true 和 visualQuality: 'quality' 摄入 /Users/me/docs/research-paper.pdf"
```

**通过 CLI 使用** — `--visual-quality fast|quality`（默认 `fast`；无 `--visual` 时静默忽略）：

```bash
npx @damoqiongqiu/mcp-local-rag ingest ./docs/research-paper.pdf --visual --visual-quality quality
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

#### 搜索代码

```
"处理 overfetch 的 middleware 在哪里定义的？"
"数据库连接池的配置参数有哪些？"
"找一下所有调用 createUser 的地方"
```

搜索使用语义相似度和关键词加权。这意味着搜索 `useEffect` 会找到包含该精确术语的代码，而不仅仅是语义相似的 React 概念。CodeChunker 将 scope chain 和 import 注入 embedding，让你搜索「这个组件用了哪些外部函数」也能精准命中。

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
"列出配置的基础目录中所有文件及其摄入状态"
"从 RAG 中删除 old-spec.pdf"
"显示 RAG 服务器状态"
```

用 `scope` 缩小 `list_files` 的列表范围——可以是一个路径前缀或前缀列表。结果限制为文件的路径等于或在前缀之下的文件（精确匹配或后代匹配）；例如 `"/docs/api"` 匹配 `/docs/api` 和 `/docs/api/auth.md`，但不匹配 `/docs/apiv2`。来自 `ingest_data` 的原始数据源会无视 scope 始终列出。在大数据量下，scope 还能通过跳过扫描时不在范围内的目录来加速列表。

#### AST 代码智能

`find_definition` 和 `find_references` 提供 IDE 级别的代码导航能力，基于摄入时 tree-sitter 提取的 AST 元数据（imports、函数定义、类定义、作用域链）。

```
"查找 handleIngestFile 的定义位置"
"查找所有引用 resolveEndpoint 的地方"
```

- **`find_definition(symbol, filePath?)`** — 在代码元数据中精确匹配符号名，返回定义的文件路径、行范围和所属作用域链。可选按文件路径过滤。
- **`find_references(symbol, filePath?)`** — 两阶段查找：(1) Import 元数据扫描 → 精确导入引用的 chunk；(2) FTS 全文搜索 → 所有文档中的符号文本提及。

#### 批量摄入

`ingest_directory` 一次性摄入整个目录。支持递归扫描、`.gitignore` 自动遵守、50+ 种文件格式。适合首次索引项目：

```
"摄入 ./src 下所有文件"
```

摄入进度通过 MCP 通知实时报告。重复摄入同一文件会自动替换旧版本。

#### 运行时配置

`config` 工具允许在 MCP 会话中读写配置，即时生效，无需重启服务器：

```
"查看当前配置"
"将模型切换为 Xenova/all-mpnet-base-v2"
```

支持热切换：`modelName`（嵌入模型）、`cacheDir`（模型缓存路径）、`baseDir` / `baseDirs`（搜索根目录）。切换模型会自动 dispose 旧 Embedder 并初始化新模型——注意切换模型会改变嵌入空间，需要 `reindex_all` 重建索引。

#### 系统管理工具

- **`dedup_check`** — SHA256 哈希 + Jaccard 相似度检测，发现重复/高度相似的已摄入文件。适合 monorepo 中多份拷贝的场景。
- **`export_index`** — 将全部索引内容导出为 JSON（文件 + chunk + metadata）。方便备份或迁移。
- **`reindex_all`** — 遍历所有已摄入文件，全量重新分块 + 重新嵌入。模型切换或分块参数变更后使用。
- **`reindex_stale`** — 仅重新摄入磁盘上有修改的文件（基于文件修改时间）。比 `reindex_all` 更快，适合日常同步。

### 网络与模型策略

#### 镜像自动检测

huggingface.co 在中国大陆无法直连。本工具内置三级镜像链自动回退：

```
huggingface.co → hf-mirror.com → modelscope.cn
```

启动时自动逐级探测（3s 超时 HEAD 请求），选择第一个可达且 API 完整的镜像。**无需手动设置 HF_ENDPOINT**——如果你有代理（`HTTPS_PROXY`），自动直连 huggingface.co；如果没有代理，自动切换到 hf-mirror.com；如果 hf-mirror API 也不可用，回退到 modelscope.cn。

环境变量：`HF_AUTO_MIRROR=false` 禁用自动检测，`HF_ENDPOINT=<url>` 强制指定镜像。

#### 文件监听

设置 `RAG_WATCH=true` 环境变量，MCP 服务器会在配置的 baseDirs 上启动递归文件监听（`fs.watch` + 500ms 防抖）。文件创建/修改时自动触发 `ingest_file`，文件删除时自动触发 `delete_file`。

#### 模型选择

支持 6 种嵌入模型（通过 model-registry 别名解析），通过 `--model-name` 或 `modelName` 配置热切换：

| 模型                                  | 别名          | 尺寸    | 维度 |
| ------------------------------------- | ------------- | ------- | ---- |
| `Xenova/all-MiniLM-L6-v2`           | `mini`      | ~90 MB  | 384  |
| `Xenova/all-MiniLM-L12-v2`          | —            | ~120 MB | 384  |
| `Xenova/all-mpnet-base-v2`          | `mpnet`     | ~420 MB | 768  |
| `Xenova/bge-small-en-v1.5`          | `bge-small` | ~130 MB | 384  |
| `Xenova/bge-base-en-v1.5`           | —            | ~420 MB | 768  |
| `Xenova/multi-qa-mpnet-base-dot-v1` | `multi-qa`  | ~420 MB | 768  |

通过 `RAG_DTYPE` 环境变量控制 ONNX 推理精度（`fp32`、`fp16`、`q8`）。默认 `fp32`，内存紧张时可用 `q8` 量化。注意切换 dtype 需要重建索引。

### 作为 CLI 使用

所有 MCP 工具也可以通过 CLI 命令使用——无需启动 MCP 服务器：

```bash
npx @damoqiongqiu/mcp-local-rag ingest ./docs/               # 批量摄入文件
npx @damoqiongqiu/mcp-local-rag query "认证 API"              # 搜索文档
npx @damoqiongqiu/mcp-local-rag query "auth" --scope /docs/api --scope /docs/guide  # 限制到路径前缀
npx @damoqiongqiu/mcp-local-rag read-neighbors --file-path /abs/path.md --chunk-index 5  # 扩展上下文
npx @damoqiongqiu/mcp-local-rag list                          # 显示摄入状态
npx @damoqiongqiu/mcp-local-rag list --scope /docs/api --scope /docs/guide  # 限制列表到路径前缀
npx @damoqiongqiu/mcp-local-rag status                        # 数据库统计
npx @damoqiongqiu/mcp-local-rag delete ./docs/old.pdf         # 删除内容
npx @damoqiongqiu/mcp-local-rag delete --source "https://..."  # 按来源 URL 删除
```

`query`、`read-neighbors`、`list`、`status` 和 `delete` 输出 JSON 到 stdout（可用于管道，如 `| jq`）。`ingest` 输出进度到 stderr。全局选项（`--db-path`、`--cache-dir`、`--model-name`）放在子命令之前。运行 `npx @damoqiongqiu/mcp-local-rag --help` 查看详情。

> ⚠️ CLI **不会**读取你的 MCP 客户端配置（`mcp.json`、`config.toml` 等）。通过命令行标志或环境变量配置 CLI，如下所示。

#### 配置

**CLI 标志** — 全局选项放在子命令之前，子命令选项放在子命令之后：

```bash
npx @damoqiongqiu/mcp-local-rag --db-path ./my-db query "auth" --base-dir ./docs
```

`--base-dir` 标志在 `ingest` 和 `list` 上可重复使用；每个根目录传一次：

```bash
npx @damoqiongqiu/mcp-local-rag ingest --base-dir ./docs --base-dir ./specs ./docs/readme.md
npx @damoqiongqiu/mcp-local-rag list --base-dir ./docs --base-dir ./specs
```

**环境变量** — 在你的 shell 中设置：

```bash
export DB_PATH=./my-db
export BASE_DIR=./docs
npx @damoqiongqiu/mcp-local-rag query "auth"
```

多根目录使用 `BASE_DIRS`（包含非空路径字符串的 JSON 数组）：

```bash
export BASE_DIRS='["/Users/me/Documents/work","/Users/me/Projects/specs"]'
npx @damoqiongqiu/mcp-local-rag list
```

配置按以下顺序解析：

1. CLI 标志（最高优先级）
2. 环境变量
3. 默认值

完整 CLI 标志、环境变量和默认值列表参见[配置](#配置)。

> ⚠️ **CLI 的 `--model-name` 必须与 MCP 服务器的 `MODEL_NAME` 环境变量匹配。** 使用不同的嵌入模型操作已有数据库会产生不兼容的向量，静默降低搜索质量。

---

## 搜索调优

根据你的场景调整以下参数：

| 变量                  | 默认值     | 描述                                                       |
| --------------------- | ---------- | ---------------------------------------------------------- |
| `RAG_HYBRID_WEIGHT` | `0.6`    | 关键词加权系数。0 = 仅语义，更高的值 = 更强的关键词权重。  |
| `RAG_GROUPING`      | （未设置） | `similar` 仅返回最相关组，`related` 返回前两个相关组。 |
| `RAG_MAX_DISTANCE`  | （未设置） | 过滤低相关度结果（例如`0.5`）。                          |
| `RAG_MAX_FILES`     | （未设置） | 限制结果到前 N 个文件（例如`1` 仅返回最佳单个文件）。    |

### 面向代码的调优（默认推荐）

对于代码库，增加关键词权重使精确标识符（`useEffect`、`ERR_*`、类名、函数名）主导排名：

```json
"env": {
  "BASE_DIR": "/path/to/your/project",
  "RAG_HYBRID_WEIGHT": "0.7",
  "RAG_GROUPING": "similar"
}
```

- `0.7` — 语义 + 关键词平衡
- `1.0` — 激进模式；精确匹配会大幅重新排序结果

### 面向文档的调优

对于长文本文档（技术规格、论文），降低关键词权重使语义理解为主：

```json
"env": {
  "BASE_DIR": "/path/to/your/documents",
  "RAG_HYBRID_WEIGHT": "0.4",
  "RAG_GROUPING": "related"
}
```

关键词加权在语义过滤**之后**应用，因此它能提升精度而不会引入无关匹配。

---

## 工作原理

**简要：**

- 代码文件通过 tree-sitter AST 分块，在函数/类/方法边界切分，注入 scope chain + import 上下文
- 文档按语义相似度分块，而非固定字符数
- 每个块通过 Transformers.js 在本地生成嵌入向量
- 搜索使用语义相似度加上关键词精确匹配的加权
- 结果根据相关性差距过滤，而非原始分数

### 详细说明

当你摄入文档时，解析器根据文件类型提取文本（PDF 通过 `mupdf`，DOCX 通过 `mammoth`，代码和文本文件通过 `parseContent`）。

分块策略按文件类型自动选择：

- **代码文件**：CodeChunker 使用 tree-sitter 将源码解析为 AST，然后在结构边界（函数、类、方法等）处分块。每个块包含 `contextualizedText`——原始代码加上作用域链和 import 上下文——从而对源代码实现更准确的语义搜索。
- **文档（PDF/DOCX/TXT/MD/HTML）**：语义分块器将文本拆分为句子，然后利用嵌入相似度将其分组。它会在语义转换处寻找自然的话题边界——将相关内容保留在一起，而不是在任意字符限制处切断。Markdown 代码块会保持完整——绝不会在代码块中间拆分。

每个块经过 Transformers.js 嵌入模型处理（默认 `all-MiniLM-L6-v2`，可通过 `MODEL_NAME` 配置），将文本转换为向量。向量存储在 LanceDB 中，这是一个基于文件的向量数据库，无需服务进程。

当你搜索时：

1. 查询使用同样模型转换为向量
2. 语义（向量）搜索找到最相关的块
3. 质量过滤器应用（距离阈值、分组）
4. 关键词匹配提升精确术语匹配的排名

关键词加权确保 `useEffect` 或错误码等精确术语匹配时排名更高。

---

## Agent Skills

[Agent Skills](https://agentskills.io/) 提供优化的提示词，帮助 AI 助手更有效地使用 RAG 工具。安装 Skills 以获得更好的查询形成、结果解读和摄入工作流：

```bash
# Claude Code（项目级别）
npx @damoqiongqiu/mcp-local-rag skills install --claude-code

# Claude Code（用户级别）
npx @damoqiongqiu/mcp-local-rag skills install --claude-code --global

# Codex
npx @damoqiongqiu/mcp-local-rag skills install --codex
```

Skills 包括：

- **查询优化**：更好的搜索查询构建
- **结果解读**：分数阈值和过滤指南
- **HTML 摄入**：格式选择和来源命名

---

## 配置

### 环境变量和 CLI 标志

MCP 服务器仅通过环境变量配置——通过 MCP 客户端的 `env` 块传入。CLI 接受相同的环境变量加上等效的标志（优先级：CLI 标志 > 环境变量 > 默认值）。

| 环境变量             | CLI 标志                 | 默认值                      | 描述                                                                                                                                                 |
| -------------------- | ------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_DIR`         | `--base-dir`（可重复） | 当前目录                    | 单个文档根目录（安全边界）。                                                                                                                         |
| `BASE_DIRS`        | —                       | （未设置）                  | JSON 数组形式的文档根目录（安全边界）。优先级高于`BASE_DIR`。                                                                                      |
| `DB_PATH`          | `--db-path`            | `./lancedb/`              | 向量数据库位置                                                                                                                                       |
| `CACHE_DIR`        | `--cache-dir`          | `./models/`               | 嵌入模型缓存目录。模型自动下载到`<CACHE_DIR>/Xenova/<模型名>/`。建议使用绝对路径。                                                                 |
| `MODEL_NAME`       | `--model-name`         | `Xenova/all-MiniLM-L6-v2` | HuggingFace 模型 ID（[可用模型](https://huggingface.co/models?library=transformers.js&pipeline_tag=feature-extraction)）                              |
| `MAX_FILE_SIZE`    | `--max-file-size`      | `104857600`（100MB）      | 最大文件大小（字节）                                                                                                                                 |
| `CHUNK_MIN_LENGTH` | `--chunk-min-length`   | `50`                      | 最小块长度（字符数，1–10000）                                                                                                                       |
| `RAG_DEVICE`       | —                       | `cpu`                     | 执行设备。直接传给 ONNX Runtime。                                                                                                                    |
| `RAG_DTYPE`        | —                       | `fp32`                    | 嵌入向量量化数据类型。                                                                                                                               |
| `HTTPS_PROXY`      | —                       | （未设置）                  | HTTP 代理地址，用于下载模型（如`http://127.0.0.1:7890`）。v0.18.5 通过 `setGlobalDispatcher` 全局生效，Node.js 22 所有网络请求均走代理。         |
| `HTTP_PROXY`       | —                       | （未设置）                  | 同上，HTTP 协议的别名。两者同时设置时`HTTPS_PROXY` 优先。                                                                                          |
| `HF_ENDPOINT`      | —                       | `https://huggingface.co`  | HuggingFace 镜像端点（v0.16.2+）。设置后跳过自动镜像检测。                                                                                           |
| `HF_AUTO_MIRROR`   | —                       | `true`                    | v0.18.2 自动镜像检测开关。设为`false` 禁用。默认开启，首次下载前自动探测三级镜像链：`huggingface.co` → `hf-mirror.com` → `modelscope.cn`。 |

**模型选择建议：**

- 多语言文档 → 如 `onnx-community/embeddinggemma-300m-ONNX`（支持 100+ 语言）
- 科研论文 → 如 `sentence-transformers/allenai-specter`（支持引文感知）
- 代码仓库 → 默认模型通常足够；关键词加权作用更大

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

---

<details>
<summary><strong>性能</strong></summary>

在 MacBook Pro M1（16GB RAM）、Node.js 22 上测试：

**查询速度**：~1.2 秒（10,000 个块，p90 < 3s）

**摄入（10MB PDF）**：

- PDF 解析：~8s
- 分块：~2s
- 嵌入生成：~30s
- 数据库写入：~5s

**内存**：空闲 ~200MB，峰值 ~800MB（摄入 50MB 文件时）

**并发**：处理 5 个并行查询无性能下降

</details>

<details>
<summary><strong>故障排查</strong></summary>

### "没有找到结果"

文档必须先摄入。运行 `"列出所有已摄入的文件"` 进行验证。

### 模型下载失败

**症状**：启动日志中出现 `fetch failed` 或 `Unable to get model file path or buffer`，`status` 显示 `searchMode: fts`（而非 `hybrid`）。

**原因与排查**：

1. **网络无法直连 HuggingFace** — 如果你在中国大陆或受限网络环境中，直连 `huggingface.co` 会超时。

   **首选方案：配置代理**（v0.18.5+ 已全局生效）：

   ```json
   "env": {
     "HTTPS_PROXY": "http://127.0.0.1:7890"
   }
   ```

   注意：需要在 MCP 客户端配置中设置此变量，而非在终端中 export。v0.18.5 通过 `setGlobalDispatcher` 确保 Node.js 22 的所有网络请求都走代理。

   **备选方案：自动镜像回退**（v0.18.2+ 无需配置）：
   mcp-local-rag 默认自动探测三级镜像链：`huggingface.co` → `hf-mirror.com` → `modelscope.cn`，逐级回退直到找到可用镜像。整个过程中无需任何配置。
2. **模型文件未写入 `CACHE_DIR`** — 首次运行时会下载约 80MB 的 ONNX 模型到 `CACHE_DIR/Xenova/all-MiniLM-L6-v2/`。确认该目录存在且包含 `onnx/model_quantized.onnx` 等文件。如果之前用不同的 `CACHE_DIR` 下载过模型，更新路径指向已有缓存即可避免重复下载：

   ```json
   "env": {
     "CACHE_DIR": "/path/to/your/existing/models/"
   }
   ```

   默认值 `./models/` 是相对于工作目录的，建议使用绝对路径。
3. **自动镜像回退失败** — 如果你的网络环境完全隔离且未配置代理，可以手动设置 `HF_ENDPOINT=https://modelscope.cn`，魔搭社区完整托管了所有 ONNX 模型文件。或者[手动下载模型](https://huggingface.co/Xenova/all-MiniLM-L6-v2)放入 `CACHE_DIR`。
4. **npx 缓存了旧版本** — 如果之前用过旧版，npx 可能缓存了不支持代理的版本。清除缓存后重启：

   ```bash
   rm -rf ~/.npm/_npx/
   ```

也可以[手动下载模型](https://huggingface.co/Xenova/all-MiniLM-L6-v2)放入 `CACHE_DIR`。

### "文件太大"

默认限制为 100MB。拆分大文件或增加 `MAX_FILE_SIZE`。

### 查询缓慢

通过 `status` 检查块数量。包含大量块的大文档可能使查询变慢。考虑拆分为更小的文件。

### "路径不在 BASE_DIR 内"

确保文件路径位于配置的根目录之一。使用绝对路径。

### "BASE_DIRS must be a JSON array..."

`BASE_DIRS` 仅接受包含一个或多个非空路径字符串的 JSON 数组：

- 有效：`BASE_DIRS='["/Users/me/work","/Users/me/specs"]'`
- 无效：`BASE_DIRS=/a:/b`（不支持分隔符语法）
- 无效：`BASE_DIRS='[]'`（空数组）

### MCP 客户端看不到工具

1. 验证配置文件语法
2. **WorkBuddy 用户**：检查「设置 → 自定义连接器」中该连接器的「信任」按钮是否已点击。未经信任的自定义连接器会被静默阻止。
3. 完全重启客户端（Mac 上 Cmd+Q 退出 Cursor）
4. 直接测试：`npx @damoqiongqiu/mcp-local-rag` 应能正常运行，无错误

### 重建索引

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

</details>

<details>
<summary><strong>常见问题</strong></summary>

**这真的私密吗？**
是的。在模型下载之后，没有任何数据离开你的机器。可用网络监控验证。

**可以离线使用吗？**
可以，只要所需模型已缓存到本地。

**与云端 RAG 相比如何？**
云端服务在规模上提供更好的准确性，但需要将数据发送到外部。这个工具用一些准确性换取了完全的隐私和零运行时成本。

**支持哪些文件格式？**
50+ 种代码文件扩展名（TypeScript、JavaScript、Python、Go、Rust、Java、Kotlin、C/C++ 等），以及 PDF、DOCX、TXT、Markdown、HTML（通过 `ingest_data`）。暂不支持：Excel、PowerPoint、图片。

**能否更换嵌入模型？**
可以，但必须删除数据库并重新摄入所有文档。不同模型产生不兼容的向量维度。

**GPU 加速？**
可选，通过 `RAG_DEVICE` 开启。GPU 支持高度依赖你的系统、Node.js 版本和底层 ONNX 后端。

**多用户支持？**
不支持。专为单用户本地访问设计。

**如何备份？**
复制 `DB_PATH` 目录（默认 `./lancedb/`）。

</details>

<details>
<summary><strong>开发</strong></summary>

### 从源码构建

```bash
git clone https://github.com/damoqiongqiu/mcp-local-rag.git
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
  cli/          # CLI 子命令
  parser/       # PDF、DOCX、TXT、MD 及代码文件解析
  chunker/      # 文本分块（文档用 SemanticChunker，代码用 CodeChunker）
  embedder/     # Transformers.js 嵌入
  vectordb/     # LanceDB 操作
  __tests__/    # 测试套件
```

</details>

---

## 贡献

欢迎贡献！参见 [CONTRIBUTING.md](CONTRIBUTING.md) 了解环境搭建和指南。

## 许可证

MIT License。免费用于个人和商业用途。

## 博客文章

- [Building a Local RAG for Agentic Coding](https://www.norsica.jp/blog/local-rag-agentic-coding) — 语义分块和混合搜索设计的技术深度解析。

## 致谢

使用 [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic、[LanceDB](https://lancedb.com/) 和 [Transformers.js](https://huggingface.co/docs/transformers.js) 构建。
