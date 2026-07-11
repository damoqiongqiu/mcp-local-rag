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
sub_skills:
  - search/SKILL.md
  - ingest/SKILL.md
  - manage/SKILL.md
  - setup/SKILL.md
---

# mcp-local-rag —— 本地代码智能引擎

基于 MCP 协议，为 AI 编程助手提供本地代码库语义搜索。AST 级代码分块（tree-sitter）+ 向量语义搜索 + BM25 关键词加权，精准命中函数、类、API 定义。所有数据留存在本地。

---

## ⛔ MANDATORY RULES

1. **文件路径必须为绝对路径**：`filePath` / `scope` 参数必须传绝对路径，相对路径静默不匹配。
2. **首次运行需下载模型**：默认 embedding 模型约 80MB，从 HuggingFace 下载。国内可能需要代理或镜像——详见 `setup/SKILL.md`。
3. **模型一致性**：切换 `MODEL_NAME` 会改变向量空间，已索引数据需重新摄入。

---

## 📋 意图路由表

| 用户意图 | 子模块 | 典型触发词 |
|---------|--------|-----------|
| 搜索 / 查找代码 | `search/SKILL.md` | 「这个函数在哪」「XX 组件怎么定义的」「找一下 middleware」「谁调用了这个方法」 |
| 搜索 / 查找文档 | `search/SKILL.md` | 「找一下」「搜索」「查」「有没有提到」 |
| 索引代码库 / 摄入文件 | `ingest/SKILL.md` | 「索引这个项目」「存一下」「导入」「把这个文件加进去」 |
| 管理 / 列出 / 删除 | `manage/SKILL.md` | 「列一下」「有哪些文件」「删掉」「统计」「状态」 |
| 配置 / 排障 / 安装 | `setup/SKILL.md` | 「装不上」「连不上」「配一下」「下载失败」「模型在哪」「国内网络」 |

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

## References

- [cli-reference.md](references/cli-reference.md) — CLI 命令选项与输出格式
- [query-optimization.md](references/query-optimization.md) — 查询模式与优化策略
- [result-refinement.md](references/result-refinement.md) — 结果合成与去重
- [html-ingestion.md](references/html-ingestion.md) — HTML 摄入与 URL 处理
