# mcp-local-rag 多实例架构改造 — 产品方案评审报告

**日期**：2026-07-20
**场景**：产品评审（架构改造方案审阅）
**参与成员**：产品评审员

---

## 📌 TL;DR（执行摘要）

- 整体结论：🟡 有条件通过 — 方案核心方向正确，成熟度 7/10
- 3 个关键决策需重新审视：(1) 搜索默认不应跨所有实例 (2) 不应废弃 BASE_DIRS (3) Embedder 全局状态需标记技术债
- 阻塞项数量：0（无硬阻塞，但有 2 个 P0 架构决策）
- 下一步：先做 InstanceRouter 接口契约 + 配置解析，配套 migrate 工具和字段级错误信息，再观察反馈迭代

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| Go / No-Go | 🟡 条件 Go — 接受方案但需修正 3 个决策点 |
| 严重度分布 | 🔴 0 / 🟠 1 / 🟡 3 / 🟢 6 |
| 关键行动项 | 10 条（按优先级排序） |
| 建议负责人 | 工程团队 |

---

## 1. 各成员核心结论

### 🔍 产品评审员（产品评审）

- 核心判断：方案在正确的方向上（项目级隔离），但成熟度只有 7/10。三个关键决策需要修正：
  1. **「默认搜所有实例」是错误的默认值**——应该默认搜指定实例，显式 wildcard 才跨实例，否则用户不知道搜索范围会引入隐形错误
  2. **废弃 BASE_DIRS 是过度设计**——保持为 deprecation warning + 功能保留，给现有用户迁移窗口
  3. **Embedder 共享正确但需警惕**——`env.cacheDir`、`setGlobalDispatcher` 等全局副作用是潜在技术债，当前不构成问题但需在代码中标记
- 关键建议：先做 InstanceRouter 接口契约 + 配置解析，把 migrate 工具和错误信息质量做到位，实例命名和自动发现放到 v2

---

## 2. 综合审查发现

| # | 严重度 | 类别 | 问题描述 | 建议 | 来源成员 |
|---|--------|------|---------|------|---------|
| 1 | 🟠 | 架构 | 跨实例搜索的向量距离不可比——不同 LanceDB 实例的 score 不能简单合并排序 | per-instance top-k 各自保留相对排序，不做跨实例重排 | 产品评审员 |
| 2 | 🟡 | 产品 | `query_documents` 的 `instance` 参数作为 optional 会导致用户无意中搜了所有项目 | 改为 required，显式 `"*"` 才跨实例 | 产品评审员 |
| 3 | 🟡 | DX | 从 BASE_DIR→RAG_INSTANCES 迁移无工具支持，手写 JSON 配置易出错 | 提供 `mcp-local-rag migrate` 命令 | 产品评审员 |
| 4 | 🟡 | 数据流 | 嵌套 baseDir（如 `/home` 和 `/home/app`）的归属匹配存在歧义 | 最长前缀匹配 + 配置校验 warn | 产品评审员 |

---

## ✅ 行动清单

| # | 行动 | 负责方 | 紧急度 | 期望完成 |
|---|------|--------|--------|---------|
| 1 | 定义 InstanceRouter 接口契约（TypeScript interface），明确 search 合并策略 | Eng | P0 | 实现前 |
| 2 | 归属匹配逻辑：最长前缀 + 配置校验 warn 嵌套 baseDir | Eng | P0 | 实现中 |
| 3 | RAG_INSTANCES 解析的字段级错误信息（指出第几个元素、哪个字段有问题） | Eng | P0 | 实现中 |
| 4 | 所有跨实例操作 per-instance try/catch，聚合结果 + warnings，单实例异常不拖垮全局 | Eng | P1 | 实现中 |
| 5 | 支持实例命名 `{"name": "app-a", "baseDir": "...", "dbPath": "..."}` | Eng | P1 | v1 |
| 6 | `mcp-local-rag migrate` 命令（自动检测 BASE_DIR/BASE_DIRS 并生成 RAG_INSTANCES） | Eng | P1 | v1 |
| 7 | `query_documents` 的 `instance` 参数改为 required，显式 wildcard 支持跨实例 | Eng | P1 | v1 |
| 8 | 不废弃 BASE_DIRS，改为 deprecation warning + 功能保留 | Eng | P1 | v1 |
| 9 | 按实例数分摊 search candidate limit（防止多实例搜索延迟退化） | Eng | P2 | v1 |
| 10 | 编写 MIGRATION.md 迁移指南 | Eng | P2 | v1 |

---

## ⚠️ 待完善 / 已知局限

- **实例命名（name 字段）**：方案中已纳入 v1，但如果资源紧张可降级到 v2——baseDir 路径本身可以作为 instance identifier
- **自动发现**：`.ragconfig` 文件或 workspace 自动扫描是 10-star 体验的核心，但复杂度高，建议 v2
- **运行时动态添加/移除实例**：需要热重载 MCP 工具注册表，当前不在范围内
- **ONNX Runtime 全局状态**：`env.cacheDir`、`setGlobalDispatcher` 等全局副作用在单 Embedder 共享场景下安全，但未来如需 per-instance 模型则需重构
- **实例数上限**：建议文档化 50 实例上限，超出时启动 warn

---

## 📚 成员产出索引

- gstack-product-reviewer（产品评审员）原始产出：完整 Autoplan 报告（CEO + Design + Eng + DX 四阶段评审）

---

> 本报告由软件工坊 AI 协作生成，关键决策请由工程负责人复核。
