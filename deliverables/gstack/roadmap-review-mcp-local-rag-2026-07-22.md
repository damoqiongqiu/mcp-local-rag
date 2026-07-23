# mcp-local-rag 项目全面审视与路线图建议

**日期**：2026-07-22
**场景**：产品评审 + 安全审计 + QA 质量审视
**参与成员**：产品评审员 + 安全官 + QA Lead（调查员超时未响应，代码健康维度缺失）

---

## 📌 TL;DR（执行摘要）
- 整体结论：🟡 有条件通过 — 产品方向清晰，安全基础扎实，但存在 1 个严重安全漏洞 + 核心功能零测试覆盖
- 阻塞项数量：🔴 2 个（TOCTOU 竞态条件 + code-chunker 零测试）、🟡 多项 P1 改进
- 项目找到「代码智能 + MCP + 本地隐私」利基，但增量索引缺失、VS Code 生态缺位、错误信息不可操作是三座大山
- 推荐三个月冲刺路线：修复安全漏洞 → 补齐测试 → VS Code 扩展 → GitHub Action

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| Go / No-Go | 🟡 条件 Go（先修 P0，后可全力推进功能） |
| 严重度分布 | 🔴 3 / 🟡 12 / 🟢 7 |
| 关键行动项 | 15 条 |
| 建议负责人 | 主程修 TOCTOU + code-chunker 测试；DevOps 加 CI 覆盖率门禁 |

---

## 1. 各成员核心结论

### 🔍 产品评审员（产品策略）
- 核心判断：项目在「代码智能 + MCP + 本地隐私」交叉点找到了真实利基，AST 级代码分块是护城河。但产品定位偏窄——"MCP 协议"既是差异化优势也是受众天花板。
- 关键建议：**VS Code 扩展是第一优先级**（降低 90% 配置摩擦，打开最大用户群）；其次是 GitHub Action（CI 预构建索引）、增量索引 + 内容哈希缓存（解决 1000+ 文件项目的灾难体验）。不做 Web UI、不做 LangChain 集成——偏离核心定位。

### 🛡️ 安全官（OWASP+STRIDE 审计）
- 核心判断：安全基础扎实（B+ 评级）——实时路径沙箱、错误信息从不泄露栈追踪、SQL/LIKE 转义规范。但发现 **1 个严重 TOCTOU 竞态条件**：文件验证和实际读取之间存在窗口，可通过符号链接交换绕过沙箱读取任意文件。
- 关键建议：P0 立即修 TOCTOU（`validateFilePath` 返回 realpath 而非 void）；P1 修 `export_index` 任意路径写入、`ingest_data` 无上限 DoS、代理 URL 凭证泄漏。整体安全设计值得肯定，但细节处的疏忽需要补齐。

### ✅ QA Lead（测试与发布）
- 核心判断：测试文件 68 个、断言 2892 条，覆盖面较广。CI 双平台 + 模型缓存架构设计优秀。但 **AST 代码分块（code-chunker.ts）零测试覆盖**——这是项目的核心差异化功能。另外 `server.json` 版本过期（0.18.9 vs 0.19.2），发布流程存在版本一致性问题。
- 关键建议：P0 补齐 code-chunker 测试 + 修复 server.json 版本同步；P1 加覆盖率阈值到 CI、加 macOS runner、自动化 E2E 测试、npm 自动发布 workflow。

### 🔧 调查员（代码健康）
- ⚠️ 调查员 agent 超时未响应，架构/性能/内存/技术债维度暂缺。建议后续独立补跑。

---

## 2. 综合审查发现（去重合并，按严重度排序）

