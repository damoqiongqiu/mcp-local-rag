# mcp-local-rag v0.20.0 — 全方位综合评估报告

**日期**：2026-07-23
**场景**：产品评审 + 安全审计 + QA 质量评估 + 代码健康检查
**参与成员**：产品评审员 + 安全官 + QA Lead + 调查员

---

## 📌 TL;DR（执行摘要）
- 整体结论：🟡 有条件通过 — 工程质量顶级（8.0/10），但安全和 QA 各有硬伤需要立即修复
- 阻塞项数量：🔴 3 个（配置泄露、输入校验缺失、53 个集成测试失败）、🟡 8 个 P1
- **最核心的矛盾**：工程质量世界级，但产品分发停留在"手动编辑 JSON"层面 — VS Code 扩展是破局的唯一杠杆
- 下一步：立刻修复安全 P0 → 修复集成测试 → 启动 VS Code 扩展 + 上下文自动注入

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| Go / No-Go | 🟡 条件 Go — 安全 P0 和集成测试修复是硬前提 |
| 严重度分布 | 🔴 3 / 🟠 4 / 🟡 8 / 🟢 6 |
| 关键行动项 | 15 条（分三个阶段执行） |
| 整体质量评分 | 产品：7.5/10 · 安全：B- · QA：62/100 · 代码：8.0/10 |
| 建议负责人 | 工程团队，VS Code 扩展考虑独立负责人 |

---

## 1. 各成员核心结论

### 🔍 产品评审员（产品评审）
- 核心判断：**停止堆砌 MCP 工具，开始构建端到端用户产品体验。** 项目在核心能力上已证明 PMF，但"手动编辑 mcp.json 才能使用"的分发方式把潜在用户群限制在了极小的开发者子集。工程质量方面，RAGServer 类 2000+ 行的膨胀和 code-chunk 依赖脆弱性是主要技术风险。
- 关键建议：VS Code 扩展是第一优先级（触达 99% 目标用户的唯一方式），其次是上下文自动注入模式（让 AI 助手不需要用户手动 query），然后才是查询缓存、GitHub Action、多语言 AST 扩展。

### 🛡️ 安全官（OWASP+STRIDE 审计）
- 核心判断：防御纵深设计优秀（路径验证、错误边界映射、凭证脱敏），但存在 1 个 Critical 和 4 个 High 级发现。**最紧急的是启动时完整配置对象 dump 到 stderr 包含了代理凭证，以及 find_definition/find_references 缺少运行时输入校验。** 供应链方面 undici 和 fast-uri 有已知 HIGH CVE 需要升级。
- 关键建议：P0 修复 F-001（配置泄露）、F-002（输入校验）、F-004（undici 升级），1 天内可完成。P1 补齐剩余 handler 的输入校验和 fast-uri 升级。

### ✅ QA Lead（测试与发布）
- 核心判断：健康分仅 62/100，**NOT SHIP-READY。** 最严重的问题是 ~53 个集成测试真实失败（涉及 multi-root、delete、dispatcher、ingest、search 等关键路径），以及 8 个源模块零单元测试（包括摄入管道的计算核心 compute.ts）。性能方面几乎空白 — 仅有 1 个 P95 测试，无基准套件、无大仓库性能数据。
- 关键建议：立刻修复集成测试失败（Critical），为 compute.ts 和 visual.ts 添加单元测试（Critical），建立性能基准框架并纳入 CI（High）。

### 🔧 调查员（代码健康）
- 核心判断：工程质量评分 8.0/10 — 几乎零技术债，无 TODO/FIXME、无 any 类型滥用、无循环依赖。InstanceRouter 的多实例抽象质量高（9/10），错误分类体系设计优雅。主要风险是 server/index.ts 2111 行巨石类（需要在达到 3000 行前拆分），以及 Embedder 全局单例的 last-writer-wins 风险。
- 关键建议：将 server/index.ts 按工具类别拆分为 5 个 handler 文件（ingest/search/manage/code-intel/system），配置时验证 dtype、添加可选模型预热。

---

## 2. 综合审查发现（去重合并后按严重度排序）

