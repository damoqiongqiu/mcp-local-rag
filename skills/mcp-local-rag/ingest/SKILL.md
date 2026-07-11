# 摄入与索引

将内容写入本地知识库，供后续搜索。

---

## Tools

### ingest_file —— 摄入本地文件

支持 PDF、DOCX、TXT、MD、代码文件（.ts/.js/.py/.go/.rs/.java/.c/.cpp/.h 等）。

```
ingest_file({ filePath: string, visual?: boolean, visualQuality?: "fast" | "quality" })
```

**文件必须位于 BASE_DIR / BASE_DIRS 配置的根目录内**，否则被拒绝。

#### 分块策略自动路由

| 文件类型 | 分块器 | 说明 |
|---------|--------|------|
| `.pdf` | SemanticChunker | 文本提取 + 可选 VLM 视觉 caption |
| `.docx` | SemanticChunker | mammoth 提取正文 |
| `.txt`, `.md` | SemanticChunker | 纯文本语义分块 |
| `.ts/.js/.py/.go/.rs/.java` | CodeChunker | tree-sitter AST 级分块，含 scope chain + imports 上下文 |
| `.c/.cpp/.h/.json/.yaml/.css/.html` 等 | SemanticChunker | 纯文本读取后语义分块 |

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

**Profile 选择信号**（当 visual: true 但未指定 profile 时）：
- 默认省略 → `fast`
- 使用 `quality` 的信号：坐标轴标签、子图标注、论文配图、技术图表文字
- 不确定 → 用上面的话术询问

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

详见 [references/html-ingestion.md](../references/html-ingestion.md)。

---

## 安全边界

所有摄入操作限定在 `BASE_DIR` / `BASE_DIRS` 配置的根目录内。根目录外的文件路径会被拒绝。详见 `manage/SKILL.md`。
