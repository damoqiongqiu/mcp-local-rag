// CodeChunker: AST-aware code chunking via tree-sitter.
//
// Delegates to the `code-chunk` package (supermemoryai/code-chunk)
// which uses tree-sitter to split source code at semantic boundaries
// (functions, classes, methods) rather than arbitrary character limits.
// Each chunk is enriched with scope chain, imports, and entity
// signatures via `contextualizedText`, which is used for embedding
// while the raw `text` is stored in the vector DB.

import { extname } from 'node:path'
import { chunk } from 'code-chunk'
import type { ChunkerInterface, TextChunk } from './index.js'

// Re-export so callers can detect code-chunk errors without importing
// the package directly.
export {
  ChunkingError,
  UnsupportedLanguageError,
} from 'code-chunk'

// ============================================
// CodeChunker
// ============================================

/**
 * Options forwarded to `code-chunk`'s `chunk()`.
 *
 * Defaults are tuned for RAG embedding:
 * - `contextMode: 'full'` — rich scope-chain, imports, and entities
 * - `maxChunkSize: 1500` — code-chunk's default; keeps chunks compact
 *   enough for embedding models
 */
export interface CodeChunkerOptions {
  /** Maximum chunk size in bytes (default: 1500). */
  maxChunkSize?: number
  /** Context detail level (default: 'full'). */
  contextMode?: 'none' | 'minimal' | 'full'
  /** Sibling entity detail (default: 'signatures'). */
  siblingDetail?: 'none' | 'names' | 'signatures'
  /** Filter out import statements (default: false). */
  filterImports?: boolean
  /** Lines from previous chunk to include in `contextualizedText`. */
  overlapLines?: number
}

/**
 * AST-aware code chunker for RAG pipelines.
 *
 * Uses tree-sitter to parse source code into an AST and split at
 * semantic boundaries. Produces `TextChunk` values where:
 * - `text` = raw code chunk (stored in vector DB)
 * - `textForEmbedding` = `contextualizedText` from code-chunk
 *   (scope-enriched text optimised for embedding similarity)
 *
 * The file path is required at construction time for language
 * detection via extension.
 *
 * Unsupported languages throw `UnsupportedLanguageError`; parse
 * failures throw `ChunkingError` (both re-exported from this module).
 */
export class CodeChunker implements ChunkerInterface {
  private readonly filePath: string
  private readonly options: {
    maxChunkSize: number
    contextMode: 'none' | 'minimal' | 'full'
    siblingDetail: 'none' | 'names' | 'signatures'
    filterImports: boolean
    overlapLines: number
  }

  /**
   * @param filePath Absolute or relative file path (used for language
   *   detection via extension).
   * @param options Chunking options forwarded to `code-chunk`.
   */
  constructor(filePath: string, options: CodeChunkerOptions = {}) {
    this.filePath = filePath
    this.options = {
      maxChunkSize: options.maxChunkSize ?? 1500,
      contextMode: options.contextMode ?? 'full',
      siblingDetail: options.siblingDetail ?? 'signatures',
      filterImports: options.filterImports ?? false,
      overlapLines: options.overlapLines ?? 10,
    }
  }

  /**
   * Chunk source code at AST semantic boundaries.
   *
   * The `embedder` parameter is accepted to satisfy `ChunkerInterface`
   * but is ignored — CodeChunker uses AST structure, not embeddings,
   * to determine chunk boundaries.
   *
   * @param text Source code string.
   * @returns Array of `TextChunk` values. Empty array when `text` is
   *   empty/whitespace-only (match SemanticChunker contract).
   */
  async chunkText(text: string): Promise<TextChunk[]> {
    if (!text || text.trim().length === 0) {
      return []
    }

    const rawChunks = await chunk(this.filePath, text, {
      maxChunkSize: this.options.maxChunkSize,
      contextMode: this.options.contextMode,
      siblingDetail: this.options.siblingDetail,
      filterImports: this.options.filterImports,
      overlapLines: this.options.overlapLines,
    })

    return rawChunks.map(
      (raw) =>
        ({
          text: raw.text,
          index: raw.index,
          textForEmbedding: raw.contextualizedText,
        }) satisfies TextChunk
    )
  }
}

// ============================================
// Helper: is a file extension handled by CodeChunker?
// ============================================

/**
 * File extensions supported by `code-chunk`'s tree-sitter parsers.
 *
 * This set is the authoritative list — code-chunk's `detectLanguage`
 * returns `null` for anything not in this list, and `chunk()` throws
 * `UnsupportedLanguageError`.
 */
const CODE_CHUNK_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.pyi',
  '.rs',
  '.go',
  '.java',
])

/**
 * Return `true` when `filePath` has an extension supported by
 * `code-chunk`'s tree-sitter parsers. Callers use this to decide
 * whether to route through `CodeChunker` or `SemanticChunker`.
 */
export function isCodeChunkExtension(filePath: string): boolean {
  return CODE_CHUNK_EXTENSIONS.has(extname(filePath).toLowerCase())
}