| # | 严重度 | 类别 | 位置 | 问题描述 | 建议 | 来源成员 |
|---|--------|------|------|---------|------|---------|
| 1 | 🔴 | 安全 | `src/server-main.ts:268` | 启动时完整配置对象 dump 到 stderr，包含代理凭证（`proxy: 'http://user:pass@host'`） | 在日志前脱敏 proxy 字段，或在 embedder 创建之前就应用 credential redaction | 安全官 |
| 2 | 🔴 | 安全 | `src/server/index.ts:1880-1950` | `find_definition` 和 `find_references` 缺少运行时输入类型校验，非 string 的 symbolName 直通底层操作 | 添加 `typeof symbolName !== 'string'` 守卫和 limit 范围校验 | 安全官 |
| 3 | 🔴 | QA | 集成测试 | ~53 个集成测试真实失败：multi-root(6)、delete(多)、dispatcher(3)、read-neighbors(10) 等 | 逐项排查修复，优先级：multi-root → delete → dispatcher | QA Lead |
| 4 | 🟠 | 产品 | 分发 | 无 VS Code 扩展，用户必须手动编辑 mcp.json，99% 目标用户无法触达 | 启动 VS Code 扩展开发（搜索 UI + 文件预览 + 状态面板 + 一键配置） | 产品评审员 |
| 5 | 🟠 | 安全 | `package.json` | undici 7.25.0 有 3 个 HIGH CVE（TLS 绕过、header 注入、WebSocket DoS） | 升级 undici 至 >=7.28.0 | 安全官 |
| 6 | 🟠 | 安全 | 传递依赖 | fast-uri 3.1.2 有 2 个 HIGH CVE（host 混淆），通过 MCP SDK 间接引入 | 通过 pnpm overrides 强制 >=3.1.4 | 安全官 |
| 7 | 🟠 | 安全 | `src/server/index.ts:1657-1796` | `config.grouping`、`dedup_check.threshold`、`export_index.outputPath` 三个 handler 缺少运行时参数校验 | 为每个 handler 添加 parse 函数，统一到 tool-input.ts | 安全官 |
| 8 | 🟡 | 代码 | `src/server/index.ts` | RAGServer 类 2111 行，随工具增长持续膨胀，合并冲突高风险 | 拆分为 handlers/{ingest,search,manage,code-intel,system}.ts | 调查员 |
| 9 | 🟡 | QA | `src/ingest/compute.ts` | 摄入管道计算核心零单元测试，`buildChunksAndEmbeddings` 边界情况（空文本、超长、embedding 对齐失败）完全未验证 | 添加 15+ 单元测试覆盖核心计算逻辑 | QA Lead |
| 10 | 🟡 | QA | `src/ingest/visual.ts` | 视觉 PDF 管道零单元测试，错误路径（captioner 失败、destroy 失败、零页面）未覆盖 | 添加 mock VLM 的单元测试 | QA Lead |
| 11 | 🟡 | 产品 | 体验 | 无查询缓存：同一 query 在 AI 对话中重复调用，每次都重新 embedding + search | 添加 LRU query cache（TTL 5 分钟） | 产品评审员 |
| 12 | 🟡 | 产品 | 体验 | 搜索模式调试成本高：用户需要手动调 hybrid weight/grouping/distance 等多个参数 | 提供 3 个预设搜索模式（精确符号/代码理解/文档搜索） | 产品评审员 |
| 13 | 🟡 | 产品 | 分发 | 无 GitHub Action，无法进入 CI/CD 工作流 | 开发 GitHub Action 用于 PR 上下文注入 | 产品评审员 |
| 14 | 🟡 | QA | 性能 | 零性能基准测试，仅有 1 个 P95 测试，无大仓库摄入/搜索性能数据 | 建立 benchmark suite（标准项目 × 摄入时间 × 查询延迟 × 内存） | QA Lead |
| 15 | 🟡 | 产品 | 上下文 | 缺少自动注入模式 — AI 助手需要用户手动 query 才能获得代码上下文 | 开发 "conversation context" 模式：对话开始时自动注入当前文件关联定义 | 产品评审员 |
| 16 | 🟢 | 代码 | Embedder | 全局 env.cacheDir 的 last-writer-wins 风险（当前单实例部署下不构成生产问题） | 文档化风险，长远考虑 per-instance embedder 隔离 | 调查员 |
| 17 | 🟢 | 产品 | CodeChunker | 仅支持 6 种语言的 AST 分块，缺少 C/C++、Rust、Go、Ruby 等 | 逐步扩展 tree-sitter grammar 支持 | 产品评审员 |
| 18 | 🟢 | 安全 | `src/parser/index.ts:300` | 不存在文件的路径验证 fallback 到 string resolve，存在低概率 TOCTOU 窗口 | 打开文件后重新 realpath 验证 | 安全官 |
| 19 | 🟢 | 安全 | 全局 | 无 rate limiting，所有 16 个 MCP 工具无并发控制 | 当前本地 stdio 传输风险低，待迁移到远程传输时补充 | 安全官 |
| 20 | 🟢 | QA | CI | 分支覆盖率 60% 偏低，大量错误路径未被测试 | 逐步提升至 75%，关键 E2E 纳入 CI 默认运行 | QA Lead |
| 21 | 🟢 | 产品 | PDF 视觉 | PDF 视觉模式投入产出比低（2.9GB VLM 模型 vs 代码搜索核心场景） | 暂时冻结投入，等核心场景跑通再评估 | 产品评审员 |

---

## ✅ 行动清单（按执行阶段）

