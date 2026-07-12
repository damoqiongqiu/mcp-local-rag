// Type definitions for RAGServer

import type { BaseDirsConfigError } from '../utils/base-dirs.js'
import type { ContentFormat } from '../utils/raw-data-utils.js'
import type { GroupingMode } from '../vectordb/index.js'

/**
 * Fields shared by both `RAGServerConfig` shapes (legacy single-root and
 * multi-root). Extracted so the union below only needs to describe the
 * `baseDir` / `baseDirs` axis.
 */
interface RAGServerConfigBase {
  /** LanceDB database path */
  dbPath: string
  /** Transformers.js model path */
  modelName: string
  /** Model cache directory */
  cacheDir: string
  /** HuggingFace hub endpoint (mirror URL) — sets env.remoteHost for model downloads */
  remoteHost?: string
  /** Enable auto-mirror detection (HF_AUTO_MIRROR). Default: true */
  autoMirror?: boolean
  /** HTTPS/HTTP proxy URL for model downloads — creates ProxyAgent-aware fetch */
  proxy?: string
  /** Maximum file size (100MB) */
  maxFileSize: number
  /** Compute device (cpu, webgpu, dml, etc) */
  device?: string
  /** Embedding quantization dtype (fp32, fp16, q8, int8, ...). Unset → fp32. */
  dtype?: string
  /** Maximum distance threshold for quality filtering (optional) */
  maxDistance?: number
  /** Grouping mode for quality filtering (optional) */
  grouping?: GroupingMode
  /** Hybrid search weight for BM25 (0.0 = vector only, 1.0 = BM25 only, default 0.6) */
  hybridWeight?: number
  /** Maximum number of files to keep in search results (optional) */
  maxFiles?: number
  /** Minimum chunk length in characters (optional, default: 50) */
  chunkMinLength?: number
  /**
   * Normal-path (resolve()) roots, index-aligned with the realpath'd `baseDirs`
   * security boundary; used for user-facing `list_files` scan/display so paths
   * match the resolve()-stored DB keys. From `BaseDirsConfig.rawBaseDirs` (see
   * it for the path policy). Optional: legacy `{ baseDir }` callers fall back to
   * `baseDirs`.
   */
  rawBaseDirs?: readonly string[]
  /** Configuration validation warnings to surface to users via MCP annotations */
  configWarnings?: string[]
  /**
   * Structured base-dirs resolution error. When present, the server is in
   * degraded mode: `status` remains callable so the user can diagnose the
   * problem via MCP, while root-dependent tools surface the error before
   * doing DB or filesystem work. See `resolveBaseDirs` for the error
   * semantics.
   */
  configError?: BaseDirsConfigError
}

/**
 * RAGServer configuration.
 *
 * Accepts either a single `baseDir` (legacy shape — preserved so existing
 * direct callers and tests that pass `{ baseDir }` continue to work) or
 * `baseDirs` (multi-root shape produced by `resolveBaseDirs`). Exactly one
 * of the two MUST be supplied. The constructor normalizes both into a single
 * `baseDirs: string[]` internally and derives the legacy `baseDir` accessor
 * as `baseDirs[0]`.
 */
export type RAGServerConfig =
  | (RAGServerConfigBase & {
      /** Document base directory (legacy single-root shape). */
      baseDir: string
      baseDirs?: undefined
    })
  | (RAGServerConfigBase & {
      /** One or more allowed document base directories (multi-root shape). */
      baseDirs: string[]
      baseDir?: undefined
    })

/**
 * query_documents tool input
 */
export interface QueryDocumentsInput {
  /** Natural language query */
  query: string
  /** Number of results to retrieve (default 10) */
  limit?: number
  /** Path prefix scope (one or a list); the parser normalizes to `string[]`. */
  scope?: string | string[]
  /** ISO 8601 timestamp — only chunks ingested on or after this time */
  fromTimestamp?: string
  /** ISO 8601 timestamp — only chunks ingested on or before this time */
  untilTimestamp?: string
  /** Characters of context around query-term matches (0-500, default 0) */
  highlightContext?: number
}

/**
 * list_files tool input
 */
export interface ListFilesInput {
  /** Path prefix scope (one or a list); the parser normalizes to `string[]`. */
  scope?: string | string[]
}

/**
 * ingest_file tool input
 */
