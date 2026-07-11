---
name: mcp-local-rag/setup
description: "安装与配置 — 模型下载，国内网络镜像，环境变量速查与排障"
category: 开发工具
platforms: [WorkBuddy, Claude Code, Cursor]
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

mcp-local-rag 依赖 HuggingFace（**huggingface.co**）下载模型。国内网络环境下可能无法直接访问。v0.18.5 提供了三层保障：

### ⚡ 推荐：配置代理（最简单可靠）

如果你已经在本地运行 ClashX / V2Ray 等代理工具，**只需设置 `HTTPS_PROXY`**，一切自动工作：

```bash
export HTTPS_PROXY=http://127.0.0.1:7890
```

在 MCP connector 配置中：
```json
{
  "mcpServers": {
    "mcp-local-rag": {
      "command": "npx",
      "args": ["-y", "@damoqiongqiu/mcp-local-rag"],
      "env": {
        "BASE_DIR": "/path/to/your/project",
        "HTTPS_PROXY": "http://127.0.0.1:7890"
      }
    }
  }
}
```

> 💡 **v0.18.5 改进**：Node.js 22 内置的 undici HTTP 库默认不读取 `HTTPS_PROXY`。v0.18.5 通过 `setGlobalDispatcher` 全局注入代理，确保所有模型下载请求都走代理，无需额外配置。

### 🔄 自动镜像回退（无需代理）

**如果你没有本地代理**，mcp-local-rag 自带三级镜像链，首次下载前自动探测：

1. `huggingface.co` (官方) → 3s 超时
2. `hf-mirror.com` (社区镜像) → 文件下载 + API 双重验证
3. `modelscope.cn` (魔搭社区) → 完整托管所有 ONNX 权重文件

整个过程会清晰打印日志：

```
Embedder: Using proxy "http://127.0.0.1:7890" for all network requests
Embedder: Downloading model from https://huggingface.co ...
```

如果代理未设置且直连失败：
```
Embedder: huggingface.co is unreachable, auto-switching to mirror https://hf-mirror.com
Embedder: Mirror https://hf-mirror.com is reachable but Hub API is unavailable
Embedder: Auto-switching to mirror https://modelscope.cn
```

### 🛠️ 其他手动配置

#### 显式指定镜像

```bash
export HF_ENDPOINT=https://hf-mirror.com
```

设置后**跳过自动检测**，直接使用你指定的镜像。

#### 禁用自动检测

```bash
export HF_AUTO_MIRROR=false
```

仅使用 `huggingface.co`，不做自动切换。适用于已通过代理/VPN 能直连的场景。

#### 手动下载模型（终极兜底）

如果所有网络方案都不可用，可以手动下载模型文件放入缓存目录：

1. 在可访问 HuggingFace 的环境下载完整 repo：
   - Embedding：`Xenova/all-MiniLM-L6-v2`
   - VLM (fast)：`HuggingFaceTB/SmolVLM-256M-Instruct`
   - VLM (quality)：`onnx-community/Qwen2.5-VL-3B-Instruct-ONNX`

2. 放入 `CACHE_DIR` 对应路径：
   ```
   {CACHE_DIR}/
   └── Xenova/
       └── all-MiniLM-L6-v2/
           ├── onnx/
           │   └── model.onnx
           ├── tokenizer.json
           └── ...
   ```

3. 确认文件齐全后运行 mcp-local-rag，检测到本地缓存会跳过下载

---

## 环境变量速查

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BASE_DIR` | `process.cwd()` | 文档根目录（单目录） |
| `BASE_DIRS` | — | JSON 数组多根目录，如 `'["/Users/me/docs","/Users/me/projects"]'` |
| `DB_PATH` | `./lancedb/` | LanceDB 向量数据库路径 |
| `CACHE_DIR` | `./models/` | 模型缓存目录（embedder + VLM 共享） |
| `MODEL_NAME` | `Xenova/all-MiniLM-L6-v2` | Embedding 模型名 |
| `HF_ENDPOINT` | — | HuggingFace 镜像地址（如 `https://hf-mirror.com`）。设置后跳过自动检测 |
| `HF_AUTO_MIRROR` | `true` | 设为 `false` 禁用自动镜像检测，固定使用 huggingface.co |
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
