import type { EmbedderInterface } from './semantic-chunker.js'

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