| # | 严重度 | 类别 | 位置 | 问题描述 | 建议 | 来源成员 |
|---|--------|------|------|---------|------|---------|
| 1 | 🔴 严重 | 安全 | `src/parser/index.ts:248-318` → `608-617` | TOCTOU 竞态：validateFilePath 验证后返回 void，readFile 仍使用原始路径，可被符号链接交换绕过沙箱 | validateFilePath 改为返回 realpath，后续读取使用验证后的路径 | 安全官 |
| 2 | 🔴 严重 | 测试 | `src/chunker/code-chunker.ts` | AST 代码分块零测试覆盖——核心差异化功能无质量保障 | 添加单元测试：基本分块、AST entity 提取、import 元数据、作用域链注入、边界条件 | QA Lead |
| 3 | 🔴 严重 | 发布 | `server.json:2` | 版本 0.18.9，与 package.json 0.19.2 不一致，MCP registry 发布可能异常 | CI 添加 version-consistency 检查 | QA Lead |
| 4 | 🟠 高危 | 安全 | `src/server/index.ts:1613-1618` | export_index 的 outputPath 参数零验证，可写入任意路径（含 ~/.bashrc、~/.ssh/authorized_keys） | 限定 outputPath 在 dbPath 内，或去掉参数改为固定路径 | 安全官 |
| 5 | 🟠 高危 | 安全 | `src/server/index.ts:740-813` | ingest_data 无内容大小上限，可发送 GB 级字符串导致 OOM | 添加 MAX_INGEST_DATA_SIZE 限制（建议 100MB） | 安全官 |
| 6 | 🟠 高危 | 安全 | `src/embedder/index.ts:123` | 代理 URL 含凭证时直接打印到 stderr，日志可能泄露密码 | 解析 URL，仅记录 protocol://host:port | 安全官 |
| 7 | 🟠 高危 | 产品 | 全局 | 无增量索引/嵌入缓存——reindex_all 每次全量重做，1000+ 文件项目体验灾难 | 内容哈希缓存，跳过未修改文件 | 产品评审员 |
| 8 | 🟠 高危 | 产品 | MCP 接口 | 首次模型下载无进度反馈，MCP 客户端在 stdio 上看不到进度，用户误以为卡死 | 通过 MCP logging/notification 发送下载进度 | 产品评审员 |
| 9 | 🟡 中危 | 产品 | MCP 工具 | 无健康检查/诊断工具，用户遇到 "tool not found" 只能手动排查 | 新增 health_check MCP 工具 | 产品评审员 |
| 10 | 🟡 中危 | 测试 | CI 流水线 | 无覆盖率阈值强制，无法防止覆盖率回归 | 配置 vitest coverage + CI 门禁 | QA Lead |
| 11 | 🟡 中危 | 测试 | CI 矩阵 | 缺少 macOS runner 和 Node 版本矩阵 | 添加 macOS-latest 到 CI；测试 Node 22.x/23.x | QA Lead |
| 12 | 🟡 中危 | 测试 | CI 流程 | E2E 测试未在 CI 运行（RUN_E2E=1 从不设置） | 在 main 分支 CI 中启用 E2E | QA Lead |
| 13 | 🟡 中危 | 产品 | MCP 接口 | 错误信息缺乏可操作性——LanceDB 底层错误直接透传，用户不知如何修复 | 建立错误→修复建议映射表 | 产品评审员 |
| 14 | 🟡 中危 | 产品 | CLI | query 无分页（上限 20 条），无语义缓存预热 | 加 cursor-based 分页；加模型预热选项 | 产品评审员 |
| 15 | 🟡 中危 | 安全 | `src/server-main.ts:230-231` | HF_ENDPOINT 无验证，可重定向到恶意服务器下载后门模型 | 验证 HTTPS 或 localhost；RAG_DEVICE 加白名单 | 安全官 |
| 16 | 🟢 低危 | 产品 | 生态 | 不支持图片/PPT/Excel 摄入 | P2 添加 PPT 文本提取、图片 OCR | 产品评审员 |
| 17 | 🟢 低危 | 测试 | `src/utils/gitignore.ts` | gitignore 过滤逻辑无测试 | 添加单元测试 | QA Lead |
| 18 | 🟢 低危 | 安全 | `src/server/index.ts:1877-1934` | fs.watch 可能跟随符号链接，但后续 validateFilePath 会拦截 | 防御性添加 isSymbolicLink 检查 | 安全官 |
| 19 | 🟢 低危 | 安全 | 全局 | 无请求频率限制 | P2 添加 token-bucket 限流 | 安全官 |
| 20 | 🟢 低危 | 产品 | CLI/配置 | 无 .mcp-local-rag.toml 配置文件支持；CLI 无 shell completion | P2 添加配置文件和自动补全 | 产品评审员 |

---

## ✅ 行动清单

