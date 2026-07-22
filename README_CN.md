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

## 目录

1. [特性](#1-特性)
2. [快速开始](#2-快速开始)
   - 2.1 [配置 AI 编程工具](#21-配置-ai-编程工具)
   - 2.2 [CLI 快速上手](#22-cli-快速上手)
   - 2.3 [首次索引项目](#23-首次索引项目)
3. [核心概念](#3-核心概念)
   - 3.1 [双策略分块](#31-双策略分块)
   - 3.2 [混合搜索](#32-混合搜索)
   - 3.3 [安全边界](#33-安全边界)
4. [MCP 工具参考](#4-mcp-工具参考)
   - 4.1 [摄入工具](#41-摄入工具)
   - 4.2 [搜索工具](#42-搜索工具)
   - 4.3 [管理工具](#43-管理工具)
   - 4.4 [代码智能](#44-代码智能)
   - 4.5 [系统工具](#45-系统工具)
5. [CLI 命令行](#5-cli-命令行)
   - 5.1 [基础命令](#51-基础命令)
   - 5.2 [CLI 配置](#52-cli-配置)
6. [网络与模型](#6-网络与模型)
   - 6.1 [镜像自动检测](#61-镜像自动检测)
   - 6.2 [模型选择](#62-模型选择)
   - 6.3 [文件监听](#63-文件监听)
7. [搜索调优](#7-搜索调优)
8. [性能调优](#8-性能调优)
   - 8.1 [量化精度](#81-量化精度rag_dtype)
   - 8.2 [执行设备](#82-执行设备rag_device)
   - 8.3 [最小块长度](#83-最小块长度chunk_min_length)
   - 8.4 [推荐配置组合](#84-推荐配置组合)
9. [配置参考](#9-配置参考)
10. [故障排查](#10-故障排查)
11. [开发](#11-开发)

---

## 1. 特性

- **智能双策略分块** — 代码用 AST 级分块（tree-sitter 在函数/类边界切分，注入作用域链 + import 上下文），文档用语义分块（按含义切分而非字符数）
- **语义搜索 + 关键词加权** — 先向量搜索，再关键词提升精确排名。`useEffect`、错误码等精确术语优先召回
- **15 个 MCP 工具** — 涵盖摄入、搜索、管理、代码智能、系统运维全生命周期
- **AST 代码智能** — `find_definition` / `find_references` 提供 IDE 级代码导航
- **三级镜像自动回退** — `huggingface.co → hf-mirror.com → modelscope.cn`，国内网络零配置
- **完全本地运行** — 无 API Key、无云端、数据不离开机器
- **零摩擦上手** — 一条 `npx` 命令。无需 Docker、Python 或服务器

---

## 2. 快速开始

### 2.1 配置 AI 编程工具

**Cursor** — `~/.cursor/mcp.json`：

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

**Claude Code** — 终端运行：

```bash
claude mcp add local-rag --scope user --env BASE_DIR=/path/to/your/project -- npx -y @damoqiongqiu/mcp-local-rag
```

**Codex** — `~/.codex/config.toml`：

```toml
[mcp_servers.local-rag]
command = "npx"
args = ["-y", "@damoqiongqiu/mcp-local-rag"]

[mcp_servers.local-rag.env]
BASE_DIR = "/path/to/your/project"
```

**WorkBuddy** —「设置 → 自定义连接器 → 添加」：

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

> ⚠️ WorkBuddy 用户必须在连接器列表中点击「信任」，否则服务器会被静默阻止。

### 2.2 CLI 快速上手

不接 MCP 也能用——直接在终端运行：

```bash
npx @damoqiongqiu/mcp-local-rag ingest ./src/
npx @damoqiongqiu/mcp-local-rag query "认证中间件"
npx @damoqiongqiu/mcp-local-rag status
```

无需 Docker、Python 或服务器。

### 2.3 首次索引项目

配置完成后，在 AI 助手里这样说：

```
你: "索引当前项目的 src 目录"
助手: 成功摄入 156 个文件（生成 2,847 个块）

你: "处理 API 限流的中间件在哪里？"
助手: 在 src/middleware/rateLimiter.ts — useRateLimiter()，第 42-89 行

你: "数据库连接池怎么配置的？"
助手: 在 src/config/database.ts — createPool() 默认 max: 20, idle: 5
```

---

## 3. 核心概念

### 3.1 双策略分块

文件按类型自动选择分块策略：

- **代码文件**（50+ 语言）— `CodeChunker` 用 tree-sitter 解析 AST，在函数/类/方法边界切分。每个块注入作用域链和 import 上下文，写在 `contextualizedText` 中供嵌入使用。
- **文档**（PDF/DOCX/TXT/MD/HTML）— `SemanticChunker` 按嵌入相似度寻找自然话题边界，而非固定字符数切分。Markdown 代码块始终保持完整。

### 3.2 混合搜索

搜索 = 语义相似度 + 关键词加权（`RAG_HYBRID_WEIGHT`，默认 0.6）：

1. 查询向量化 → 语义搜索找最相关块
2. 质量过滤（距离阈值、分组）
3. 关键词匹配提升精确术语排名

结果是 `useEffect` 这种精确标识符不会被淹没在语义近似结果中。

### 3.3 安全边界

只有位于 `BASE_DIR` / `BASE_DIRS` 下的文件才能被摄入、列出或删除。符号链接被解析后若指向根目录外则拒绝。同级前缀（如 `/foo/bar` 根下 `/foo/barista`）也会被拒——防止路径遍历攻击。

---

## 4. MCP 工具参考

MCP 服务器共 15 个工具，按功能分为 5 类。

### 4.1 摄入工具

| # | 工具 | 用途 | 典型用法 |
|---|------|------|---------|
| 1 | `ingest_file` | 摄入单个文件（PDF/DOCX/TXT/MD/代码） | `"摄入 ./docs/api-spec.pdf"` |
| 2 | `ingest_data` | 摄入内存中的文本/HTML | `"获取这个网页并把 HTML 摄入"` |
| 3 | `ingest_directory` | 批量摄入整个目录 | `"摄入 ./src 下所有文件"` |

**`ingest_file`** 支持 50+ 种代码语言。PDF 可选视觉模式—本地 VLM 为图表页生成描述文字，使视觉内容可搜索。视觉模式提供两种配置：

| 配置 | 模型 | 缓存 | 适用场景 |
|------|------|------|---------|
| `fast`（默认） | SmolVLM-256M | ~250 MB | 轻量视觉索引 |
| `quality` | Qwen2.5-VL-3B-ONNX | ~2.9 GB | 图片含文本的场景 |

```bash
# CLI
npx @damoqiongqiu/mcp-local-rag ingest ./spec.pdf --visual --visual-quality quality
# MCP
"用 visual: true, visualQuality: 'quality' 摄入 ./spec.pdf"
```

**`ingest_data`** 通过 Readability 提取 HTML 正文 → Markdown → 索引。适合 AI 助手抓取的网页内容。

**`ingest_directory`** 递归扫描，遵守 `.gitignore`，实时进度通知。重复摄入自动替换旧版本。

### 4.2 搜索工具

| # | 工具 | 用途 | 关键参数 |
|---|------|------|---------|
| 4 | `query_documents` | 混合搜索（语义 + 关键词） | `query`, `limit`, `scope`, `highlightContext`, `fromTimestamp` |
| 5 | `read_chunk_neighbors` | 展开搜索结果的上下文 | `filePath`, `chunkIndex`, `before`, `after` |

**`query_documents`** 的 `scope` 参数支持单前缀或前缀列表，将结果限制在指定路径子树中。`highlightContext` 返回命中词周围的片段。

**`read_chunk_neighbors`** 默认前后各 2 个块（类似 `grep -C 2`），最大各 50。

### 4.3 管理工具

| # | 工具 | 用途 |
|---|------|------|
| 6 | `list_files` | 列出文件及摄入状态（`ingested: true/false`） |
| 7 | `delete_file` | 删除文件（按路径或来源 URL） |
| 8 | `status` | 查看索引统计：文档数、块数、内存、搜索模式 |

`list_files` 的 `scope` 参数与搜索一致，且能加速大目录扫描。

### 4.4 代码智能

| # | 工具 | 用途 | 输入 |
|---|------|------|------|
| 9 | `find_definition` | 查找符号定义位置 | 精确符号名 |
| 10 | `find_references` | 查找所有引用（import + 文本） | 符号名 |

两个工具都依赖摄入时 tree-sitter 提取的 AST 元数据（imports、entities、scope）。**注意**：仅对 `CodeChunker` 摄入的代码文件生效——用旧版本摄入的文件不含 AST 元数据，需要 `reindex_all` 重建。

**`find_references`** 使用两阶段策略：(1) `codeMeta.imports` 精确匹配 → (2) FTS 全文搜索符号名。结果按 (filePath, chunkIndex) 去重，import 引用优先。

### 4.5 系统工具

| # | 工具 | 用途 |
|---|------|------|
| 11 | `config` | **运行时**热读写配置（无需重启） |
| 12 | `dedup_check` | SHA256 + Jaccard 检测重复/相似文件 |
| 13 | `export_index` | 导出整个索引为 JSON（备份/迁移） |
| 14 | `reindex_all` | 全量重新分块 + 重新嵌入（模型切换后） |
| 15 | `reindex_stale` | 仅重摄入磁盘上有修改的文件（增量同步） |

**`config` 支持热切换** `hybridWeight`、`modelName`、`cacheDir` 等。切换模型会自动 dispose 旧 Embedder 并加载新模型（注意切换模型后需 `reindex_all`）。

**`dedup_check`** 在 monorepo 中特别有用——spot ↔ futures 的镜像代码通常会被检出。

---

## 5. CLI 命令行

### 5.1 基础命令

```bash
# 摄入
npx @damoqiongqiu/mcp-local-rag ingest ./src/

# 搜索（支持 scope 限制）
npx @damoqiongqiu/mcp-local-rag query "认证 API"
npx @damoqiongqiu/mcp-local-rag query "auth" --scope /docs/api

# 上下文展开
npx @damoqiongqiu/mcp-local-rag read-neighbors --file-path /abs/path.md --chunk-index 5

# 管理
npx @damoqiongqiu/mcp-local-rag list --scope /docs/api
npx @damoqiongqiu/mcp-local-rag status
npx @damoqiongqiu/mcp-local-rag delete ./docs/old.pdf
npx @damoqiongqiu/mcp-local-rag delete --source "https://..."
```

`query`、`read-neighbors`、`list`、`status`、`delete` 输出 JSON 到 stdout（可管道 `| jq`）。`ingest` 输出进度到 stderr。

全局选项（`--db-path`、`--cache-dir`、`--model-name`）放在子命令之前：

```bash
npx @damoqiongqiu/mcp-local-rag --help
```

> ⚠️ CLI 不读取 MCP 客户端配置（`mcp.json` 等）。需要通过命令行标志或环境变量独立配置。

### 5.2 CLI 配置

**命令行标志** — 全局选项在前，子命令选项在后：

```bash
npx @damoqiongqiu/mcp-local-rag --db-path ./my-db query "auth" --base-dir ./docs
```

`--base-dir` 在 `ingest` 和 `list` 上可重复：

```bash
npx @damoqiongqiu/mcp-local-rag ingest --base-dir ./docs --base-dir ./specs ./docs/readme.md
```

**环境变量**：

```bash
export DB_PATH=./my-db
export BASE_DIR=./docs
npx @damoqiongqiu/mcp-local-rag query "auth"
```

多根目录用 `BASE_DIRS`（JSON 数组）：

```bash
export BASE_DIRS='["/Users/me/work","/Users/me/specs"]'
```

配置优先级：CLI 标志 > 环境变量 > 默认值。

---

## 6. 网络与模型

### 6.1 镜像自动检测

huggingface.co 在国内无法直连。内置三级镜像链自动回退：

```
huggingface.co → hf-mirror.com → modelscope.cn
```

启动时逐级 HEAD 探测（3s 超时），选择第一个可达且 API 完整的镜像：

- **有代理**（`HTTPS_PROXY`）→ 直连 huggingface.co
- **无代理** → 自动切 hf-mirror.com
- **hf-mirror API 不可用** → 回退 modelscope.cn

**无需手动设置 `HF_ENDPOINT`**。如果确实需要手动控制：

| 环境变量 | 作用 |
|---------|------|
| `HF_AUTO_MIRROR=false` | 禁用自动检测，只用 huggingface.co |
| `HF_ENDPOINT=<url>` | 强制指定镜像，跳过自动检测 |

> v0.18.5+ 通过 `setGlobalDispatcher(ProxyAgent)` 实现，Node.js 22 所有网络请求均走代理。

### 6.2 模型选择

支持 6 种嵌入模型，通过 `--model-name` 或 `modelName` 配置别名解析：

| 模型 | 别名 | 尺寸 | 维度 |
|------|------|------|------|
| `Xenova/all-MiniLM-L6-v2`（默认） | `mini` | ~90 MB | 384 |
| `Xenova/all-MiniLM-L12-v2` | — | ~120 MB | 384 |
| `Xenova/bge-small-en-v1.5` | `bge-small` | ~130 MB | 384 |
| `Xenova/all-mpnet-base-v2` | `mpnet` | ~420 MB | 768 |
| `Xenova/bge-base-en-v1.5` | — | ~420 MB | 768 |
| `Xenova/multi-qa-mpnet-base-dot-v1` | `multi-qa` | ~420 MB | 768 |

**选择建议**：代码仓库用默认模型 + 高关键词权重即可；多语言文档考虑 `embeddinggemma-300m`。

**RAG_DTYPE** 控制 ONNX 推理精度（`fp32` / `fp16` / `q8`）。默认 `fp32`；内存紧张时用 `q8` 量化。⚠️ 切换模型或 dtype 后需删除 `DB_PATH` 并重建索引。

### 6.3 文件监听

设置 `RAG_WATCH=true`，服务器会在 baseDirs 上启动 `fs.watch` 递归监听（500ms 防抖）：

- 文件创建/修改 → 自动 `ingest_file`
- 文件删除 → 自动 `delete_file`

适合开发中频繁变更的项目。

---

## 7. 搜索调优

| 变量 | 默认 | 说明 |
|------|------|------|
| `RAG_HYBRID_WEIGHT` | `0.6` | 关键词权重：0 = 纯语义，1 = 纯关键词 |
| `RAG_GROUPING` | 无 | `similar` = 仅最相关组，`related` = 前两组 |
| `RAG_MAX_DISTANCE` | 无 | 过滤低相关度（如 `0.5`） |
| `RAG_MAX_FILES` | 无 | 限制到前 N 个文件 |

**代码库调优（推荐）**：提高关键词权重，精确标识符主导排名：

```json
{ "RAG_HYBRID_WEIGHT": "0.7", "RAG_GROUPING": "similar" }
```

**文档调优**：降低关键词权重，语义理解为主：

```json
{ "RAG_HYBRID_WEIGHT": "0.4", "RAG_GROUPING": "related" }
```

关键词加权在语义过滤**之后**应用——提升精度，不引入噪音。

---

## 8. 性能调优

除了搜索精度的调整，推理性能同样可控。三个维度的优化都通过环境变量实现，无需改代码：

### 8.1 量化精度（`RAG_DTYPE`）

控制 ONNX 模型推理时的数值精度。对 `all-MiniLM-L6-v2` 提供三档：

| 值 | 模型体积 | 推理速度 | 内存 | 精度损失 | 适用场景 |
|----|---------|---------|------|---------|---------|
| `fp32`（默认） | ~90 MB | 基准 | ~80 MB | 无 | 首次使用、追求最高精度 |
| `fp16` | ~45 MB | 快 20-30% | ~45 MB | 几乎无 | **推荐**：日常使用 |
| `q8` | ~45 MB | 快 30-50% | ~45 MB | 轻微 | 内存紧张、大项目批量摄入 |

```json
"env": { "RAG_DTYPE": "fp16", "BASE_DIR": "..." }
```

⚠️ 切换 dtype 后**必须重建索引**（嵌入空间不同，旧向量不兼容）。

**如何验证生效：** 重启后在 MCP 中调 `status`，查看 `dtype` 字段。如果显示你设置的值（如 `"fp16"`），说明生效。

**失败怎么办：** 如果模型不支持所选的 dtype，启动时会抛出 `EmbeddingError`，消息会列出该模型支持的 dtype 列表。常见原因是旧模型未提供 `q8` 量化——换 `fp16` 即可。

### 8.2 执行设备（`RAG_DEVICE`）

控制 ONNX Runtime 使用哪个执行后端：

| 值 | 后端 | 说明 |
|----|------|------|
| `cpu`（默认） | CPU | 最稳定，无额外依赖 |
| `webgpu` | GPU（WebGPU） | ⚠️ 实验性：M1/M2 Mac 走 Metal，NVIDIA 走 Vulkan |

```json
"env": { "RAG_DEVICE": "webgpu", "RAG_DTYPE": "fp16", "BASE_DIR": "..." }
```

⚠️ 切换 device 同样改变嵌入空间——需要重建索引。**且可叠加 `RAG_DTYPE`**：`fp16 + webgpu` 可获得模型减半 + GPU 加速的双重收益。

**如何验证生效：** MCP 启动日志应显示 `Loading model on device "webgpu"`，`status` 的 `device` 字段显示 `"webgpu"`。

**失败怎么办：**
- 启动时报 `Unsupported device` → WebGPU 在你的环境不可用，改回 `"cpu"`
- 启动成功但推理报错 → 可能是 ONNX WebGPU 后端 Bug，改回 `"cpu"`
- 删除 `RAG_DEVICE` 那行即可回退，不影响其他配置

### 8.3 最小块长度（`CHUNK_MIN_LENGTH`）

摄入时过滤短于该值的 chunk。默认 `50` 保留几乎所有片段；提高到 `200` 可砍掉 30-40% 的无意义碎片。

```json
"env": { "CHUNK_MIN_LENGTH": "200", "BASE_DIR": "..." }
```

⚠️ 一刀切：重要的短函数或配置片段也可能被丢弃。需要重建索引。建议值 `100-200`。

### 8.4 推荐配置组合

| 场景 | 配置 |
|------|------|
| 日常开发 | `RAG_DTYPE=fp16` |
| 大项目 + M1/M2 Mac | `RAG_DTYPE=fp16, RAG_DEVICE=webgpu` |
| 内存紧张 | `RAG_DTYPE=q8` |

所有变更后都需要 `reindex_all`（MCP）或重跑 `ingest`（CLI）。如遇失败，删除新加的 env 行即回退默认值。

---

## 9. 配置参考

MCP 服务器仅通过环境变量配置。CLI 同时支持标志和环境变量（标志优先）。

| 环境变量 | CLI 标志 | 默认 | 说明 |
|---------|---------|------|------|
| `BASE_DIR` | `--base-dir`（可重复） | `cwd` | 文档根目录 |
| `BASE_DIRS` | — | 无 | JSON 数组根目录，优先于 `BASE_DIR` |
| `DB_PATH` | `--db-path` | `./lancedb/` | 向量数据库位置 |
| `CACHE_DIR` | `--cache-dir` | `./models/` | 模型缓存目录。建议绝对路径 |
| `MODEL_NAME` | `--model-name` | `all-MiniLM-L6-v2` | 嵌入模型 ID |
| `MAX_FILE_SIZE` | `--max-file-size` | 100MB | 单文件上限（字节） |
| `CHUNK_MIN_LENGTH` | `--chunk-min-length` | `50` | 最小块长度（1–10000 字符） |
| `RAG_DEVICE` | — | `cpu` | ONNX 执行设备 |
| `RAG_DTYPE` | — | `fp32` | 量化精度（`fp32`/`fp16`/`q8`） |
| `HTTPS_PROXY` | — | 无 | 模型下载代理。v0.18.5+ 全局生效 |
| `HF_ENDPOINT` | — | `huggingface.co` | 手动指定镜像 |
| `HF_AUTO_MIRROR` | — | `true` | 自动镜像检测开关 |
| `RAG_WATCH` | — | 无 | 文件监听（`true`/`1`） |

**根目录解析顺序**：CLI `--base-dir` > `BASE_DIRS` > `BASE_DIR` > `cwd`。`BASE_DIRS` 和 `BASE_DIR` 同时设置时 `BASE_DIRS` 优先，绝不合并。仅支持 JSON 数组语法——不支持分隔符。

---

## 10. 故障排查

<details open>
<summary><strong>模型下载失败</strong></summary>

**症状**：`fetch failed`、`searchMode: fts`（而非 `hybrid`）。

**原因与方案**：

1. **网络受限**（中国大陆等）→ 代理优先：
   ```json
   "env": { "HTTPS_PROXY": "http://127.0.0.1:7890" }
   ```
   在 MCP 客户端配置中设置，非终端 export。v0.18.5 通过 `setGlobalDispatcher` 全局生效。

2. **自动镜像回退**（v0.18.2+ 默认）— 三级链逐级探测，通常不需要手动干预。

3. **手动指定** — `HF_ENDPOINT=https://modelscope.cn` 或 [手动下载模型](https://huggingface.co/Xenova/all-MiniLM-L6-v2) 放入 `CACHE_DIR`。

4. **npx 缓存了旧版本** — 清除后重启：
   ```bash
   rm -rf ~/.npm/_npx/
   ```

</details>

<details>
<summary><strong>MCP 客户端看不到工具</strong></summary>

1. 验证配置文件语法
2. WorkBuddy 用户：确认已点击「信任」
3. 完全重启客户端（Mac：Cmd+Q）
4. 直接测试：`npx @damoqiongqiu/mcp-local-rag` 无错误

</details>

<details>
<summary><strong>重建索引</strong></summary>

切换模型或数据库损坏时：

1. 停止 MCP 服务
2. 删除 `DB_PATH` 目录（默认 `./lancedb/`）——不影响源代码或模型缓存
3. 重启 MCP → 自动重建
4. 批量重新摄入：
   ```bash
   npx @damoqiongqiu/mcp-local-rag ingest ./src/
   ```

</details>

<details>
<summary><strong>常见问题</strong></summary>

- **真的私密吗？** 是。模型下载后无数据离开机器。
- **离线可用吗？** 只要模型已缓存就可以。
- **支持格式？** 50+ 代码语言 + PDF/DOCX/TXT/MD/HTML。不支持 Excel、PPT、图片。
- **GPU 加速？** 可选，通过 `RAG_DEVICE` 开启。
- **如何备份？** 复制 `DB_PATH` 目录。

</details>

---

## 11. 开发

```bash
git clone https://github.com/damoqiongqiu/mcp-local-rag.git
cd mcp-local-rag
pnpm install
```

```bash
pnpm test              # 全部测试
pnpm run type-check    # TypeScript 检查
pnpm run check:fix     # Lint + 格式化
pnpm run check:all     # 全量 CI
```

```text
src/
  index.ts      # 入口
  server/       # MCP 工具处理器
  cli/          # CLI 子命令
  parser/       # PDF/DOCX/TXT/MD/代码解析
  chunker/      # SemanticChunker + CodeChunker
  embedder/     # Transformers.js 嵌入
  vectordb/     # LanceDB 操作
  utils/        # 共享工具（安全边界、扫描、scope）
  __tests__/    # 测试
```

---

## 许可证

MIT License。免费用于个人和商业用途。

## 致谢

基于 [Model Context Protocol](https://modelcontextprotocol.io/) (Anthropic)、[LanceDB](https://lancedb.com/)、[Transformers.js](https://huggingface.co/docs/transformers.js) 构建。
