# 安装与排障

---

## 安装

### 全局安装（推荐）

```bash
npm install -g mcp-local-rag
```

### 按需运行

不安装也行，通过 `npx mcp-local-rag` 按需拉取运行。

### WorkBuddy 配置

在 WorkBuddy 中配置为 MCP Connector（stdio transport），按需设置环境变量即可。无需额外安装步骤。

**推荐配置（代码项目）**：

```json
{
  "mcpServers": {
    "mcp-local-rag": {
      "command": "npx",
      "args": ["-y", "mcp-local-rag"],
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