| # | 行动 | 负责方 | 紧急度 | 期望完成 |
|---|------|--------|--------|---------|
| 1 | **修复 TOCTOU 竞态**：validateFilePath 返回 realpath，所有后续 readFile 使用验证后的路径 | 主程 | 🔴 P0 | 本周 |
| 2 | **code-chunker 测试补齐**：TypeScript/JS/Python 分块 + AST entity + import 元数据 + 作用域链 + 边界条件 | 主程 | 🔴 P0 | 本周 |
| 3 | **server.json 版本同步**：CI 中添加 version-consistency 检查步骤 | DevOps | 🔴 P0 | 本周 |
| 4 | **修复 export_index 路径写入**：限定 outputPath 在 dbPath 内，或移除自定义路径参数 | 主程 | 🟠 P1 | 两周内 |
| 5 | **ingest_data 添加大小限制**：MAX_INGEST_DATA_SIZE = 100MB | 主程 | 🟠 P1 | 两周内 |
| 6 | **代理 URL 脱敏日志**：仅记录 protocol://host:port | 主程 | 🟠 P1 | 两周内 |
| 7 | **内容哈希缓存（skip unchanged files）**：reindex 跳过未修改文件 | 主程 | 🟠 P1 | 一个月 |
| 8 | **首次模型下载进度通知**：MCP logging/notification 报告下载进度 | 主程 | 🟠 P1 | 一个月 |
| 9 | **健康检查/诊断 MCP 工具**：自动诊断模型加载、LanceDB、BASE_DIR 状态 | 主程 | 🟠 P1 | 一个月 |
| 10 | **CI 覆盖率门禁**：vitest --coverage + 初始阈值 70% line / 60% branch | DevOps | 🟠 P1 | 一个月 |
| 11 | **CI 添加 macOS runner**：static-checks + test job | DevOps | 🟠 P1 | 一个月 |
| 12 | **CI 启用 E2E 测试**：main 分支设置 RUN_E2E=1 | DevOps | 🟠 P1 | 一个月 |
| 13 | **错误信息可操作化**：常见底层错误 → 修复建议映射表 | 主程 | 🟡 P2 | 下季度 |
| 14 | **VS Code 扩展**：自动配置 MCP + 一键摄入 | 产品/主程 | 🟡 P2 | 下季度 |
| 15 | **GitHub Action**：CI 预构建索引 | DevOps | 🟡 P2 | 下季度 |

---

## 3. 三个月路线图建议

### 第 1 个月：修漏洞 + 补测试（质量加固）
- P0 安全修复（TOCTOU、export_index、ingest_data 限制、代理脱敏）
- code-chunker 测试补齐
- CI 覆盖率门禁上线
- server.json 版本一致性问题修复

### 第 2 个月：增量索引 + DX 提升（产品可用性）
- 内容哈希缓存（增量索引）
- 首次模型下载进度通知
- 健康检查工具
- 错误信息可操作化改造
- query 分页支持

### 第 3 个月：生态扩展（用户增长）
- VS Code 扩展 MVP
- GitHub Action
- macOS CI + E2E 自动化
- Shell completion + CLI query pretty-print

---

## ⚠️ 待完善 / 已知局限

- **调查员未响应**：代码健康维度（架构边界、性能瓶颈、内存管理、技术债）尚未覆盖，建议后续独立补跑
- **AST 分块依赖风险**：产品评审员指出 `code-chunk` 包（v0.1.14）是单点故障，需评估 fork 或自研 tree-sitter 集成的可行性
- **无性能基准**：缺少 ingest 吞吐量、search 延迟、embed 吞吐量的性能回归测试
- **npm 自动发布缺失**：当前仅 MCP registry 有自动发布，npm 发布仍需手动

---

## 📚 成员产出索引

- gstack-product-reviewer（产品评审员）原始产出：对话中完整回传，含竞争格局对比、功能缺口分析、DX 评估、生态策略、优先级排序
- gstack-security-officer（安全官）原始产出：对话中完整回传，含 11 项发现（F-001 ~ F-011）、STRIDE 威胁模型、修复路线图
- gstack-qa-lead（QA Lead）原始产出：对话中完整回传，含测试覆盖评估、CI/CD 审视、发布流程审计、兼容性分析、14 条改进建议
- gstack-investigator（调查员）：超时未响应，代码健康维度缺失

---

> 本报告由软件工坊 AI 协作生成，关键决策请由工程负责人复核。
