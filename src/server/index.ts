// RAGServer implementation with MCP tools

import { watch } from 'node:fs'
import { readFile, stat, unlink } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js'
import { CodeChunker, isCodeChunkExtension } from '../chunker/code-chunker.js'
import type { ChunkerInterface } from '../chunker/index.js'
import { DEFAULT_MIN_CHUNK_LENGTH, SemanticChunker } from '../chunker/index.js'
import { Embedder } from '../embedder/index.js'
import { buildChunksAndEmbeddings, buildVectorChunks } from '../ingest/compute.js'
import { prepareVisualPdfChunks } from '../ingest/visual.js'
import { InstanceRouter } from '../instances/router.js'
import type { InstanceConfig } from '../instances/types.js'
import { parseHtml } from '../parser/html-parser.js'
import { DocumentParser } from '../parser/index.js'
import { extractMarkdownTitle, extractTxtTitle } from '../parser/title-extractor.js'
import type { BaseDirsConfigError } from '../utils/base-dirs.js'
import { loadGitignore, noopFilter } from '../utils/gitignore.js'
import {
  type ContentFormat,
  generateMetaJsonPath,
  isPathInRawDataDir,
  loadMetaJson,
  looksLikeRawDataPath,
  saveMetaJson,
  saveRawData,
} from '../utils/raw-data-utils.js'
import type { VectorChunk } from '../vectordb/index.js'
import { DatabaseError } from '../vectordb/types.js'
import {
  appendConfigWarnings,
  logError,
  type RagContentBlock,
  type ToMcpErrorContext,
  toMcpError,
} from './error-utils.js'
import { handleDeleteFile } from './handlers/delete.js'
import { handleListFiles } from './handlers/list.js'
import { handleConfig, handleDedupCheck, handleExportIndex } from './handlers/manage.js'
import { handleReadChunkNeighbors } from './handlers/read-neighbors.js'
import { handleQueryDocuments } from './handlers/search.js'
import { handleHealthCheck, handleStatus } from './handlers/system.js'
import { normalizeBaseDirs, scanBaseDir } from './list-scanner.js'
import { LruCache } from './lru-cache.js'
import { toolDefinitions } from './tool-definitions.js'
import {
  parseIngestDataInput,
  parseListFilesInput,
  parseQueryDocumentsInput,
} from './tool-input.js'
import type {
  ConfigInput,
  DedupCheckInput,
  DefinitionMatch,
  DeleteFileInput,
  ExportIndexInput,
  FindDefinitionInput,
  FindDefinitionResult,
  FindReferencesInput,
  FindReferencesResult,
  IngestDataInput,
  IngestDirectoryInput,
  IngestDirectoryResult,
  IngestFileInput,
  IngestResult,
  ListFilesInput,
  QueryDocumentsInput,
  QueryResult,
  RAGServerConfig,
  ReadChunkNeighborsInput,
  ReadChunkNeighborsResultItem,
  ReferenceMatch,
  ReindexAllInput,
  ReindexAllResult,
} from './types.js'

/**
 * Per-tool client-message policy consumed by the central dispatcher mapper
 * (`toMcpError(error, context)`). The `prefix`, when present, is prepended to
 * the controlled client message ONLY for native / non-`AppError` failures; a
 * recognized `AppError` (e.g. `DatabaseError`, `EmbeddingError`) always keeps
 * its own raw message regardless of the prefix (see `toMcpError`). This table
 * is the single source of truth for the Contract-Delta per-handler policy:
 * - `ingest_file` / `ingest_data` / `delete_file` / `read_chunk_neighbors`
 *   prepend an operation prefix on native errors.
 * - `query_documents` / `list_files` / `status` are prefix-less.
 */
const TOOL_ERROR_CONTEXT: Record<string, ToMcpErrorContext> = {
  ingest_file: { prefix: 'Failed to ingest file' },
  ingest_data: { prefix: 'Failed to ingest data' },
  ingest_directory: { prefix: 'Failed to ingest directory' },
  delete_file: { prefix: 'Failed to delete file' },
  read_chunk_neighbors: { prefix: 'Failed to read chunk neighbors' },
  reindex_stale: { prefix: 'Failed to reindex stale files' },
  reindex_all: { prefix: 'Failed to reindex all files' },
  config: { prefix: 'Failed to update config' },
  export_index: { prefix: 'Failed to export index' },
  dedup_check: { prefix: 'Failed to check duplicates' },
  find_definition: { prefix: 'Failed to find definition' },
  find_references: { prefix: 'Failed to find references' },
  query_documents: {},
  list_files: {},
  status: {},
  health_check: { prefix: 'Health check failed' },
}

/** RAG server compliant with MCP Protocol */
export class RAGServer {
  private readonly server: Server
  private readonly instanceRouter: InstanceRouter
  private embedder: Embedder
  private readonly chunker: ChunkerInterface
  private readonly parser: DocumentParser
  private readonly dbPath: string
  /**
   * One or more allowed document base directories — REALPATH-normalized
   * (the validation/security domain). Passed to `DocumentParser` as the
   * security boundary. NOT used for `list_files` scanning/display; that uses
   * the NORMAL-path `rawBaseDirs` below. Normalized from either the legacy
   * `{ baseDir }` config shape or the new `{ baseDirs }` shape so downstream
   * readers do not need to branch on shape.
   */
  private readonly baseDirs: readonly string[]
  /**
   * Normal-path (resolve()) roots, index-aligned with `baseDirs`, for
   * user-facing `list_files` scan/display. Falls back to `baseDirs` for legacy
   * `{ baseDir }` callers. See {@link BaseDirsConfig} for the path policy.
   */
  private readonly rawBaseDirs: readonly string[]
  /** Legacy single-root accessor for `rawBaseDirs`. Derived from `rawBaseDirs[0]`. */
  private readonly rawBaseDir: string
  private readonly cacheDir: string
  // Used by handleListFiles filter to exclude system-managed directories
  private readonly excludePaths: string[]
  private readonly configWarnings: string[]
  /**
   * Structured base-dirs resolution error. When non-null, the server is in
   * degraded mode: `status` remains callable so the user can diagnose the
   * problem via MCP, while root-dependent tools should surface this error
   * before doing DB or filesystem work. See `resolveBaseDirs` for the error
   * semantics.
   */
  private readonly configError: BaseDirsConfigError | null
  private readonly minChunkLength: number
  private readonly device: string | undefined
  /** Embedding model name / path */
  private modelName: string
  /** Embedding quantization dtype */
  private readonly dtype: string | undefined
  /** LRU cache for query results, invalidated on any mutation */
  private readonly queryCache = new LruCache<QueryResult[]>({ maxSize: 128, ttlMs: 5 * 60 * 1000 })