### Phase 1 — 立即修复（本周，P0）

| # | 行动 | 负责方 | 紧急度 | 说明 |
|---|------|--------|--------|------|
| 1 | 修复 F-001：脱敏或移除 `server-main.ts:268` 的完整 config dump | 安全 | P0 | 一行 fix，在日志前 strip proxy credentials |
| 2 | 修复 F-002：为 `find_definition` 和 `find_references` 添加运行时参数校验 | 安全 | P0 | 添加 typeof 守卫 + limit 范围校验 |
| 3 | 升级 undici 至 >=7.28.0 + fast-uri override >=3.1.4 | 安全 | P0 | `pnpm update undici` + pnpm overrides |
| 4 | 修复 ~53 个集成测试失败 | QA | P0 | 优先 multi-root → delete → dispatcher → read-neighbors |

### Phase 2 — 短期加固（2 周内，P1）

| # | 行动 | 负责方 | 紧急度 | 说明 |
|---|------|--------|--------|------|
| 5 | 为 8 个零测试模块添加单元测试（compute.ts、visual.ts 优先） | QA | P1 | 15+ 测试覆盖核心计算逻辑 |
| 6 | 补充 config/dedup_check/export_index handler 的运行时参数校验 | 安全 | P1 | 参考 parseQueryDocumentsInput 模式 |
| 7 | 将 server/index.ts 拆分为 handlers/ 子目录 | 代码 | P1 | 5 个 handler 文件，RAGServer 纯编排 |
| 8 | 添加 LRU query cache（TTL 5 分钟） | 产品 | P1 | 同一 query 重复调用缓存命中 |
| 9 | 添加 3 个预设搜索模式（精确符号/代码理解/文档搜索） | 产品 | P1 | 消除参数调试心理负担 |

### Phase 3 — 战略投入（未来 3 个月，P1-P2）

| # | 行动 | 负责方 | 紧急度 | 说明 |
|---|------|--------|--------|------|
| 10 | **VS Code 扩展** — 搜索 UI + 文件预览 + 状态面板 + 一键配置 | 产品 | P1 | 触达 99% 目标用户的核心杠杆 |
| 11 | 上下文自动注入模式 — AI 对话开始时自动注入当前文件关联代码 | 产品 | P1 | 从"搜索工具"到"代码智能" |
| 12 | GitHub Action — CI 中自动索引 PR 变更文件 | 产品 | P2 | 进入团队 workflow 的入口 |
| 13 | 建立性能基准 framework（摄入时间/查询延迟/内存 × 不同规模项目） | QA | P2 | 纳入 CI 门禁 |
| 14 | 扩大 CodeChunker 语言支持（C/C++、Rust、Go、Ruby、PHP、Kotlin、Swift） | 产品 | P2 | 覆盖 GitHub 80% 活跃仓库 |
| 15 | 平台化考虑：per-instance 配置持久化、API 层的 --format jsonl | 产品 | P2 | 面向 power user 的可编程性 |

---

## ⚠️ 待完善 / 已知局限

- **VS Code 扩展开发周期**：估计 3-4 周，需要独立的前端/Node.js 开发资源。可以先做 MVP（搜索框 + 结果列表 + 一键配置），后续迭代添加文件预览、状态面板、实时索引进度。
- **并发安全**：当前单用户 MCP 模式下竞态条件概率很低，但如果未来支持多客户端或多 AI 助手同时调用，需要基于文件路径的互斥锁。调查员已标记此风险。
- **sharp/libvips CVE**：依赖 Transformers.js 升级，非本项目可控。当前默认 text-only 模型不受影响。
- **大仓库性能**：10 万+ chunk 的摄入和搜索延迟无实测数据，建议在 benchmark suite 中加入 linux kernel 级别的测试项目。
- **PDF 视觉模式**：建议暂时冻结投入。如果在后续版本中有明确的用户需求信号（如 issue 或讨论），再重新评估。

---

## 📚 成员产出索引

- gstack-product-reviewer（产品评审员）原始产出：CEO + Design + Eng + DX 四阶段评审，含竞争对手对比和路线图建议
- gstack-security-officer（安全官）原始产出：14 阶段完整审计报告，12 项发现 + STRIDE 威胁矩阵 + 依赖风险矩阵
- gstack-qa-lead（QA Lead）原始产出：详细的 Exhaustive 级别 QA 报告（`deliverables/qa-assessment-report.md`），含模块覆盖矩阵、CI 评估、错误处理审查
- gstack-investigator（调查员）原始产出：架构耦合度、技术债、性能瓶颈、可维护性全方位诊断，含治理工具仪表板

---

> 本报告由软件工坊 AI 协作生成，关键决策请由工程负责人复核。所有专业产出（安全审计结论、QA 测试结果、产品路线图建议、代码健康诊断）均由对应专家成员独立分析后输出，主理人负责编排汇编。
