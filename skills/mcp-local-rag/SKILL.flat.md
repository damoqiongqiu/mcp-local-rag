---
name: mcp-local-rag
version: 1.0.0
description: "本地代码智能引擎 — AST 级代码语义搜索（50+ 语言），关键词+向量混合检索，代码留存在本地不上传。也支持 PDF/DOCX/TXT/MD 等文档格式。"
category: 开发工具
platforms: [WorkBuddy, Claude Code, Cursor]
author: damoqiongqiu
permissions:
  - 文件系统访问（读取/索引本地代码和文档）
  - 网络访问（首次下载 embedding 模型约 80MB）
---

# mcp-local-rag —— 本地代码智能引擎

基于 MCP 协议，为 AI 编程助手提供本地代码库语义搜索。AST 级代码分块（tree-sitter）+ 向量语义搜索 + BM25 关键词加权，精准命中函数、类、API 定义。所有数据留存在本地。

---

## ⛔ MANDATORY RULES

1. **文件路径必须为绝对路径**：`filePath` / `scope` 参数必须传绝对路径，相对路径静默不匹配。
2. **首次运行需下载模型**：默认 embedding 模型约 80MB，从 HuggingFace 下载。国内可能需要代理或镜像——详见下方「国内网络注意事项」。
3. **模型一致性**：切换 `MODEL_NAME` 会改变向量空间，已索引数据需重新摄入。

---

## 📋 意图路由表