  constructor(config: RAGServerConfig) {
    this.dbPath = config.dbPath
    // Normalize both config shapes into a single `baseDirs: string[]` plus the
    // legacy single-root accessor. See `normalizeBaseDirs` for the degraded-
    // mode and misuse semantics.
    const { baseDirs, baseDir } = normalizeBaseDirs(config)
    this.baseDirs = baseDirs
    // Normal-path roots for user-facing scanning; fall back to the realpath'd
    // roots for legacy `{ baseDir }` callers.
    const rawBaseDirs = config.rawBaseDirs !== undefined ? [...config.rawBaseDirs] : [...baseDirs]
    this.rawBaseDirs = rawBaseDirs
    this.rawBaseDir = rawBaseDirs[0] ?? baseDir
    this.cacheDir = config.cacheDir
    this.configWarnings = config.configWarnings ?? []
    this.configError = config.configError ?? null
    this.minChunkLength = config.chunkMinLength ?? DEFAULT_MIN_CHUNK_LENGTH
    this.device = config.device
    this.modelName = config.modelName
    this.dtype = config.dtype
    this.excludePaths = [`${resolve(this.dbPath)}${sep}`, `${resolve(this.cacheDir)}${sep}`]
    this.server = new Server(
      { name: 'rag-mcp-server', version: '1.0.0' },
      { capabilities: { tools: {} } }
    )

    // Component initialization
    const instances: InstanceConfig[] =
      config.instances && config.instances.length > 0
        ? config.instances
        : [
            {
              name: 'default',
              baseDir: this.baseDirs[0] ?? '',
              dbPath: config.dbPath,
              rawBaseDir: this.rawBaseDir,
            },
          ]
    this.instanceRouter = new InstanceRouter(instances)

    // Apply quality filter settings to all instances
    const runtimeConfig: Parameters<typeof this.instanceRouter.updateConfig>[0] = {}
    if (config.maxDistance !== undefined) runtimeConfig.maxDistance = config.maxDistance
    if (config.grouping !== undefined) runtimeConfig.grouping = config.grouping
    if (config.hybridWeight !== undefined) runtimeConfig.hybridWeight = config.hybridWeight
    if (config.maxFiles !== undefined) runtimeConfig.maxFiles = config.maxFiles
    if (Object.keys(runtimeConfig).length > 0) {
      this.instanceRouter.updateConfig(runtimeConfig)
    }
    const embedderConfig: ConstructorParameters<typeof Embedder>[0] = {
      modelPath: config.modelName,
      batchSize: 16,
      cacheDir: config.cacheDir,
    }
    if (config.device !== undefined) {
      embedderConfig.device = config.device
    }
    if (config.dtype !== undefined) {
      embedderConfig.dtype = config.dtype
    }
    if (config.remoteHost !== undefined) {
      embedderConfig.remoteHost = config.remoteHost
    }
    if (config.proxy !== undefined) {
      embedderConfig.proxy = config.proxy
    }
    if (config.autoMirror !== undefined) {
      embedderConfig.autoMirror = config.autoMirror
    }
    this.embedder = new Embedder(embedderConfig)
    this.chunker = new SemanticChunker(
      config.chunkMinLength !== undefined ? { minChunkLength: config.chunkMinLength } : {}
    )
    // Always construct the parser with the multi-root shape — the parser
    // accepts a single-element `baseDirs` array as the byte-equivalent of
    // the legacy `baseDir` shape, so passing `this.baseDirs` covers both
    // config inputs without branching here.
    this.parser = new DocumentParser({
      baseDirs: this.baseDirs,
      maxFileSize: config.maxFileSize,
    })

    this.setupHandlers()
  }

  /**
   * Fail-fast guard for root-dependent tools. When a {@link BaseDirsConfigError}
   * is stored on the instance the server is in degraded mode (invalid
   * `BASE_DIRS` — see `resolveBaseDirs`) and every root-dependent tool MUST
   * reject BEFORE any DB / embedder / parser access so the user sees the
   * configuration problem unambiguously. Throws the stored
   * {@link BaseDirsConfigError} (kind `config`) so the central dispatcher
   * mapper renders it as `McpError(InvalidParams)` — error→code ownership
   * stays in exactly one place instead of being hand-built here.
   *
   * `status` deliberately does NOT call this helper; it remains callable in
   * degraded mode and exposes the error via a diagnostic content block so
   * the user can recover via MCP without inspecting stderr.
   */
  private assertConfigOk(): void {
    if (this.configError !== null) {
      throw this.configError
    }
  }

  /**
   * Return the appropriate chunker for `filePath`.
   *
   * Code files (extensions supported by tree-sitter) get a CodeChunker
   * that splits at AST-level semantic boundaries and enriches each
   * chunk with scope-chain context for embedding. All other files
   * use the shared SemanticChunker (Max-Min sentence-level chunking).
   *
   * CodeChunker is constructed per-call (cheap — no model load); the
   * SemanticChunker is the singleton instance stored on the server.
   */
  private resolveChunker(filePath: string): ChunkerInterface {
    if (isCodeChunkExtension(filePath)) {
      return new CodeChunker(filePath, {
        maxChunkSize: 1500,
        contextMode: 'full',
        siblingDetail: 'signatures',
      })
    }
    return this.chunker
  }

  /**
   * Append the centralized config-warning blocks to a handler response.
   * Every tool handler funnels through this method so the warning shape
   * stays in exactly one place (design-doc-mandated countermeasure for the
   * "warning shape changes touch many handlers" risk).
   */
  private withWarnings(content: RagContentBlock[]): RagContentBlock[] {
    return appendConfigWarnings(content, this.configWarnings)
  }

  /**
   * Send a `notifications/progress` update to the client when a
   * progressToken was provided. No-op when no token is set.
   */
  private sendProgress(
    progressToken: string | undefined,
    progress: number,
    total: number,
    message?: string
  ): void {
    if (!progressToken) return
    this.server
      .notification({
        method: 'notifications/progress',
        params: { progressToken, progress, total, ...(message ? { message } : {}) },
      })
      .catch(() => {
        // Best-effort; never let a progress send failure break the main flow.
      })
  }

