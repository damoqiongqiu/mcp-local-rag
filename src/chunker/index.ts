import type { EmbedderInterface } from './semantic-chunker.js'

/**
 * AST-level code metadata stored alongside chunks for reference-finding.
 *
 * Populated by CodeChunker from `code-chunk`'s `ChunkContext`; absent for
 * SemanticChunker chunks. The lightweight shape drops fields that are only
 * relevant for embedding enrichment (siblings, parseError, filepath, language)
 * and keeps the subset needed by `find_definition` and `find_references`.
 */
export interface CodeMeta {
  /** Import statements in this chunk. */
  imports?: Array<{
    /** Imported name (identifier or default alias). */
    name: string
    /** Source module / path. */
    source: string
    /** Whether it's a default import. */
    isDefault?: boolean
    /** Whether it's a namespace import (`import * as`). */
    isNamespace?: boolean
  }>
  /** Entities (functions, classes, etc.) defined in this chunk. */
  entities?: Array<{
    /** Entity name. */
    name: string
    /** Entity type: function, method, class, interface, type, enum. */
    type: string
    /** Line range in the source file (0-indexed, inclusive). */
    lineRange?: { start: number; end: number }
  }>
  /** Scope chain from current scope to root. */
  scope?: Array<{
    /** Scope entity name. */
    name: string
    /** Entity type. */
    type: string
  }>
}

/**
 * Text chunk produced by any chunker implementation.
 */
export interface TextChunk {
  /** Chunk text (stored in vector DB). */
  text: string
  /** Chunk index (zero-based). */
  index: number
  /**
   * Optional text variant optimised for embedding.
   * When set, `buildChunksAndEmbeddings` uses this value for
   * `embedBatch` instead of `text`. The `text` field is still
   * what gets stored in the vector DB for retrieval.
   *
   * SemanticChunker does not set this (the plain sentence-based
   * chunk text is already optimised for embedding). CodeChunker
   * sets it to `contextualizedText` from `code-chunk` so that
   * scope-chain and import context inform the embedding.
   */
  textForEmbedding?: string
  /**
   * Optional AST-level code metadata (only set by CodeChunker).
   * Used by `find_definition` and `find_references` MCP tools.
   */
  codeMeta?: CodeMeta
}

/**
 * Common interface for all chunker implementations.
 *
 * SemanticChunker needs the embedder to compute sentence-level
 * similarity during chunking. CodeChunker ignores the embedder
 * parameter — chunk boundaries are AST-driven.
 */
export interface ChunkerInterface {
  chunkText(text: string, embedder?: EmbedderInterface): Promise<TextChunk[]>
}

export type { CodeChunkerOptions } from './code-chunker.js'
export { CodeChunker, isCodeChunkExtension } from './code-chunker.js'
export { DEFAULT_MIN_CHUNK_LENGTH, SemanticChunker } from './semantic-chunker.js'
