# AGENTS.md

为 `mcp-local-rag` 项目工作的 AI 编码 Agent 使用指南。

## 项目概述

mcp-local-rag 是一个本地 RAG（检索增强生成）MCP 服务器和 CLI 工具 — 带关键词增强的语义文档搜索，完全私有，零配置。支持摄入 PDF/DOCX/TXT/MD/HTML 文件，按语义（而非字符数）分块，使用 Transformers.js 生成嵌入向量，存入 LanceDB，并提供 7 个 MCP 工具和对应的 CLI 子命令。

- **包名**：npm 上的 `mcp-local-rag`
- **许可证**：MIT
- **Node 版本**：>= 22
- **包管理器**：pnpm（锁文件：`pnpm-lock.yaml`）
- **语言**：TypeScript 6.0，严格模式，ES Modules（`"type": "module"`）
- **模块系统**：Node16（`"module": "node16"`），相对导入须带 `.js` 扩展名

## 常用命令

```bash
pnpm install              # 安装依赖
pnpm run build            # TypeScript 编译 → dist/
pnpm run dev              # 通过 tsx 运行（无需构建）
pnpm run test             # 运行全部测试（CPU，maxWorkers: 1）
pnpm run check:all        # 完整 CI 流水线（lint + format + unused + deps + build + test）
pnpm run check:fix        # 自动修复 lint 和格式化问题
pnpm run type-check       # tsc --noEmit
```

## 项目结构

```
src/
  index.ts              # 入口 — 路由到 CLI 或 MCP 服务器
  cli-main.ts           # CLI 调度器（ingest、query、list、delete、read-neighbors、status）
  server-main.ts        # MCP 服务器启动
  cli/                  # CLI 子命令实现 + 选项解析
  server/               # MCP 工具处理器、定义、输入解析、错误工具
  parser/               # 文档解析器（PDF 用 mupdf、DOCX 用 mammoth、TXT、MD、HTML、代码文件）
  chunker/              # 分块（SemanticChunker 语义分块 + CodeChunker AST 分块）
  embedder/             # Transformers.js 嵌入（通过 ONNX 加载 HuggingFace 模型）
  vectordb/             # LanceDB 操作、向量存储、类型定义
  ingest/               # 摄入流水线（计算分块、PDF 视觉标注）
  utils/                # 共享工具（base-dirs、errors、raw-data、scan、scope-match）
  __tests__/            # 全部测试套件（与 src/ 结构镜像）
skills/                 # 随包发布的 Agent Skills
scripts/                # 构建/测试辅助脚本
```

## 代码规范

### 格式化（Biome）

- 缩进：2 空格
- 引号：单引号（`'`）
- 分号：无（`"semicolons": "asNeeded"`）
- 尾逗号：ES5（`"trailingCommas": "es5"`）
- 行宽：100
- 自动修复：`pnpm run check:fix`

### Lint 规则

- Biome 推荐规则 + `noExplicitAny: "warn"`（测试文件中关闭）
- `noNonNullAssertion: "off"`、`useLiteralKeys: "off"`
- `knip` 检查未使用的导出（`pnpm run check:unused`）
- `dpdm` 检查循环依赖（`pnpm run check:deps`）

### TypeScript 严格模式

全部严格检查均已开启：
- `strict: true`、`noImplicitAny`、`strictNullChecks`、`strictFunctionTypes`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noPropertyAccessFromIndexSignature`、`noImplicitReturns`、`noUnusedLocals`、`noUnusedParameters`

### 导入规范

- 相对导入必须带 `.js` 扩展名（`"module": "node16"` 要求）
- 从具体模块路径导入，不要使用 barrel re-export
- 避免循环导入 — CI 中 `dpdm` 会检查

## 错误处理

### 领域错误（`src/utils/errors.ts`）

所有领域错误都继承自 `AppError`，携带两个判别字段：

- `layer`：`'embedder' | 'parser' | 'vectordb' | 'config' | 'pdf-visual'`
- `kind`：`'validation' | 'io' | 'config' | 'internal'`

在边界处使用 `isAppError()` 类型守卫来检测领域错误。

### MCP 客户端边界（`src/server/error-utils.ts`）

中央映射器 `toMcpError(error, context)` 将错误转换为 MCP 客户端可接受的格式：

- `McpError` → 原样透传
- `AppError` 且 `kind: 'validation' | 'config'` → `InvalidParams`
- 其他所有错误 → `InternalError`
- 堆栈跟踪和 cause 链**绝不**发送给客户端 — 仅通过 `logError()` / `formatErrorForLog()` 输出到 stderr

**新增 handler 必须遵循此模式：**

```ts
try {
  // handler 逻辑
} catch (error) {
  logError('tool-name', error)
  throw toMcpError(error, { prefix: 'Failed to do X' })
}
```

### 配置警告

当配置问题不致命（例如 `BASE_DIR`/`BASE_DIRS` 优先级冲突）时，通过 `appendConfigWarnings(content, warnings)` 发出警告块。每个 handler 都必须包含此调用。

## 测试

### 测试运行器

Vitest 配置：`isolate: false`、`pool: 'forks'`、`maxWorkers: 1` — `onnxruntime-node` 维护的原生状态无法在单文件级别重置，因此必须如此配置。

### Mock 规则

由于 `isolate: false` 意味着所有测试文件共享同一个模块注册表，顶层 `vi.mock` 是**全局的**，会影响所有测试文件。

**经验法则：**
- 如果被 mock 的模块仅在你的测试文件中使用 → 顶层 `vi.mock` 没问题
- 否则 → 在 `beforeAll` 内使用 `vi.doMock`，之后动态导入，在 `afterAll` 中用 `vi.doUnmock` + `vi.resetModules()` 清理

```ts
const parserFactory = () => ({ /* ... */ })