export interface IngestFileInput {
  /** File path */
  filePath: string
  /**
   * When true and `filePath` is a PDF, the visual enrichment path runs
   * (VLM captioning of figure-heavy pages). For non-PDF files this flag is
   * silently coerced to the default text-only path. The runtime check at the
   * handler boundary stays in place because MCP arguments arrive as `unknown`
   * from the SDK.
   */
  visual?: boolean
  /**
   * Visual-quality profile when `visual` is true. Some MCP clients send the
   * empty string for unspecified optional parameters, so the boundary
   * handler also accepts `""` and normalizes it to `'fast'`. The internal
   * `QualityProfile` type stays narrow (`'fast' | 'quality'`); `""` does
   * not propagate past `handleIngestFile`.
   */
  visualQuality?: 'fast' | 'quality' | ''
}

/**
 * ingest_data tool input metadata
 */
interface IngestDataMetadata {
  /** Source identifier: URL ("https://...") or custom ID ("clipboard://2024-12-30") */
  source: string
  /** Content format */
  format: ContentFormat
}

/**
 * ingest_data tool input
 */
export interface IngestDataInput {
  /** Content to ingest (text, HTML, or Markdown) */
  content: string
  /** Content metadata */
  metadata: IngestDataMetadata
}

/**
 * delete_file tool input
 * Either filePath or source must be provided
 */
export interface DeleteFileInput {
  /** File path (for files ingested via ingest_file) */
  filePath?: string
  /** Source identifier (for data ingested via ingest_data) */
  source?: string
}

/**
 * delete_file tool output
 */
export interface DeleteFileResult {
  /** Resolved file path used for the delete operation */
  filePath: string
  /** True when the delete operation completed (idempotent; not "something was removed") */
  deleted: true
  /** Number of vector chunks removed from the database */
  removedChunks: number
  /** True when ingested chunks and/or raw-data artifacts existed before delete */
  existed: boolean
  /** Timestamp */
  timestamp: string
}

/**
 * ingest_file tool output
 */
export interface IngestResult {
  /** File path */
  filePath: string
  /** Chunk count */
  chunkCount: number
  /** Timestamp */
  timestamp: string
  /** Document title extracted from file content (display-only, not used for scoring) */
  fileTitle: string | null
}

/**
 * list_files tool output — entry for a file found under one of the effective
 * base directories.
 *
 * `baseDir` identifies the producing root (one of `ListFilesResult.baseDirs`).
 * Always present, including in single-root configurations — the field is
 * additive over the legacy shape, so existing clients that ignore it continue
 * to work.
 *
 * `stale` (optional): when `ingested` is true and the file's mtime on disk
 * is newer than the ingestion timestamp, this is set to `true`, indicating
 * the file has been modified since last ingestion and should be re-indexed.
 */
export type FileEntry =
  | {
      filePath: string
      baseDir: string
      ingested: true
      chunkCount: number
      timestamp: string
      stale?: boolean
    }
  | { filePath: string; baseDir: string; ingested: false }

/**
 * list_files tool output — entry for content ingested via ingest_data,
 * or an orphaned DB entry whose file no longer exists on disk
 */
export type SourceEntry =
  | { source: string; chunkCount: number; timestamp: string }
  | { filePath: string; chunkCount: number; timestamp: string }

/**
 * list_files tool output.
 *
 * Multi-root contract:
 * - `baseDirs`: all effective roots (normal resolve() form, nested-root pruned).
 * - `baseDir`: the first effective root (`baseDirs[0]`). Preserved as a
 *   legacy field so clients written against the single-root shape continue to
 *   work.
 * - `files`: union across roots, each annotated with its producing `baseDir`.
 *   Exact duplicate paths across roots are de-duplicated (first occurrence
 *   wins, preserving root iteration order).
 * - `sources`: raw-data entries (from `ingest_data`) and orphaned DB entries
 *   whose files no longer exist on disk. Sources are not produced by any
 *   root, so they carry no `baseDir` annotation.
 */
export interface ListFilesResult {
  baseDir: string
  baseDirs: string[]
  files: FileEntry[]
  sources: SourceEntry[]
}

/**
 * matchContext — a highlighted snippet showing where query terms appear in a chunk
 */
