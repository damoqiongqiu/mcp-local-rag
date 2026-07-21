// Multi-instance configuration types.
//
// Defines the core types used by the RAG_INSTANCES parser and resolver
// to represent named instance configurations, warnings, and errors.

export interface InstanceConfig {
  /** 实例名称，用于 CLI --instance 和 MCP 工具的 instance 参数 */
  name: string
  /** 该实例的文档根目录（绝对路径，realpath 标准化后） */
  baseDir: string
  /** 该实例的 LanceDB 存储路径 */
  dbPath: string
  /** 原始用户提供的 baseDir（标准化前，用于显示/日志） */
  rawBaseDir: string
}

export interface InstanceConfigWarning {
  kind: 'nested-base-dir' | 'duplicate-name' | 'db-path-conflict' | 'base-dirs-deprecated'
  message: string
}

export interface InstanceConfigResult {
  instances: InstanceConfig[]
  warnings: InstanceConfigWarning[]
}

export class InstanceConfigError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause ? { cause } : undefined)
    this.name = 'InstanceConfigError'
  }
}
