---
name: mcp-local-rag
version: 1.0.0
description: "本地 RAG 知识库。当用户说「搜索我的文档」「查一下本地文件」「之前存的 X 在哪儿」「存一下」「索引这个目录」「记住这个」「这个项目里有没有提到 X」或调用 mcp-local-rag MCP 工具时使用。支持 PDF/DOCX/TXT/MD/代码文件（TS/JS/Python/Go/Java/Rust/C/C++等）的语义+关键词混合搜索，文件留存在本地，不上传云端。"
sub_skills:
  - search/SKILL.md
  - ingest/SKILL.md
  - manage/SKILL.md
  - setup/SKILL.md
---

# mcp-local-rag —— 本地 RAG 知识库

基于 MCP 协议的本地文档语义搜索引擎。向量语义搜索 + BM25 关键词搜索双路混合检索，所有数据留存在本地。

---

## ⛔ MANDATORY RULES

1. **文件路径必须为绝对路径**：`filePath` / `scope` 参数必须传绝对路径，相对路径静默不匹配。
2. **首次运行需下载模型**：默认 embedding 模型约 80MB，从 HuggingFace 下载。国内可能需要代理或镜像——详见 `setup/SKILL.md`。
3. **模型一致性**：切换 `MODEL_NAME` 会改变向量空间，已索引数据需重新摄入。

---

## 📋 意图路由表

| 用户意图 | 子模块 | 典型触发词 |
|---------|--------|-----------|
| 搜索 / 查找 / 提问 | `search/SKILL.md` | 「找一下」「搜索」「查」「有没有提到」「X 在哪个文件里」 |
| 摄入 / 存入 / 索引 | `ingest/SKILL.md` | 「存一下」「索引」「导入」「记住这个」「把这个文件加进去」 |
| 管理 / 列出 / 删除 | `manage/SKILL.md` | 「列一下」「有哪些文件」「删掉」「统计」「状态」 |
| 配置 / 排障 / 安装 | `setup/SKILL.md` | 「装不上」「连不上」「配一下」「下载失败」「模型在哪」「国内网络」 |

---

## 🛠️ 支持的格式

| 格式 | 分块策略 | 说明 |
|-----|---------|------|
| PDF | SemanticChunker | 文本提取 + 可选视觉 caption（VLM） |
| DOCX | SemanticChunker | mammoth 提取正文 |
| TXT / MD | SemanticChunker | 纯文本语义分块 |
| 代码文件 | CodeChunker | AST 级分块，在函数/类/方法边界切分，含 scope chain 上下文 |
| HTML (ingest_data) | SemanticChunker | 自动提取正文，去除导航/广告 |

**代码文件支持的语言**：TypeScript (.ts/.tsx/.mts/.cts), JavaScript (.js/.jsx/.mjs/.cjs), Python (.py/.pyi), Go (.go), Rust (.rs), Java (.java) —— 基于 tree-sitter AST 解析。C/C++ 等暂走纯文本分块。

---

## References

- [cli-reference.md](references/cli-reference.md) — CLI 命令选项与输出格式
- [query-optimization.md](references/query-optimization.md) — 查询模式与优化策略
- [result-refinement.md](references/result-refinement.md) — 结果合成与去重
- [html-ingestion.md](references/html-ingestion.md) — HTML 摄入与 URL 处理