| 用户意图 | 章节 | 典型触发词 |
|---------|------|-----------|
| 搜索 / 查找代码 | [搜索与查询](#搜索与查询) | 「这个函数在哪」「XX 组件怎么定义的」「找一下 middleware」「谁调用了这个方法」 |
| 搜索 / 查找文档 | [搜索与查询](#搜索与查询) | 「找一下」「搜索」「查」「有没有提到」 |
| 索引代码库 / 摄入文件 | [摄入与索引](#摄入与索引) | 「索引这个项目」「存一下」「导入」「把这个文件加进去」 |
| 管理 / 列出 / 删除 | [管理与维护](#管理与维护) | 「列一下」「有哪些文件」「删掉」「统计」「状态」 |
| 配置 / 排障 / 安装 | [安装与排障](#安装与排障) | 「装不上」「连不上」「配一下」「下载失败」「模型在哪」「国内网络」 |

---

## 🛠️ 支持的格式

| 格式 | 分块策略 | 说明 |
|-----|---------|------|
| 代码文件 | CodeChunker | AST 级分块，在函数/类/方法边界切分，含 scope chain 上下文 |
| TXT / MD | SemanticChunker | 纯文本语义分块 |
| PDF | SemanticChunker | 文本提取 + 可选视觉 caption（VLM） |
| DOCX | SemanticChunker | mammoth 提取正文 |
| HTML (ingest_data) | SemanticChunker | 自动提取正文，去除导航/广告 |

**代码文件支持的语言**：TypeScript (.ts/.tsx/.mts/.cts), JavaScript (.js/.jsx/.mjs/.cjs), Python (.py/.pyi), Go (.go), Rust (.rs), Java (.java) —— 基于 tree-sitter AST 解析。C/C++ 等暂走纯文本分块。

---

# 搜索与查询

## Tools

### query_documents —— 混合搜索

语义向量搜索 + BM25 关键词搜索双路混合。返回与查询最相关的文档片段（chunk）。

```
query_documents({ query: string, limit?: number, scope?: string | string[] })
```

#### Score 解读

分数越低 = 匹配越好。

| Score | 处理方式 |
|-------|---------|
| < 0.3 | 直接使用，高度相关 |
| 0.3–0.5 | 话题相关（提到相同概念/实体）时使用 |
| 0.5–0.7 | 仅在直接回答问题时纳入 |
| > 0.7 | 无更好结果时备选，否则跳过 |

#### limit 选择

| 意图 | limit | 原因 |
|------|-------|------|
| 精确答案（函数名、错误码） | 5 | 冗余引入噪音 |
| 一般理解（概念、流程） | 10 | 需要多个视角 |
| 全面调研（对比、综述） | 20 | 覆盖面优先 |

#### scope——限定搜索范围

按目录前缀筛选结果。**必须传绝对路径**，相对路径静默不匹配。

| 场景 | scope |
|------|-------|
| 搜索全部 | 不传 |
| 限定某目录 | 绝对路径前缀，如 `/Users/me/docs/api` |
| 多个目录 | 字符串数组，结果取并集 |

如果用户给了相对路径 → 从之前的 `query_documents` / `list_files` 结果中推导绝对前缀，或省略 scope。

#### 查询策略

| 场景 | 问题 | 操作 |
|------|------|------|
| 明确术语 | 关键词搜索需要精确匹配 | 保留原词 |
| 代码符号（函数名、类型） | AST 分块已注入 scope chain，按符号搜索 | 直接用符号名 |
| 模糊问题 | 向量搜索需要语义信号 | 补充描述性上下文 |
| 错误堆栈 / 代码块 | 长文本稀释相关性 | 提取核心关键词（错误码、函数名） |
| 多个独立话题 | 单查询混淆结果 | 拆为多次查询 |
| 结果少 / 质量差 | 术语不匹配 | 查询扩展（见下） |

#### 查询扩展

当结果少（< 3）或全部 score > 0.5 时：

- 保留原词在最前，追加 2–4 个变体
- 类型：同义词、缩写、相关词、词形变化
- 例：`"config"` → `"config configuration settings configure"`
- 上限 4 个追加词，防止话题漂移

#### 结果筛选

**纳入** 条件（任一满足）：
- 直接回答问题
- 提供回答问题所需的上下文
- 话题相关且 score < 0.5

**跳过** 条件：
- 关键词相同但意图不同（假阳性）
- 提到术语但无实际解释
- score > 0.7 且有更好的结果

#### fileTitle 字段

每项结果包含 `fileTitle`——从文档内容提取的标题：

- 用于区分不同文档的 chunk（相同 fileTitle = 同一文档上下文）
- fileTitle 与查询无关且 score > 0.5 → 降低该结果的优先级
- 空值表示标题提取失败

---

### read_chunk_neighbors —— 上下文展开

**按需使用**。当 `query_documents` 返回的 chunk 不足以支撑答案时调用——例如 chunk 引用了「上述方法」「如图所示」但缺失上文。

```
read_chunk_neighbors({
  chunkIndex: number,
  filePath?: string,
  source?: string,
  before?: number,
  after?: number
})
```

- `before` / `after` 默认 2（遵循 `grep -C 2` 惯例）
- `filePath` 和 `source` 二选一（分别对应 `ingest_file` 和 `ingest_data` 摄入的内容）
- 返回按 chunkIndex 升序的数组，目标 chunk 标记 `isTarget: true`

**触发信号**：
- 上下文不足：目标 chunk 引用了外部内容
- 用户明确要求：「前文是什么」「展开看看」「完整上下文」「读一下前后的内容」

**不需要展开时**：直接用现有 `query_documents` 结果回答。

---

## 查询模式速查

| 用户意图 | 查询模式 | 示例 |
|---------|---------|------|
| 搜索函数 / 类 | `"[functionName] definition implementation"` | `"createUserPool definition implementation"` |
| 搜索 API 用法 | `"[API] usage example parameters"` | `"fetchUserData usage example parameters"` |
| 搜索配置 / 常量 | `"[CONSTANT_NAME] config value"` | `"MAX_RETRIES config value"` |
| 定义 / 概念 | `"[term] definition concept"` | `"REST API definition concept"` |
| 操作指南 | `"[action] steps example usage"` | `"database setup steps example"` |
| 排障 | `"[error] fix solution cause"` | `"TypeError fix solution cause"` |

## 结果合成策略

| 用户意图 | 策略 | 原因 |
|---------|------|------|
| 精确答案 | 筛选 1–2 最佳结果 | 多余引入噪音 |
| 理解话题 | 合成多个结果 | 需要完整图景 |
| 排障 | 仅纳入直接原因 | 间接信息干扰 |
| 选项对比 | 结构化合成 | 需要全面视角 |

**无结果时的处理**：
1. 重新措辞（换术语/视角）
2. 扩大范围（去掉 scope 或使用更宽泛的查询）
3. 如果用了 scope，确认是绝对路径前缀
4. 调用 `list_files` 确认文件是否已摄入
5. 告知用户没有匹配内容

---

# 摄入与索引

将内容写入本地知识库，供后续搜索。

---

## Tools

### ingest_file —— 摄入本地文件

支持代码文件（.ts/.js/.py/.go/.rs/.java/.c/.cpp/.h 等），以及 PDF、DOCX、TXT、MD。

```
ingest_file({ filePath: string, visual?: boolean, visualQuality?: "fast" | "quality" })
```

**文件必须位于 BASE_DIR / BASE_DIRS 配置的根目录内**，否则被拒绝。

#### 分块策略自动路由

| 文件类型 | 分块器 | 说明 |
|---------|--------|------|
| `.ts/.js/.py/.go/.rs/.java` | CodeChunker | tree-sitter AST 级分块，含 scope chain + imports 上下文 |
| `.c/.cpp/.h/.json/.yaml/.css/.html` 等 | SemanticChunker | 纯文本读取后语义分块 |
| `.pdf` | SemanticChunker | 文本提取 + 可选 VLM 视觉 caption |
| `.docx` | SemanticChunker | mammoth 提取正文 |
| `.txt`, `.md` | SemanticChunker | 纯文本语义分块 |

**CodeChunker 说明**：代码文件通过 tree-sitter 解析为 AST，在函数/类/方法等语义边界切分，不会在语句中间截断。embedding 使用 `contextualizedText`（含 scope chain + import 信息的上下文增强文本），原始代码原文保留在 `text` 字段。

---

#### PDF 视觉模式

仅对 `.pdf` 生效。非 PDF 文件传 `visual: true` 静默忽略。

启用 `visual` 后，系统下载本地 VLM 模型，为 PDF 中的图表/表格/示意图生成 captions，作为独立 chunk（格式：`[Visual content on page <N>: <caption>]`）进入搜索管线。

**成本**：
- `fast` 配置：约 250MB 模型下载，每页推理较轻
- `quality` 配置：约 2.9GB 模型下载，每页推理约 `fast` 的 2 倍

**决策流程**：

1. **当前请求已指定模式** → 直接遵循，不要重复询问。
2. **用户未指定** → 用以下话术一次性问清楚：

> 这个 PDF 图片多吗（有需要被搜索的图表、表格、示意图吗）？
>
> - **不需要** → 纯文本摄入（最快，无额外下载）
> - **需要** → 视觉模式：
>   - **fast**（默认）— 提取图标题和类型；图中细节文字（坐标轴、注释）不太可靠。模型约 250MB。
>   - **quality** — 图中文字（坐标轴标签、子图标注、流程图节点）更可靠。模型约 2.9GB。
>
> 选哪个？

用户回复「不需要 / 纯文本」→ 不加 visual 参数。
「需要 + fast / 轻量」→ `visual: true`（默认 fast）。
「需要 + quality / 精确 / 准确」→ `visual: true, visualQuality: "quality"`。

**失败降级**：VLM 失败自动回退纯文本，文件摄入仍完成。重新运行 `ingest_file` 可重试视觉富化。

---

### ingest_data —— 摄入网页 / 原始内容

```
ingest_data({
  content: string,
  metadata: { source: string, format: "html" | "markdown" | "text" }
})
```

**format 选择**：
- HTML 字符串 → `"html"`
- Markdown 字符串 → `"markdown"`
- 纯文本 → `"text"`

**source 格式**：
- 网页 → 完整 URL：`"https://example.com/page"`
- 其他内容 → `"类型://日期"` 或 `"类型://日期/详情"`（如 `"clipboard://2026-07-11"`）

**HTML 来源方案**：

| 来源类型 | 获取方法 |
|---------|---------|
| 静态页面 | HTTP fetch（最简单） |
| SPA / JS 渲染 | 浏览器工具渲染 DOM → 提取 → ingest_data |
| 需登录 | 用户手动粘贴 |

HTTP fetch 返回空或极少内容 → 用浏览器工具重试。

**URL 规范化**：系统自动去除 query string 和 fragment（`?utm=x#section` 被裁剪）。分页等场景需保留 query string 时，显式传入完整 URL 作为 source。

**内容更新**：用相同 source 重新调用 `ingest_data` 即可覆盖。相同 source 也可用于 `delete_file` 删除。

---

## 安全边界

所有摄入操作限定在 `BASE_DIR` / `BASE_DIRS` 配置的根目录内。根目录外的文件路径会被拒绝。详见下方「管理与维护」章节。

---

# 管理与维护

---

## Tools

### list_files —— 列出已摄入文件

```
list_files({ scope?: string | string[] })
```

- `scope` 可选，限定目录前缀（必须绝对路径）
- 返回每个文件的摄入状态、chunk 数量等
- `ingest_data` 摄入的 sources 始终被列出，不受 scope 限制

---

### delete_file —— 删除已摄入内容

```
delete_file({ filePath: string })
// 或
delete_file({ source: string })
```

- `filePath` 和 `source` 二选一
- 幂等：目标不存在也返回成功

---

### status —— 查看统计

```
status()
```

无参数。返回：文件总数、chunk 总数、数据库路径、已配置的根目录等。

**诊断用途**：当用户反馈搜索不到内容或摄入范围异常时，先调用 `status` 检查当前配置的根目录和有效 warning。

---

## 文档根目录（安全边界）

所有 ingest / list / delete / read_chunk_neighbors 操作均被限制在已配置的根目录内。

| 方式 | 说明 | 场景 |
|------|------|------|
| `BASE_DIR` 环境变量 | 单路径 | 单根目录（兼容旧版） |
| `BASE_DIRS` 环境变量 | JSON 数组，如 `'["/a","/b"]'` | 多根目录 |
| CLI `--base-dir` | 可重复参数 | CLI 多根目录，会覆盖环境变量 |

**优先级**：CLI `--base-dir` > `BASE_DIRS` > `BASE_DIR` > `process.cwd()`

**配置警告**（作为响应中的附加 content block 出现）：
- `BASE_DIRS is set; BASE_DIR is ignored.` → 两者同时配置，BASE_DIR 被自动忽略
- `Nested base directory pruned: <child> is inside <parent>.` → 配置了嵌套的根目录，子目录被裁剪

---

## CLI 速查

| 操作 | CLI 命令 |
|------|---------|
| 摄入文件 | `npx @damoqiongqiu/mcp-local-rag ingest <path> [--visual] [--visual-quality fast\|quality]` |
| 摄入目录 | `npx @damoqiongqiu/mcp-local-rag ingest <dir>`（如 `./src/`） |
| 搜索 | `npx @damoqiongqiu/mcp-local-rag query <text> [--limit n] [--scope prefix]` |
| 列出 | `npx @damoqiongqiu/mcp-local-rag list [--base-dir path] [--scope prefix]` |
| 状态 | `npx @damoqiongqiu/mcp-local-rag status` |
| 删除 | `npx @damoqiongqiu/mcp-local-rag delete [--source url] [path]` |
| 上下文 | `npx @damoqiongqiu/mcp-local-rag read-neighbors --file-path <abs-path> --chunk-index <n> [--before n] [--after n]` |

CLI 全局选项（`--db-path`, `--cache-dir`, `--model-name`）优先级：CLI 参数 > 环境变量 > 默认值。

**Config 匹配**：对已有数据库操作时，`--model-name` 等选项必须与 MCP server 配置一致。切换模型会改变向量空间，搜索质量无声降级。

---

# 安装与排障

---

## 安装

### 全局安装（推荐）

```bash
npm install -g @damoqiongqiu/mcp-local-rag
```

### 按需运行

不安装也行，通过 `npx @damoqiongqiu/mcp-local-rag` 按需拉取运行。

### WorkBuddy 配置

在 WorkBuddy 中配置为 MCP Connector（stdio transport），按需设置环境变量即可。无需额外安装步骤。

**推荐配置（代码项目）**：

```json
{
  "mcpServers": {
    "mcp-local-rag": {
      "command": "npx",
      "args": ["-y", "@damoqiongqiu/mcp-local-rag"],
      "env": {
        "BASE_DIR": "/path/to/your/project",
        "RAG_HYBRID_WEIGHT": "0.7"
      }
    }
  }
}
```

`RAG_HYBRID_WEIGHT: 0.7` 是代码场景的推荐值——在语义理解和精确符号匹配之间取得平衡。纯文档场景可降至 `0.4`。

---

## 首次运行与模型下载

首次 `ingest_file` 或 `query_documents` 调用会触发模型下载：

- **Embedding 模型**：`Xenova/all-MiniLM-L6-v2`（默认），约 **80MB**
- **VLM 模型（可选）**：
  - `fast`：`HuggingFaceTB/SmolVLM-256M-Instruct`，约 **250MB**
  - `quality`：`onnx-community/Qwen2.5-VL-3B-Instruct-ONNX`，约 **2.9GB**
- **缓存位置**：`CACHE_DIR`（默认 `./models/`），模型下载后缓存复用，不再需要联网

**模型仅在首次使用时下载**，后续离线可用。

---

## 🇨🇳 国内网络注意事项

mcp-local-rag 依赖 HuggingFace（**huggingface.co**）下载模型。国内网络环境下可能无法直接访问。

### 症状

运行时报以下错误之一：

```
ECONNREFUSED huggingface.co
fetch failed
Error: Failed to download model
```

### 解决方案

#### 方案 1：配置 HuggingFace 镜像（推荐，最简单）

```bash
export HF_ENDPOINT=https://hf-mirror.com
```

`hf-mirror.com` 是国内社区维护的 HuggingFace 镜像站，速度稳定。设置后所有模型下载自动走镜像。

在 WorkBuddy 的 connector 环境变量配置中添加 `HF_ENDPOINT` 即可。

#### 方案 2：配置代理

```bash
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
```

将 `127.0.0.1:7890` 替换为你的代理地址。

#### 方案 3：手动下载模型部署

如果代理和镜像都不可用，可以手动下载模型文件：

1. 在可访问 HuggingFace 的环境下载：
   - Embedding：https://huggingface.co/Xenova/all-MiniLM-L6-v2
   - VLM (fast)：https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct
   - VLM (quality)：https://huggingface.co/onnx-community/Qwen2.5-VL-3B-Instruct-ONNX

2. 下载对应 huggingface repo 下的全部文件（特别是 `.onnx` 和 `tokenizer.json` 等）

3. 放入 `CACHE_DIR` 对应路径：
   ```
   {CACHE_DIR}/
   └── Xenova/
       └── all-MiniLM-L6-v2/
           ├── onnx/
           │   └── model.onnx
           ├── tokenizer.json
           └── ...
   ```

4. 确认文件齐全后，再次运行 mcp-local-rag，系统检测到本地缓存会跳过下载

---

## 环境变量速查

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BASE_DIR` | `process.cwd()` | 文档根目录（单目录） |
| `BASE_DIRS` | — | JSON 数组多根目录，如 `'["/Users/me/docs","/Users/me/projects"]'` |
| `DB_PATH` | `./lancedb/` | LanceDB 向量数据库路径 |
| `CACHE_DIR` | `./models/` | 模型缓存目录（embedder + VLM 共享） |
| `MODEL_NAME` | `Xenova/all-MiniLM-L6-v2` | Embedding 模型名 |
| `MAX_FILE_SIZE` | `104857600` (100MB) | 单个文件最大字节数 |
| `RAG_MAX_DISTANCE` | — | 搜索距离阈值，如 `0.5`。越小越严格，只返回高相关度结果 |
| `RAG_GROUPING` | — | 结果分组模式：`similar` / `related` |
| `RAG_MAX_FILES` | — | 搜索结果最多保留 N 个文件的 chunks |
| `RAG_HYBRID_WEIGHT` | `0.6` | 关键词权重（0=纯语义，1=纯关键词） |
| `CHUNK_MIN_LENGTH` | `50` | 最小 chunk 长度（字符），短于此的片段被过滤 |
| `RAG_DEVICE` | `cpu` | 推理设备（如 `cpu`、`webgpu`） |
| `RAG_DTYPE` | `fp32` | Embedding 量化精度（`fp32`/`fp16`/`q8`/`int8`） |

---

## 常见问题

### Q: 「query_documents 搜不到刚摄入的文件」

1. 先调用 `status()` 确认文件是否被成功摄入（文件数、chunk 数）
2. 内容过短（< `CHUNK_MIN_LENGTH`，默认 50 字符）会被过滤
3. `scope` 参数是否限制了搜索范围（必须是绝对路径前缀）

### Q: 「搜索结果质量不好」

- 调整 `RAG_HYBRID_WEIGHT`：值越高关键词权重越大（适合精确匹配），越低语义权重越大（适合模糊查询）
- 使用 `RAG_MAX_DISTANCE` 过滤低相关度结果（如设 `0.5`）
- 尝试查询扩展（换措辞、加同义词）

### Q: 「磁盘空间占用大」

- Embedder 模型：约 80MB
- VLM fast：约 250MB；VLM quality：约 2.9GB
- LanceDB 数据库：取决于摄入量，大致等于源文件大小 + 向量索引开销
- 可通过设置 `DB_PATH` 和 `CACHE_DIR` 迁移到更大磁盘

### Q: 「如何迁移数据库到另一台机器」

1. 停止 mcp-local-rag 进程
2. 复制 `DB_PATH`（lancedb 目录）和 `CACHE_DIR`（models 目录）到新位置
3. 更新环境变量指向新路径
4. 重启

### Q: 「切换 embedding 模型后搜索不出来」

切换 `MODEL_NAME` 会改变向量空间——新旧模型的向量维度/语义不兼容。**必须重新摄入全部数据**：
1. 删除旧数据库（或换 `DB_PATH`）
2. 设置新 `MODEL_NAME`
3. 重新摄入所有文件

### Q: 「model download stuck / 下载卡住」

这是 HuggingFace 连接问题，参见上方「国内网络注意事项」章节。