  /**
   * Set up MCP handlers
   */
  private setupHandlers(): void {
    // Tool list
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: toolDefinitions,
    }))

    // Tool invocation. The handlers are gutted of error mapping — every error
    // they throw (with its ORIGINAL identity) is routed through the single
    // central catch below, which logs the full cause chain to stderr and maps
    // the error to an `McpError` for the client via `toMcpError(error,
    // context)`. The per-tool `context` (see `TOOL_ERROR_CONTEXT`) encodes each
    // handler's client-message prefix policy so the Contract-Delta per-handler
    // table is preserved in exactly one place.
    this.server.setRequestHandler(CallToolRequestSchema, async (request, _extra) => {
      const toolName = request.params.name
      const meta = request.params._meta
      const progressToken =
        meta && typeof meta === 'object'
          ? ((meta as Record<string, unknown>)['progressToken'] as string | undefined)
          : undefined
      try {
        switch (toolName) {
          case 'query_documents':
            return await this.handleQueryDocuments(
              parseQueryDocumentsInput(request.params.arguments)
            )
          case 'ingest_file': {
            const result = await this.handleIngestFile(
              request.params.arguments as unknown as IngestFileInput
            )
            this.queryCache.clear()
            return result
          }
          case 'ingest_data': {
            const result = await this.handleIngestData(
              parseIngestDataInput(request.params.arguments)
            )
            this.queryCache.clear()
            return result
          }
          case 'delete_file': {
            const result = await handleDeleteFile(
              {
                instanceRouter: this.instanceRouter,
                parser: this.parser,
                dbPath: this.dbPath,
                withWarnings: this.withWarnings.bind(this),
                assertConfigOk: this.assertConfigOk.bind(this),
              },
              request.params.arguments as unknown as DeleteFileInput
            )
            this.queryCache.clear()
            return result
          }
          case 'read_chunk_neighbors':
            return await handleReadChunkNeighbors(
              {
                instanceRouter: this.instanceRouter,
                parser: this.parser,
                dbPath: this.dbPath,
                assertConfigOk: this.assertConfigOk.bind(this),
                withWarnings: this.withWarnings.bind(this),
              },
              request.params.arguments as unknown as ReadChunkNeighborsInput
            )
          case 'list_files':
            return await handleListFiles(
              {
                instanceRouter: this.instanceRouter,
                rawBaseDirs: this.rawBaseDirs,
                rawBaseDir: this.rawBaseDir,
                excludePaths: this.excludePaths,
                assertConfigOk: this.assertConfigOk.bind(this),
                withWarnings: this.withWarnings.bind(this),
              },
              parseListFilesInput(request.params.arguments)
            )
          case 'status':
            return await handleStatus(
              {
                instanceRouter: this.instanceRouter,
                embedder: this.embedder,
                dbPath: this.dbPath,
                cacheDir: this.cacheDir,
                device: this.device,
                modelName: this.modelName,
                dtype: this.dtype,
                configError: this.configError,
                rawBaseDirs: this.rawBaseDirs,
                withWarnings: this.withWarnings.bind(this),
              },
              request.params.arguments as unknown as { instance?: string }
            )
          case 'ingest_directory': {
            const result = await this.handleIngestDirectory(
              request.params.arguments as unknown as IngestDirectoryInput,
              progressToken
            )
            this.queryCache.clear()
            return result
          }
          case 'reindex_stale': {
            const result = await this.handleReindexStale(progressToken)
            this.queryCache.clear()
            return result
          }
          case 'reindex_all': {
            const result = await this.handleReindexAll(
              request.params.arguments as unknown as { optimizeAfter?: boolean },
              progressToken
            )
            this.queryCache.clear()
            return result
          }
          case 'config': {
            const result = await handleConfig(
              {
                instanceRouter: this.instanceRouter,
                dbPath: this.dbPath,
                withWarnings: this.withWarnings.bind(this),
                embedder: this.embedder,
                setEmbedder: (emb: Embedder) => {
                  this.embedder = emb
                },
                modelName: this.modelName,
                setModelName: (name: string) => {
                  this.modelName = name
                },
                cacheDir: this.cacheDir,
                device: this.device,
                dtype: this.dtype,
              },
              request.params.arguments as unknown as ConfigInput
            )
            this.queryCache.clear()
            return result
          }
          case 'export_index':
            return await handleExportIndex(
              {
                instanceRouter: this.instanceRouter,
                dbPath: this.dbPath,
                withWarnings: this.withWarnings.bind(this),
              },
              request.params.arguments as unknown as ExportIndexInput
            )
          case 'dedup_check':
            return await handleDedupCheck(
              {
                instanceRouter: this.instanceRouter,
                dbPath: this.dbPath,
                withWarnings: this.withWarnings.bind(this),
              },
              request.params.arguments as unknown as DedupCheckInput
            )
          case 'find_definition':
            return await this.handleFindDefinition(
              request.params.arguments as unknown as FindDefinitionInput
            )
          case 'find_references':
            return await this.handleFindReferences(
              request.params.arguments as unknown as FindReferencesInput
            )
          case 'health_check':
            return await handleHealthCheck({
              instanceRouter: this.instanceRouter,
              embedder: this.embedder,
              dbPath: this.dbPath,
              cacheDir: this.cacheDir,
              device: this.device,
              modelName: this.modelName,
              dtype: this.dtype,
              configError: this.configError,
              rawBaseDirs: this.rawBaseDirs,
              withWarnings: this.withWarnings.bind(this),
            })
          default:
            throw new Error(`Unknown tool: ${toolName}`)
        }
      } catch (error) {
        const context = TOOL_ERROR_CONTEXT[toolName] ?? {}
        logError(toolName, error)
        throw toMcpError(error, context)
      }
    })
  }

  /**
   * Initialization
   */
  async initialize(): Promise<void> {
    await this.instanceRouter.initialize()
    console.error('RAGServer initialized')
  }

  /**
   * query_documents tool handler
   */
  async handleQueryDocuments(args: QueryDocumentsInput): Promise<{ content: RagContentBlock[] }> {
    return handleQueryDocuments(
      {
        embedder: this.embedder,
        instanceRouter: this.instanceRouter,
        withWarnings: this.withWarnings.bind(this),
        queryCache: this.queryCache,
      },
      args
    )
  }

  /**
   * ingest_file tool handler (re-ingestion support, transaction processing, rollback capability)
   */
  async handleIngestFile(args: IngestFileInput): Promise<{ content: RagContentBlock[] }> {
    // Skip the configError gate only for paths structurally inside
    // `<dbPath>/raw-data/` (internal invocation from handleIngestData).
    if (!(await isPathInRawDataDir(args.filePath, this.dbPath))) {
      this.assertConfigOk()
    }
    // `args.filePath` is the DB key (backup/delete/insert/result), stored
    // verbatim so lookups match (realpath stays in validateFilePath; see
    // BaseDirsConfig for the path policy).
    // Runtime validation: the MCP JSON Schema declares `visual` as a
    // boolean and `IngestFileInput.visual` types it as `boolean | undefined`,
    // but tool arguments arrive as `unknown` at the SDK boundary so the
    // structural type is not enforced by the compiler. Validation fires
    // BEFORE any parser/chunker/embedder/vectorStore access.
    const visualArg: unknown = args.visual
    if (visualArg !== undefined && typeof visualArg !== 'boolean') {
      throw new McpError(ErrorCode.InvalidParams, "'visual' must be a boolean if provided")
    }

    // Runtime validation + normalization of `visualQuality`. The MCP boundary
    // receives `unknown`, so the JSON Schema enum is necessary but not
    // sufficient. Some MCP clients send `""` for unspecified optional
    // parameters; accept both `undefined` and `""` and normalize to `'fast'`
    // so the internal `QualityProfile` type stays narrow.
    const visualQualityArg: unknown = (args as { visualQuality?: unknown }).visualQuality
    let visualQuality: 'fast' | 'quality' = 'fast'
    if (visualQualityArg !== undefined && visualQualityArg !== '') {
      if (visualQualityArg !== 'fast' && visualQualityArg !== 'quality') {
        throw new McpError(
          ErrorCode.InvalidParams,
          "'visualQuality' must be 'fast' or 'quality' if provided"
        )
      }
      visualQuality = visualQualityArg
    }

    let backup: VectorChunk[] | null = null

    // No outer error-mapping catch: failures propagate with original identity
    // to the central dispatcher mapper. The inner insert/rollback try/catch
    // below is retained — it is local-effect (data rollback) only.
    // Parse file (with header/footer filtering for PDFs)
    // For raw-data files (from ingest_data), read directly without validation
    // since the path is internally generated and content is already processed
    const isPdf = args.filePath.toLowerCase().endsWith('.pdf')
    let text: string
    let title: string | null = null
    let chunks: Awaited<ReturnType<typeof buildChunksAndEmbeddings>>['chunks']
    let embeddings: Awaited<ReturnType<typeof buildChunksAndEmbeddings>>['embeddings']
    if (await isPathInRawDataDir(args.filePath, this.dbPath)) {
      // Raw-data files: skip parser validation, read directly.
      text = await readFile(args.filePath, 'utf-8')
      const meta = await loadMetaJson(args.filePath)
      title = meta?.title ?? null
      console.error(`Read raw-data file: ${args.filePath} (${text.length} characters)`)
      ;({ chunks, embeddings } = await buildChunksAndEmbeddings(
        text,
        title,
        this.resolveChunker(args.filePath),
        this.embedder
      ))
    } else if (visualArg === true && isPdf) {
      // Visual dispatch delegates to `prepareVisualPdfChunks`, which owns
      // the dynamic `pdf-visual` import so the default path does not load
      // visual dependencies. This handler keeps its backup/rollback/
      // optimize/response-shaping persistence semantics.
      const visualResult = await prepareVisualPdfChunks(
        args.filePath,
        this.parser,
        this.resolveChunker(args.filePath),
        this.embedder,
        {
          profile: visualQuality,
          cacheDir: this.cacheDir,
          device: this.device,
        }
      )
      chunks = visualResult.chunks
      embeddings = visualResult.embeddings
      text = visualResult.text
      title = visualResult.title
    } else if (isPdf) {
      const result = await this.parser.parsePdf(args.filePath, this.embedder)
      text = result.content
      title = result.title || null
      ;({ chunks, embeddings } = await buildChunksAndEmbeddings(
        text,
        title,
        this.resolveChunker(args.filePath),
        this.embedder
      ))
    } else {
      const result = await this.parser.parseFile(args.filePath)
      text = result.content
      title = result.title || null
      ;({ chunks, embeddings } = await buildChunksAndEmbeddings(
        text,
        title,
        this.resolveChunker(args.filePath),
        this.embedder
      ))
    }

    // Fail-fast: Prevent data loss when chunking produces 0 chunks
    // This check must happen BEFORE delete to preserve existing data on re-ingest
    if (chunks.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `No chunks generated from file: ${args.filePath}. The file may be empty or all content was filtered (minimum ${this.minChunkLength} characters required). Existing data has been preserved.`
      )
    }

    // Back up existing chunks BEFORE the destructive delete, with their real
    // stored vectors and the full chunk set, so a failed re-ingest can be
    // rolled back without data loss or vector corruption (TD-7). Read this
    // before deleting; if the read fails it propagates here — leaving the
    // existing data untouched — rather than proceeding into the delete with
    // an empty/partial backup.
    backup = await this.instanceRouter.getChunksByFilePath(args.filePath)
    if (backup.length > 0) {
      console.error(`Backup created: ${backup.length} chunks for ${args.filePath}`)
    }

    // Delete existing data
    await this.instanceRouter.deleteChunks(args.filePath)
    console.error(`Deleted existing chunks for: ${args.filePath}`)

    // Create vector chunks
    const vectorChunks = buildVectorChunks({
      filePath: args.filePath,
      chunks,
      embeddings,
      fileSize: text.length,
      fileTitle: title || null,
    })

    // Insert vectors (transaction processing)
    try {
      await this.instanceRouter.insertChunks(vectorChunks)
      console.error(`Inserted ${vectorChunks.length} chunks for: ${args.filePath}`)

      // Optimize once after both delete + insert (not per-operation)
      await this.instanceRouter.optimize()

      // Delete backup on success
      backup = null
    } catch (insertError) {
      // Rollback on error
      if (backup && backup.length > 0) {
        console.error('Ingestion failed, rolling back...', insertError)
        try {
          await this.instanceRouter.insertChunks(backup)
          await this.instanceRouter.optimize()
          console.error(`Rollback completed: ${backup.length} chunks restored`)
        } catch (rollbackError) {
          // Rollback also failed: throw a distinct error (cause = insertError)
          // so the client learns the prior data may be lost, not just that the insert failed.
          console.error('Rollback failed:', rollbackError)
          throw new DatabaseError(
            `Ingest failed and rollback failed for ${args.filePath}; existing data may not have been restored. Original insert error: ${(insertError as Error).message}`,
            insertError as Error
          )
        }
      }
      throw insertError
    }

    // Result
    const result: IngestResult = {
      filePath: args.filePath,
      chunkCount: chunks.length,
      timestamp: new Date().toISOString(),
      fileTitle: title || null,
    }

    return {
      content: this.withWarnings([
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ]),
    }
  }

  /**
   * ingest_data tool handler
   * Saves raw content to raw-data directory and calls handleIngestFile internally
   *
   * For HTML content:
   * - Parses HTML and extracts main content using Readability
   * - Converts to Markdown for better chunking
   * - Saves as .md file
   */
  async handleIngestData(args: IngestDataInput): Promise<{ content: RagContentBlock[] }> {
    // ingest_data writes only to `dbPath`/raw-data — it never reads from a
    // configured `baseDir`. Keeping it callable in degraded mode means a user
    // with invalid BASE_DIRS can still capture raw-data via MCP while they
    // diagnose the config error from `status`. The internal `handleIngestFile`
    // call below operates on a generated raw-data path, which routes
    // around `parser.validateFilePath`, so no baseDirs access happens.
    //
    // No outer error-mapping catch: failures propagate with original identity
    // to the central dispatcher mapper. The inner raw-data rollback try/catch
    // below is retained — it is local-effect (file cleanup) only.
    let contentToSave = args.content
    let formatToSave: ContentFormat = args.metadata.format
    let title: string | null = null

    // Per-format title extraction and content preparation
    if (args.metadata.format === 'html') {
      console.error(`Parsing HTML from: ${args.metadata.source}`)
      const { content: markdown, title: htmlTitle } = await parseHtml(
        args.content,
        args.metadata.source
      )

      if (!markdown.trim()) {
        throw new Error(
          'Failed to extract content from HTML. The page may have no readable content.'
        )
      }

      title = htmlTitle || null
      contentToSave = markdown
      formatToSave = 'markdown' // Save as .md file
      console.error(`Converted HTML to Markdown: ${markdown.length} characters`)
    } else if (args.metadata.format === 'markdown') {
      const result = extractMarkdownTitle(args.content, args.metadata.source)
      title = result.source !== 'filename' ? result.title : null
    } else {
      // text format
      const result = extractTxtTitle(args.content, args.metadata.source)
      title = result.source !== 'filename' ? result.title : null
    }

    // Save content to raw-data directory
    const rawDataPath = await saveRawData(
      this.dbPath,
      args.metadata.source,
      contentToSave,
      formatToSave
    )

    // Save metadata sidecar (.meta.json) alongside the raw-data file
    await saveMetaJson(rawDataPath, {
      title,
      source: args.metadata.source,
      format: args.metadata.format,
    })

    console.error(`Saved raw data: ${args.metadata.source} -> ${rawDataPath}`)

    // Call existing ingest_file internally with rollback on failure
    try {
      return await this.handleIngestFile({ filePath: rawDataPath })
    } catch (ingestError) {
      // Rollback: delete the raw-data file and .meta.json if ingest fails
      try {
        await unlink(rawDataPath)
        await unlink(generateMetaJsonPath(rawDataPath))
        console.error(`Rolled back raw-data file: ${rawDataPath}`)
      } catch {
        console.warn(`Failed to rollback raw-data file: ${rawDataPath}`)
      }
      throw ingestError
    }
  }

  /**
   * list_files tool handler
   *
   * Scans the normal-path roots (`this.rawBaseDirs`) so scanned paths match the
   * resolve()-stored DB keys (see {@link BaseDirsConfig} for the path policy).
   *
   * Scans every effective base directory (`this.rawBaseDirs`) for supported
   * files and cross-references with ingested documents. Multi-root contract:
   * - Returns top-level `baseDirs` (all effective roots in normal-path space,
   *   nested-root-pruned by `resolveBaseDirs`).
   * - Preserves legacy top-level `baseDir = rawBaseDirs[0]` for clients written
   *   against the single-root shape.
   * - Annotates each file entry with the producing `baseDir`.
   * - De-duplicates exact duplicate file paths across roots (first occurrence
   *   wins, preserving root iteration order).
   * - Preserves raw-data / orphaned DB entries under `sources` with no
   *   producing-root annotation.
   * - Excludes `dbPath` and `cacheDir` uniformly across every root.
   */
  async handleListFiles(input: ListFilesInput = {}): Promise<{ content: RagContentBlock[] }> {
    return handleListFiles(
      {
        instanceRouter: this.instanceRouter,
        rawBaseDirs: this.rawBaseDirs,
        rawBaseDir: this.rawBaseDir,
        excludePaths: this.excludePaths,
        assertConfigOk: this.assertConfigOk.bind(this),
        withWarnings: this.withWarnings.bind(this),
      },
      input
    )
  }

  /**
   * status tool handler
   */
  async handleStatus(args: { instance?: string } = {}): Promise<{ content: RagContentBlock[] }> {
    return handleStatus(
      {
        instanceRouter: this.instanceRouter,
        embedder: this.embedder,
        dbPath: this.dbPath,
        cacheDir: this.cacheDir,
        device: this.device,
        modelName: this.modelName,
        dtype: this.dtype,
        configError: this.configError,
        rawBaseDirs: this.rawBaseDirs,
        withWarnings: this.withWarnings.bind(this),
      },
      args
    )
  }

  /**
   * health_check tool handler
   *
   * Proactively diagnoses common failure points: embedder, LanceDB, BASE_DIRs,
   * and model cache. Returns structured pass/fail with a human-readable summary
   * and per-check fix suggestions. Unlike `status`, this actively probes the
   * system rather than just dumping stored metadata.
   */
  async handleHealthCheck(): Promise<{ content: RagContentBlock[] }> {
    return handleHealthCheck({
      instanceRouter: this.instanceRouter,
      embedder: this.embedder,
      dbPath: this.dbPath,
      cacheDir: this.cacheDir,
      device: this.device,
      modelName: this.modelName,
      dtype: this.dtype,
      configError: this.configError,
      rawBaseDirs: this.rawBaseDirs,
      withWarnings: this.withWarnings.bind(this),
    })
  }

  /**
   * ingest_directory tool handler
   *
   * Batch ingests all supported files inside a directory by delegating to
   * `ingestFileCore`. Reuses the parse→chunk→embed→insert pipeline from
   * `handleIngestFile` but without per-file backup/optimize, and with a
   * single `optimize()` call after all files are processed.
   */
  async handleIngestDirectory(
    args: IngestDirectoryInput,
    progressToken?: string
  ): Promise<{ content: RagContentBlock[] }> {
    this.assertConfigOk()
    // Validate the directory is within bounds (reuse parser's validation
    // to avoid duplicating the baseDirs check). Use the resolved path for
    // subsequent scanning to close the TOCTOU window.
    const resolvedPath = await this.parser.validateFilePath(args.path)

    // Use scanBaseDir to walk the directory (same BFS logic as list_files)
    const extFilter =
      args.extensionFilter && args.extensionFilter.length > 0
        ? new Set(args.extensionFilter.map((e) => e.toLowerCase().replace(/^\./, '')))
        : null

    const gitignoreFilter = await loadGitignore(resolvedPath, resolvedPath).catch(() =>
      noopFilter()
    )
    const { files: scannedFiles, warnings: scanWarnings } = await scanBaseDir(
      resolvedPath,
      this.excludePaths,
      undefined,
      gitignoreFilter
    )
    const result: IngestDirectoryResult = {
      directory: resolvedPath,
      totalFiles: scannedFiles.length,
      succeeded: 0,
      skipped: 0,
      failed: 0,
      totalChunks: 0,
      files: [],
      timestamp: new Date().toISOString(),
    }

    const content: RagContentBlock[] = []

    if (scannedFiles.length === 0) {
      result.files = []
      content.push({ type: 'text', text: JSON.stringify(result, null, 2) })
      for (const w of scanWarnings) {
        content.push({ type: 'text', text: `Warning: ${w}` })
      }
      // Signal 100% even for no files
      this.sendProgress(progressToken, 1, 1, 'No files to process')
      return { content: this.withWarnings(content) }
    }

    console.error(`ingest_directory: ${scannedFiles.length} files in ${args.path}`)

    let processed = 0
    const totalFiles = scannedFiles.length
    this.sendProgress(progressToken, 0, totalFiles, `Starting batch ingest of ${totalFiles} files`)

    for (const filePath of scannedFiles) {
      // Extension filter (path-based for zero-stat speed)
      if (extFilter) {
        const ext = filePath.toLowerCase().substring(filePath.lastIndexOf('.') + 1)
        if (!extFilter.has(ext)) {
          processed++
          continue
        }
      }

      try {
        const fileResult = await this.ingestFileCore(filePath)
        result.files.push(fileResult)
        if (fileResult.status === 'ok') {
          result.succeeded++
          result.totalChunks += fileResult.chunkCount
        } else if (fileResult.status === 'skipped') {
          result.skipped++
        } else {
          result.failed++
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        result.files.push({
          filePath,
          status: 'error' as const,
          chunkCount: 0,
          error: msg,
        })
        result.failed++
        console.error(`ingest_directory: error processing ${filePath}: ${msg}`)
      }

      processed++
      // Send progress every file (updates are cheap OOB notifications)
      this.sendProgress(progressToken, processed, totalFiles, filePath)
    }

    // Single optimize after all inserts
    this.sendProgress(progressToken, totalFiles, totalFiles, 'Optimizing index...')
    await this.instanceRouter.optimize()

    content.push({ type: 'text', text: JSON.stringify(result, null, 2) })
    for (const w of scanWarnings) {
      content.push({ type: 'text', text: `Warning: ${w}` })
    }
    return { content: this.withWarnings(content) }
  }

  /**
   * Core file ingestion without backup/optimize (used by ingest_directory
   * for batch processing). Parse → chunk → embed → delete → insert.
   * Returns a per-file summary; does NOT optimize the FTS index.
   */
  private async ingestFileCore(filePath: string): Promise<{
    filePath: string
    status: 'ok' | 'skipped' | 'error'
    chunkCount: number
    error?: string
  }> {
    // Parse (reuse handleIngestFile pipeline sans backup/optimize)
    let text: string
    let title: string | null = null

    if (filePath.toLowerCase().endsWith('.pdf')) {
      const result = await this.parser.parsePdf(filePath, this.embedder)
      text = result.content
      title = result.title || null
    } else {
      const result = await this.parser.parseFile(filePath)
      text = result.content
      title = result.title || null
    }

    const { chunks, embeddings } = await buildChunksAndEmbeddings(
      text,
      title,
      this.resolveChunker(filePath),
      this.embedder
    )

    if (chunks.length === 0) {
      return { filePath, status: 'skipped', chunkCount: 0 }
    }

    // Delete existing (idempotent, no backup in batch mode)
    await this.instanceRouter.deleteChunks(filePath)

    // Insert
    const vectorChunks = buildVectorChunks({
      filePath,
      chunks,
      embeddings,
      fileSize: text.length,
      fileTitle: title || null,
    })
    await this.instanceRouter.insertChunks(vectorChunks)

    return { filePath, status: 'ok', chunkCount: chunks.length }
  }

  /**
   * reindex_stale tool handler
   *
   * Finds all ingested files whose mtime on disk is newer than their last
   * ingestion timestamp, and re-ingests them. Uses the same per-file pipeline
   * as ingest_directory (no per-file optimize, single optimize at end).
   */
  async handleReindexStale(progressToken?: string): Promise<{ content: RagContentBlock[] }> {
    this.assertConfigOk()

    // Collect all ingested files with their timestamps
    const ingested = await this.instanceRouter.listFiles()
    const staleFiles: string[] = []

    for (const entry of ingested) {
      try {
        const s = await stat(entry.filePath)
        const mtimeMs = s.mtimeMs
        const indexedAt = new Date(entry.timestamp).getTime()
        // Stale = disk mtime is strictly newer than the ingestion timestamp
        if (mtimeMs > indexedAt) {
          staleFiles.push(entry.filePath)
        }
      } catch {}
    }

    let succeeded = 0
    let skipped = 0
    let failed = 0
    let totalChunks = 0

    if (staleFiles.length === 0) {
      this.sendProgress(progressToken, 1, 1, 'No stale files found')
    } else {
      const total = staleFiles.length
      this.sendProgress(progressToken, 0, total, `Reindexing ${total} stale files`)
      let processed = 0

      for (const filePath of staleFiles) {
        try {
          const fileResult = await this.ingestFileCore(filePath)
          if (fileResult.status === 'ok') {
            succeeded++
            totalChunks += fileResult.chunkCount
          } else if (fileResult.status === 'skipped') {
            skipped++
          } else {
            failed++
          }
        } catch (error) {
          console.error(`reindex_stale: error processing ${filePath}:`, error)
          failed++
        }
        processed++
        this.sendProgress(progressToken, processed, total, filePath)
      }
    }

    // Single optimize after all inserts
    this.sendProgress(progressToken, staleFiles.length, staleFiles.length, 'Optimizing index...')
    await this.instanceRouter.optimize()

    const result = {
      staleCount: staleFiles.length,
      reindexed: succeeded,
      skipped,
      failed,
      totalChunks,
      timestamp: new Date().toISOString(),
    }

    return {
      content: this.withWarnings([
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ]),
    }
  }

  /**
   * delete_file tool handler
   * Deletes chunks from VectorDB and physical raw-data files
   * Supports both filePath (for ingest_file) and source (for ingest_data)
   */
  async handleDeleteFile(args: DeleteFileInput): Promise<{ content: RagContentBlock[] }> {
    return handleDeleteFile(
      {
        instanceRouter: this.instanceRouter,
        parser: this.parser,
        dbPath: this.dbPath,
        withWarnings: this.withWarnings.bind(this),
        assertConfigOk: this.assertConfigOk.bind(this),
      },
      args
    )
  }

  /**
   * read_chunk_neighbors tool handler
   * Returns chunks around a target chunkIndex within a single ingested document.
   * Context-expansion utility — not a search tool. Mirrors handleDeleteFile's
   * dual-input (filePath XOR source) resolution pattern.
   */
  async handleReadChunkNeighbors(
    args: ReadChunkNeighborsInput
  ): Promise<{ content: RagContentBlock[] }> {
    return handleReadChunkNeighbors(
      {
        instanceRouter: this.instanceRouter,
        parser: this.parser,
        dbPath: this.dbPath,
        assertConfigOk: this.assertConfigOk.bind(this),
        withWarnings: this.withWarnings.bind(this),
      },
      args
    )
  }

  /**
   * reindex_all tool handler
   * Re-ingests every file currently in the index from scratch.
   * Skips raw-data (ingest_data) entries since they have no disk file.
   */
  async handleReindexAll(
    args: ReindexAllInput = {},
    progressToken?: string
  ): Promise<{ content: RagContentBlock[] }> {
    this.assertConfigOk()
    const optimizeAfter = args.optimizeAfter ?? true

    const files = await this.instanceRouter.listFiles()
    let succeeded = 0
    let failed = 0
    let totalChunks = 0

    const total = files.length
    let processed = 0
    this.sendProgress(progressToken, 0, total, `Reindexing all ${total} files`)

    for (const { filePath } of files) {
      // Skip raw-data entries — they have no disk file to re-ingest
      if (looksLikeRawDataPath(filePath)) {
        processed++
        continue
      }

      try {
        const fileResult = await this.ingestFileCore(filePath)
        if (fileResult.status === 'ok') {
          succeeded++
          totalChunks += fileResult.chunkCount
        } else {
          failed++
        }
      } catch (error) {
        console.error(`reindex_all: error processing ${filePath}:`, error)
        failed++
      }
      processed++
      this.sendProgress(progressToken, processed, total, filePath)
    }

    if (optimizeAfter) {
      this.sendProgress(progressToken, total, total, 'Optimizing index...')
      await this.instanceRouter.optimize()
    }

    const result: ReindexAllResult = {
      reindexed: files.length,
      succeeded,
      failed,
      totalChunks,
      timestamp: new Date().toISOString(),
    }

    return {
      content: this.withWarnings([{ type: 'text', text: JSON.stringify(result, null, 2) }]),
    }
  }

  /**
   * config tool handler
   * Read or update runtime configuration.
   */
  async handleConfig(args: ConfigInput = {}): Promise<{ content: RagContentBlock[] }> {
    return handleConfig(
      {
        instanceRouter: this.instanceRouter,
        dbPath: this.dbPath,
        withWarnings: this.withWarnings.bind(this),
        embedder: this.embedder,
        setEmbedder: (emb: Embedder) => {
          this.embedder = emb
        },
        modelName: this.modelName,
        setModelName: (name: string) => {
          this.modelName = name
        },
        cacheDir: this.cacheDir,
        device: this.device,
        dtype: this.dtype,
      },
      args
    )
  }

  /**
   * export_index tool handler
   * Export all indexed chunks to a JSON file for backup/migration.
   */
  async handleExportIndex(args: ExportIndexInput = {}): Promise<{ content: RagContentBlock[] }> {
    return handleExportIndex(
      {
        instanceRouter: this.instanceRouter,
        dbPath: this.dbPath,
        withWarnings: this.withWarnings.bind(this),
      },
      args
    )
  }

  /**
   * dedup_check tool handler
   * Detect near-duplicate documents by comparing chunk-content hashes.
   */
  async handleDedupCheck(args: DedupCheckInput = {}): Promise<{ content: RagContentBlock[] }> {
    return handleDedupCheck(
      {
        instanceRouter: this.instanceRouter,
        dbPath: this.dbPath,
        withWarnings: this.withWarnings.bind(this),
      },
      args
    )
  }

  /**
   * find_definition tool handler.
   *
   * Searches AST-level entity metadata (extracted by CodeChunker during
   * ingestion) for the definition of a symbol. Matches against `entities`
   * (exact name match on defined entities) and falls back to `scope` when
   * no entity match is found (the symbol might be a parameter or local
   * variable captured only in the scope chain).
   */
  async handleFindDefinition(args: FindDefinitionInput): Promise<{ content: RagContentBlock[] }> {
    if (typeof args.symbolName !== 'string' || args.symbolName.trim().length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'symbolName must be a non-empty string')
    }
    const { symbolName } = args

    const rows = await this.instanceRouter.getCodeChunksWithMeta()
    const matches: DefinitionMatch[] = []

    for (const row of rows) {
      const { entities, scope } = row.codeMeta
      // Check entities first (direct definitions)
      if (entities) {
        for (const entity of entities) {
          if (entity.name === symbolName) {
            matches.push({
              filePath: row.filePath,
              chunkIndex: row.chunkIndex,
              entityName: entity.name,
              entityType: entity.type,
              ...(entity.lineRange ? { lineRange: entity.lineRange } : {}),
              ...(scope && scope.length > 0 ? { scope } : {}),
            })
          }
        }
      }
      // Fallback: check scope chain (for parameters, locals, etc.)
      if (scope && entities === undefined) {
        for (const s of scope) {
          if (s.name === symbolName) {
            // Only add scope fallback if not already matched via entities
            const alreadyMatched = matches.some(
              (m) => m.filePath === row.filePath && m.chunkIndex === row.chunkIndex
            )
            if (!alreadyMatched) {
              matches.push({
                filePath: row.filePath,
                chunkIndex: row.chunkIndex,
                entityName: s.name,
                entityType: s.type,
                scope,
              })
            }
          }
        }
      }
    }

    const result: FindDefinitionResult = {
      totalMatches: matches.length,
      matches,
    }

    return {
      content: this.withWarnings([{ type: 'text', text: JSON.stringify(result, null, 2) }]),
    }
  }

  /**
   * find_references tool handler.
   *
   * Two-phase reference-finding strategy:
   * 1. Import metadata scan — find chunks whose `codeMeta.imports` contain
   *    an exact-match import of `symbolName`.
   * 2. FTS text mention search — find chunks whose text contains
   *    `symbolName` via the ngram FTS index.
   *
   * Results are merged with import references first, deduplicated by
   * (filePath, chunkIndex), and capped at `limit` (default 10, max 50).
   * Each phase is independently resilient — an error in one phase does
   * not prevent results from the other.
   */
  async handleFindReferences(args: FindReferencesInput): Promise<{ content: RagContentBlock[] }> {
    if (typeof args.symbolName !== 'string' || args.symbolName.trim().length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'symbolName must be a non-empty string')
    }
    if (args.limit !== undefined && args.limit !== null) {
      if (
        typeof args.limit !== 'number' ||
        !Number.isInteger(args.limit) ||
        args.limit < 1 ||
        args.limit > 50
      ) {
        throw new McpError(ErrorCode.InvalidParams, 'limit must be an integer between 1 and 50')
      }
    }
    const { symbolName, limit = 10 } = args

    const importMatches: ReferenceMatch[] = []
    const textMatches: ReferenceMatch[] = []

    // Phase 1: import metadata scan
    try {
      const metaRows = await this.instanceRouter.getCodeChunksWithMeta()
      for (const row of metaRows) {
        const { imports } = row.codeMeta
        if (!imports) continue
        for (const imp of imports) {
          if (imp.name === symbolName) {
            importMatches.push({
              filePath: row.filePath,
              chunkIndex: row.chunkIndex,
              referenceType: 'import',
              ...(imp.source ? { importSource: imp.source } : {}),
              ...(imp.isDefault !== undefined ? { isDefault: imp.isDefault } : {}),
              ...(imp.isNamespace !== undefined ? { isNamespace: imp.isNamespace } : {}),
            })
            break // one import match per chunk
          }
        }
      }
    } catch (error) {
      // Phase 1 is best-effort — log and continue with phase 2
      logError('find_references:import-scan', error)
    }

    // Phase 2: FTS text mention search
    try {
      const textRefs = await this.instanceRouter.findTextReferences(symbolName, limit * 3)
      for (const ref of textRefs) {
        textMatches.push({
          filePath: ref.filePath,
          chunkIndex: ref.chunkIndex,
          referenceType: 'text_mention',
          context: ref.context,
        })
      }
    } catch (error) {
      // Phase 2 is best-effort — log and continue with phase 1 results
      logError('find_references:fts', error)
    }

    // Merge: imports first, deduplicate by (filePath, chunkIndex)
    const seen = new Set<string>()
    const merged: ReferenceMatch[] = []

    for (const m of importMatches) {
      const key = `${m.filePath}:${m.chunkIndex}`
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(m)
      }
    }

    for (const m of textMatches) {
      const key = `${m.filePath}:${m.chunkIndex}`
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(m)
      }
    }

    const totalMatches = merged.length
    const result: FindReferencesResult = {
      totalMatches,
      matches: merged.slice(0, limit),
    }

    return {
      content: this.withWarnings([{ type: 'text', text: JSON.stringify(result, null, 2) }]),
    }
  }

  /**
   * Start file watcher on all base directories. When files change, they
   * are automatically reindexed. Debounces rapid changes (500ms window)
   * to avoid bursty reindexing from editor auto-saves.
   *
   * Uses Node.js built-in fs.watch — no external dependencies.
   */
  startFileWatcher(): void {
    if (this.baseDirs.length === 0) {
      console.error('RAGServer: File watcher has no baseDirs to watch — skipping')
      return
    }

    const pending = new Map<string, ReturnType<typeof setTimeout>>()
    const DEBOUNCE_MS = 500

    const scheduleReingest = (filePath: string): void => {
      const existing = pending.get(filePath)
      if (existing) clearTimeout(existing)

      pending.set(
        filePath,
        setTimeout(async () => {
          pending.delete(filePath)
          try {
            console.error(`RAGServer: File changed, reindexing "${filePath}"`)
            await this.ingestFileCore(filePath)
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            console.error(`RAGServer: Failed to reindex "${filePath}": ${msg}`)
          }
        }, DEBOUNCE_MS)
      )
    }

    for (const dir of this.baseDirs) {
      try {
        const watcher = watch(dir, { recursive: true }, (_eventType, filename) => {
          if (!filename) return
          const filePath = resolve(dir, filename)
          if (
            filename.startsWith('.') ||
            filename.includes('node_modules') ||
            this.excludePaths.some((ex) => filePath.startsWith(ex))
          ) {
            return
          }
          scheduleReingest(filePath)
        })

        watcher.on('error', (err: Error) => {
          console.error(`RAGServer: watcher error on "${dir}":`, err.message)
        })

        console.error(`RAGServer: Watching "${dir}" for file changes`)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`RAGServer: Failed to watch "${dir}": ${msg}`)
      }
    }

    console.error(
      `RAGServer: File watcher started on ${this.baseDirs.length} director${this.baseDirs.length === 1 ? 'y' : 'ies'}`
    )
  }

  /**
   * Start the server
   */
  async run(): Promise<void> {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
    console.error('RAGServer running on stdio transport')
  }

  /**
   * Stop the server and release resources
   */
  async close(): Promise<void> {
    await this.server.close()
    await this.instanceRouter.close()
    await this.embedder.dispose()
    console.error('RAGServer stopped')
  }
}
