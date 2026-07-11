# 管理与维护

---

## Tools

### list_files —— 列出已摄入文件

```
list_files({ scope?: string | string[] })
```

- `scope` 可选，限定目录前缀（必须绝对路径）
- 返回每个文件的摄入状态、chunk 数量等
- `ingest_data` 摄入的 sources 始终被列出，不受 scope 限制

---

### delete_file —— 删除已摄入内容

```
delete_file({ filePath: string })
// 或
delete_file({ source: string })
```

- `filePath` 和 `source` 二选一
- 幂等：目标不存在也返回成功

---

### status —— 查看统计

```
status()
```

无参数。返回：文件总数、chunk 总数、数据库路径、已配置的根目录等。

**诊断用途**：当用户反馈搜索不到内容或摄入范围异常时，先调用 `status` 检查当前配置的根目录和有效 warning。

---

## 文档根目录（安全边界）

所有 ingest / list / delete / read_chunk_neighbors 操作均被限制在已配置的根目录内。

| 方式 | 说明 | 场景 |
|------|------|------|
| `BASE_DIR` 环境变量 | 单路径 | 单根目录（兼容旧版） |
| `BASE_DIRS` 环境变量 | JSON 数组，如 `'["/a","/b"]'` | 多根目录 |
| CLI `--base-dir` | 可重复参数 | CLI 多根目录，会覆盖环境变量 |

**优先级**：CLI `--base-dir` > `BASE_DIRS` > `BASE_DIR` > `process.cwd()`

**配置警告**（作为响应中的附加 content block 出现）：
- `BASE_DIRS is set; BASE_DIR is ignored.` → 两者同时配置，BASE_DIR 被自动忽略
- `Nested base directory pruned: <child> is inside <parent>.` → 配置了嵌套的根目录，子目录被裁剪

---

## CLI 速查

| 操作 | CLI 命令 |
|------|---------|
| 摄入文件 | `npx mcp-local-rag ingest <path> [--visual] [--visual-quality fast\|quality]` |
| 摄入目录 | `npx mcp-local-rag ingest <dir>` |
| 搜索 | `npx mcp-local-rag query <text> [--limit n] [--scope prefix]` |
| 列出 | `npx mcp-local-rag list [--base-dir path] [--scope prefix]` |
| 状态 | `npx mcp-local-rag status` |
| 删除 | `npx mcp-local-rag delete [--source url] [path]` |
| 上下文 | `npx mcp-local-rag read-neighbors --file-path <abs-path> --chunk-index <n> [--before n] [--after n]` |

CLI 全局选项（`--db-path`, `--cache-dir`, `--model-name`）优先级：CLI 参数 > 环境变量 > 默认值。

**Config 匹配**：对已有数据库操作时，`--model-name` 等选项必须与 MCP server 配置一致。切换模型会改变向量空间，搜索质量无声降级。

详见 [references/cli-reference.md](../references/cli-reference.md)。