export interface MatchContext {
  /** Text before the match */
  before: string
  /** Exactly the matched text */
  match: string
  /** Text after the match */
  after: string
}

/**
 * query_documents tool output
 */
export interface QueryResult {
  /** File path */
  filePath: string
  /** Chunk index */
  chunkIndex: number
  /** Text */
  text: string
  /** Similarity score */
  score: number
  /** Original source (only for raw-data files, e.g., URLs ingested via ingest_data) */
  source?: string
  /** Document title extracted from file content (display-only, not used for scoring) */
  fileTitle: string | null
  /** Highlighted match contexts (only when highlightContext > 0 in query) */
  matchContext?: MatchContext[]
}

/**
 * read_chunk_neighbors tool input.
 * Exactly one of filePath / source must be provided (XOR).
 */
export interface ReadChunkNeighborsInput {
  /** File path (for files ingested via ingest_file). Absolute path required. */
  filePath?: string
  /** Source identifier (for data ingested via ingest_data). */
  source?: string
  /** Target chunk index (zero-based, required, non-negative integer). */
  chunkIndex: number
  /** Number of chunks before the target to include (default 2, non-negative integer). */
  before?: number
  /** Number of chunks after the target to include (default 2, non-negative integer). */
  after?: number
}

/**
 * read_chunk_neighbors tool output item.
 * Core fields are {filePath, chunkIndex, text}. `isTarget` is true only for
 * the requested target when it exists, and `source` is present only on
 * raw-data rows.
 * fileTitle mirrors QueryResult for drop-in consistency with query_documents results.
 */
export interface ReadChunkNeighborsResultItem {
  /** File path */
  filePath: string
  /** Chunk index */
  chunkIndex: number
  /** Text */
  text: string
  /** True iff this chunk's chunkIndex matches the requested target. */
  isTarget: boolean
  /** Original source (only for raw-data files, e.g., URLs ingested via ingest_data). */
  source?: string
  /** Document title extracted from file content (display-only, not used for scoring) */
  fileTitle: string | null
}

/**
 * ingest_directory tool input
 */
export interface IngestDirectoryInput {
  /** Absolute path to the directory to ingest. Must be within a configured base directory. */
  path: string
  /**
   * File extension filter (e.g., ["ts", "tsx", "js"]). When provided, only
   * files with matching extensions (case-insensitive, without leading dot)
   * are ingested. When omitted, all supported file types are ingested.
   */
  extensionFilter?: string[]
}

/**
 * ingest_directory tool output — per-file summary item
 */
export interface IngestDirectoryFileResult {
  /** File path that was processed */
  filePath: string
  /** Status: "ok" | "skipped" (0 chunks) | "error" */
  status: 'ok' | 'skipped' | 'error'
  /** Number of chunks created (0 for skipped/error) */
  chunkCount: number
  /** Error message (only present when status is "error") */
  error?: string
}

/**
 * ingest_directory tool overall output
 */
export interface IngestDirectoryResult {
  /** The directory that was processed */
  directory: string
  /** Total files discovered */
  totalFiles: number
  /** Files successfully ingested */
  succeeded: number
  /** Files skipped (empty content) */
  skipped: number
  /** Files that failed */
  failed: number
  /** Total chunks created across all files */
  totalChunks: number
  /** Per-file result details */
  files: IngestDirectoryFileResult[]
  /** Operation timestamp */
  timestamp: string
}

/**
 * reindex_all tool input
 */
export interface ReindexAllInput {
  /** Whether to run optimize() after all files are re-ingested (default true) */
  optimizeAfter?: boolean
}

/**
 * reindex_all tool output
 */
export interface ReindexAllResult {
  /** Total files that were re-ingested */
  reindexed: number
  /** Files that succeeded */
  succeeded: number
  /** Files that failed */
  failed: number
  /** Total chunks created */
  totalChunks: number
  /** Operation timestamp */
  timestamp: string
}

/**
 * config tool input — all fields optional (read when none provided)
 */
export interface ConfigInput {
  hybridWeight?: number
  maxDistance?: number
  maxFiles?: number
  grouping?: 'similar' | 'related'
  /**
   * Switch the active embedding model at runtime. Changing the model
   * invalidates existing vectors (different dimensions), so the response
   * includes a `reindexRecommended` flag when this is used.
   */
  modelName?: string
}