beforeAll(async () => {
  vi.resetModules()
  vi.doMock('../../parser/index.js', parserFactory)
  ;({ runIngest } = await import('../../cli/ingest.js'))
})

afterAll(() => {
  vi.doUnmock('../../parser/index.js')
  vi.resetModules()
})
```

实际示例：`src/__tests__/cli/ingest-default-mode.test.ts`、`src/__tests__/server/handleIngestFile-side-effects.test.ts`。

### 测试组织

- 单元测试在 `src/__tests__/` 下镜像 `src/` 结构
- E2E 测试在 `src/__tests__/e2e/`（运行时需 `RUN_E2E=1`）
- 集成测试使用 `.int.test.ts` 后缀
- 测试文件不参与构建（`tsconfig.json` 排除了 `**/__tests__/**`）

### 测试脚本

| 命令 | 说明 |
|------|------|
| `pnpm test` | CPU 测试（排除 visual-ingest e2e） |
| `pnpm run test:webgpu:main-path` | 核心流程的 GPU 测试 |
| `pnpm run test:e2e` | E2E 测试（需要 `RUN_E2E=1`） |
| `pnpm run test:watch` | 监视模式 |

## 关键设计决策

### 双接口设计（MCP + CLI）

同一套核心逻辑同时服务于 MCP 工具和 CLI 子命令。入口点（`src/index.ts`）按第一个参数路由：如果匹配已知子命令 → CLI 路径；如果没有参数 → MCP 服务器。CLI 支持相同的环境变量和等价的命令行标志（优先级：标志 > 环境变量 > 默认值）。

### 语义分块

文档按语义而非字符数切分。分块器（`src/chunker/`）采用双策略：SemanticChunker 使用嵌入相似度来寻找自然的话题边界，CodeChunker 使用 tree-sitter 在 AST 结构边界（函数、类、方法等）处切分代码文件，并将作用域链和 import 上下文注入嵌入文本。Markdown 代码块保持完整 — 绝不在代码块中间切分。

### 关键词增强

搜索先使用向量相似度，然后关键词匹配提升精确术语的排名（通过 `RAG_HYBRID_WEIGHT` 配置，默认 0.6）。这确保 `useEffect` 或错误码等精确标识符排名更高。

### 安全边界

文件只能在配置的根目录（`BASE_DIR` / `BASE_DIRS` / `--base-dir`）内访问。解析到根目录外的符号链接会被拒绝。同级前缀路径（例如根目录为 `/foo/bar` 时，`/foo/barista`）也会被拒绝。

### 设备与数据类型

`RAG_DEVICE` 和 `RAG_DTYPE` 直接透传给 ONNX Runtime。更改其中任何一个都会改变嵌入空间 — 需要删除数据库并重新摄入。

## 提交 PR 之前

运行完整 CI 流水线：

```bash
pnpm run check:all
```

按顺序执行：Biome check → lint → format → 未使用导出检查 → 循环依赖检查 → 构建 → 测试。

同时注意：
- 为新功能和 bug 修复添加测试
- 如果行为有变化，更新文档
- 保持 commit 聚焦 — 每个 PR 一个逻辑变更

## 核心依赖速查

| 依赖 | 用途 |
|------|------|
| `@huggingface/transformers` | 通过 ONNX 加载本地嵌入模型 |
| `@lancedb/lancedb` | 基于文件的向量数据库 |
| `@modelcontextprotocol/sdk` | MCP 服务器协议 |
| `@mozilla/readability` | HTML 正文提取 |
| `mammoth` | DOCX → 文本转换 |
| `mupdf` | PDF → 文本转换 |
| `turndown` | HTML → Markdown 转换 |
| `jsdom` | 为 readability 提供 HTML 解析 |
| `@biomejs/biome` | Lint + 格式化 |
| `vitest` | 测试运行器 |
| `knip` | 未使用导出检测 |
| `dpdm` | 循环依赖检测 |

## Gitignore 说明

`.gitignore` 排除了 `CLAUDE.md`、`.claude/`、`docs/` 和 `.workbuddy/`。本 `AGENTS.md` 文件应纳入版本控制 — 它是项目的 Agent 指令文件。
