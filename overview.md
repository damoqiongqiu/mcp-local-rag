# CodeChunker 集成完成报告

## 做了什么

为 `mcp-local-rag` 项目实现了**代码文件的 AST 级语义分块**能力，end-to-end 打通了解析→分块→嵌入→存储的全链路。

## 核心改动

### 1. 代码文件白名单扩展 (`src/parser/index.ts`)
- 新增 `TEXT_CODE_EXTENSIONS` 集合（50+ 种代码/文本扩展名）
- 之前只有 `.pdf/.docx/.txt/.md` 四种格式，代码文件会直接抛错
- 现在代码文件路由到 `parseContent` 读取为 UTF-8 文本

### 2. ChunkerInterface 抽取 (`src/chunker/index.ts`)
- 定义通用的 `ChunkerInterface`（`chunkText(text, embedder?)`）
- `TextChunk` 新增可选字段 `textForEmbedding`——代码 chunk 用它存储 `contextualizedText`（含 scope chain + imports），文档 chunk 不用（原始文本已足够）

### 3. CodeChunker 实现 (`src/chunker/code-chunker.ts`) [新建]
- 封装 `code-chunk`（supermemoryai/code-chunk）——基于 tree-sitter 的 AST 分块
- `chunkText()` 不需要 embedder（AST 驱动，不像 SemanticChunker 需要 embedding 算相似度）
- 输出 `TextChunk`：`text`=原始代码，`textForEmbedding`=上下文增强文本
- 支持 TS/JS/Python/Rust/Go/Java 共 13 种扩展名
- 导出 `isCodeChunkExtension(filePath)` 判断工具函数

### 4. 类型解耦 (`src/ingest/compute.ts`, `src/ingest/visual.ts`)
- `buildChunksAndEmbeddings` 参数从 `SemanticChunker` 放宽为 `ChunkerInterface`
- `embedBatch` 优先使用 `textForEmbedding`（存在时），否则回退到 `text`

### 5. 运行时路由
- **Server 端**: `resolveChunker(filePath)` → PDF/文档走 SemanticChunker 单例，代码文件创建 CodeChunker
- **CLI 端**: 主循环按文件动态选择 chunker

### 6. 依赖配置
- 安装 `code-chunk@0.1.14` + 6 个 tree-sitter 语法包
- `tsconfig.json` 添加 `paths` 映射绕过 node16 模块解析兼容性问题

## 验证状态

| 检查项 | 状态 |
|--------|------|
| `pnpm run type-check` | ✅ 通过 |
| `pnpm run check` (Biome) | ✅ 通过 |
| `pnpm run lint` | ✅ 通过 |
| chunker 单元测试 (29 tests) | ✅ 全绿 |
| parser 单元测试 (174 tests) | ✅ 全绿 |
| 全量测试 (1047 tests) | 22 文件失败（均因 huggingface.co 不可达，预存问题） |

## 文件改动清单

```
package.json              |   1 +        (code-chunk 依赖)
pnpm-lock.yaml            | 156 +++++    (lockfile)
pnpm-workspace.yaml       |   6 +        (tree-sitter build 授权)
src/chunker/index.ts      |  33 +-       (ChunkerInterface + TextChunk 扩展)
src/chunker/code-chunker.ts |  新建      (CodeChunker 实现)
src/cli/ingest.ts         |  19 +-       (按文件选择 chunker)
src/ingest/compute.ts     |  16 +-       (类型放宽)
src/ingest/visual.ts      |   6 +-       (类型放宽)
src/parser/index.ts       |  88 +-       (代码文件白名单)
src/server/index.ts       |  34 +-       (resolveChunker 路由)
tsconfig.json             |  11 +-       (paths 映射)
```

## 管道示意

```
代码文件 (.ts/.py/.go ...)
    │
    ▼
DocumentParser.parseFile() ──→ 读取为文本 (UTF-8)
    │
    ▼
resolveChunker(filePath)  ──→ CodeChunker (AST 分块)
    │                          产出 TextChunk { text, textForEmbedding }
    ▼
buildChunksAndEmbeddings()
    │   embedBatch(textForEmbedding ?? text)  ← 代码用 contextualizedText 嵌入
    ▼
VectorStore.insert() ──→ LanceDB (存储 text + vector)
```