/**
 * config tool output — full config snapshot
 */
export interface ConfigResult {
  hybridWeight: number
  maxDistance?: number
  maxFiles?: number
  grouping?: string
  modelName: string
  /** Approximate model size in MB, or undefined for unknown models */
  modelSizeMb?: number
  /** Embedding vector dimension, or undefined for unknown models */
  modelDimension?: number
  dbPath: string
  device: string
  /**
   * Set to true when modelName was changed in this config call, indicating
   * that existing vectors were generated with a different model and a
   * reindex_all is recommended.
   */
  modelChanged?: boolean
}

/**
 * export_index tool input
 */
export interface ExportIndexInput {
  /** Absolute path for the export file, defaults to auto-generated */
  outputPath?: string
}

/**
 * export_index tool output
 */
export interface ExportIndexResult {
  /** Path to the exported file */
  exportPath: string
  /** Number of documents exported */
  documentCount: number
  /** Number of chunks exported */
  chunkCount: number
  /** Export file size in bytes */
  fileSize: number
  /** Operation timestamp */
  timestamp: string
}

/**
 * dedup_check tool input
 */
export interface DedupCheckInput {
  /** Similarity threshold (0.5-1.0, default 0.8) */
  threshold?: number
}

/**
 * dedup_check tool output — a single duplicate pair
 */
export interface DedupPair {
  fileA: string
  fileB: string
  /** Similarity ratio (0-1), higher = more overlap */
  similarity: number
  /** Number of overlapping chunks */
  overlappingChunks: number
  /** Total unique chunks across both files */
  totalUniqueChunks: number
}

/**
 * dedup_check tool output
 */
export interface DedupCheckResult {
  /** Number of duplicate pairs found */
  pairCount: number
  /** Duplicate pairs, sorted by similarity descending */
  pairs: DedupPair[]
  /** Operation timestamp */
  timestamp: string
}

// ── find_definition ──────────────────────────────────────────────────

/**
 * find_definition tool input
 */
export interface FindDefinitionInput {
  /** Symbol name to locate the definition of. */
  symbolName: string
}

/**
 * A single definition match.
 */
export interface DefinitionMatch {
  /** File path (absolute). */
  filePath: string
  /** Chunk index (zero-based). */
  chunkIndex: number
  /** Name of the defined entity. */
  entityName: string
  /** Entity type: function, method, class, interface, type, enum. */
  entityType: string
  /**
   * Line range of the definition in the source file (0-indexed, inclusive).
   * Absent when the entity spans the full chunk without precise AST line info.
   */
  lineRange?: { start: number; end: number }
  /**
   * Scope chain from current scope to root.
   * Absent when the chunk has no scope metadata.
   */
  scope?: Array<{ name: string; type: string }>
}

/**
 * find_definition tool output
 */
export interface FindDefinitionResult {
  /** Total number of definition matches found. */
  totalMatches: number
  /** Definition matches. */
  matches: DefinitionMatch[]
}

// ── find_references ──────────────────────────────────────────────────

/**
 * find_references tool input
 */
export interface FindReferencesInput {
  /** Symbol name to locate references for. */
  symbolName: string
  /**
   * Maximum number of matches to return (default 10, valid range 1-50).
   * The actual count may be lower when fewer matches exist.
   */
  limit?: number
}

/**
 * A single reference match: either an import statement or a text mention
 * found via FTS.
 */
export interface ReferenceMatch {
  /** File path (absolute). */
  filePath: string
  /** Chunk index (zero-based). */
  chunkIndex: number
  /** How the reference was found. */
  referenceType: 'import' | 'text_mention'
  /**
   * Surrounding text snippet (~200 chars). Always present for `text_mention`;
   * absent for `import` references.
   */
  context?: string
  /**
   * Import source module/path. Only present for `import` references.
   */
  importSource?: string
  /**
   * Whether it's a default import. Only present for `import` references.
   */
  isDefault?: boolean
  /**
   * Whether it's a namespace import (`import * as`). Only present for
   * `import` references.
   */
  isNamespace?: boolean
}

/**
 * find_references tool output
 */
export interface FindReferencesResult {
  /** Total number of unique reference matches found before limit. */
  totalMatches: number
  /** Reference matches, sorted by referenceType (imports first) then filePath. */
  matches: ReferenceMatch[]
}
