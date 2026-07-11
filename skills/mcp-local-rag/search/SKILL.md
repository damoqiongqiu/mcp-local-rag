---
name: mcp-local-rag/search
description: "搜索与查询 — 代码语义搜索（AST 级），关键词+向量混合检索，结果筛选与上下文展开"
category: 开发工具
platforms: [WorkBuddy, Claude Code, Cursor]
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

详见 [references/query-optimization.md](../references/query-optimization.md)。

| 用户意图 | 查询模式 | 示例 |
|---------|---------|------|
| 搜索函数 / 类 | `"[functionName] definition implementation"` | `"createUserPool definition implementation"` |
| 搜索 API 用法 | `"[API] usage example parameters"` | `"fetchUserData usage example parameters"` |
| 搜索配置 / 常量 | `"[CONSTANT_NAME] config value"` | `"MAX_RETRIES config value"` |
| 定义 / 概念 | `"[term] definition concept"` | `"REST API definition concept"` |
| 操作指南 | `"[action] steps example usage"` | `"database setup steps example"` |
| 排障 | `"[error] fix solution cause"` | `"TypeError fix solution cause"` |

## 结果合成策略

详见 [references/result-refinement.md](../references/result-refinement.md)。

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
