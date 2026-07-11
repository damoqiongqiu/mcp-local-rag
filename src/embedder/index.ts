// Embedder implementation with Transformers.js

import {
  type DataType,
  type DeviceType,
  env,
  ModelRegistry,
  pipeline,
} from '@huggingface/transformers'
import { ProxyAgent, fetch as undiciFetch } from 'undici'
import { AppError } from '../utils/errors.js'
import { nextMirror, resolveEndpoint } from './connectivity.js'
import { isAlias, modelSizeHint, resolveModel } from './model-registry.js'

// ============================================
// Type Definitions
// ============================================

/**
 * Embedder configuration
 */
export interface EmbedderConfig {
  /** HuggingFace model path */
  modelPath: string
  /** Batch size */
  batchSize: number
  /** Model cache directory */
  cacheDir: string
  /** HuggingFace hub endpoint (mirror) — sets env.remoteHost */
  remoteHost?: string
  /** HTTPS/HTTP proxy URL (e.g. http://127.0.0.1:7890) for model downloads */
  proxy?: string
  /** Enable auto-mirror detection (HF_AUTO_MIRROR). Default: true */
  autoMirror?: boolean
  /** Device type */
  device?: string
  /**
   * Embedding quantization dtype (fp32, fp16, q8, int8, ...). Passed through to
   * transformers.js — no allowlist. Undefined means "unset": initialize() then
   * applies the fp32 default. The unset-vs-explicit-fp32 distinction is
   * preserved on purpose (it gates failure-path error enrichment).
   */
  dtype?: string
}

// ============================================
// Error Classes
// ============================================

/**
 * Embedding generation error
 */
export class EmbeddingError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, 'embedder', 'internal', cause)
    this.name = 'EmbeddingError'
  }
}

// ============================================
// Embedder Class
// ============================================

/**
 * Embedding generation class using Transformers.js
 *
 * Responsibilities:
 * - Generate embedding vectors (dimension depends on model)
 * - Transformers.js wrapper
 * - Batch processing (size 8)
 */
export class Embedder {
  // Using unknown to avoid TS2590 (union type too complex with @types/jsdom)
  private model: unknown = null
  private initPromise: Promise<void> | null = null
  private readonly config: EmbedderConfig

  constructor(config: EmbedderConfig) {
    this.config = config
  }

  /**
   * Release resources held by the Embedder pipeline
   */
  async dispose(): Promise<void> {
    const model = this.model as { dispose?: () => Promise<void> } | null
    if (model && typeof model.dispose === 'function') {
      try {
        await model.dispose()
      } catch (error) {
        console.error('Error disposing embedder model:', error)
      }
    }
    this.model = null
    this.initPromise = null
  }

  /**
   * Initialize Transformers.js model
   */
  async initialize(): Promise<void> {
    // Skip if already initialized
    if (this.model) {
      return
    }

    // Set cache directory BEFORE creating pipeline
    env.cacheDir = this.config.cacheDir

    // Use proxy-aware fetch when HTTPS_PROXY is set.
    // Node.js built-in fetch (undici) does NOT respect HTTP_PROXY/HTTPS_PROXY
    // env vars — we must create a ProxyAgent explicitly.
    if (this.config.proxy) {
      const proxyAgent = new ProxyAgent({ uri: this.config.proxy, proxyTunnel: true })
      env.fetch = (url: string | URL, init?: Record<string, unknown>) => {
        return undiciFetch(url, { ...init, dispatcher: proxyAgent })
      }
      console.error(`Embedder: Using proxy "${this.config.proxy}" for model downloads`)
    }

    // --- HuggingFace endpoint resolution (auto-mirror detection) ---
    //
    // Priority:
    //   1. HF_ENDPOINT env var (explicit) → always wins, no auto-detect
    //   2. HF_AUTO_MIRROR=false → use huggingface.co, no auto-detect
    //   3. Auto-detect: probe huggingface.co → if blocked, check mirror API
    //
    // hubApiBroken: set by auto-detect when the mirror is reachable but its
    // /api/models/ Hub API is missing. Used in the download failure path to
    // skip a wasteful mirror retry.
    let hubApiBroken = false

    if (this.config.remoteHost) {
      // Explicit HF_ENDPOINT set by user — use it directly
      env.remoteHost = this.config.remoteHost
      env.remotePathTemplate = '{model}/resolve/{revision}/{file}'
      console.error(`Embedder: Using explicit HF_ENDPOINT="${this.config.remoteHost}"`)
    } else {
      // Auto-detect or fallback
      const resolveOpts: { autoMirror?: boolean } = {}
      if (this.config.autoMirror !== undefined) {
        resolveOpts.autoMirror = this.config.autoMirror
      }
      const resolved = await resolveEndpoint(resolveOpts)

      if (resolved.switched) {
        console.error(`Embedder: ${resolved.logLine}`)
      }
      // When the endpoint's Hub API is broken (e.g. hf-mirror.com only
      // proxies file downloads but not /api/models/), log a clear warning.
      if (!resolved.apiComplete) {
        console.error(`Embedder: ${resolved.logLine}`)
      }

      env.remoteHost = resolved.endpoint
      env.remotePathTemplate = '{model}/resolve/{revision}/{file}'

      // Track for the download failure path (see catch block below).
      hubApiBroken = !resolved.apiComplete
    }

    // No fallback — if the requested device fails, init throws.
    const device = this.config.device || 'cpu'

    console.error(`Embedder: Setting cache directory to "${this.config.cacheDir}"`)
    console.error(`Embedder: Loading model "${this.config.modelPath}" on device "${device}"...`)

    try {
      await this.loadModel(device)
      console.error(`Embedder: Model loaded successfully (device=${device})`)
    } catch (error) {
      const nativeError = error as Error

      // --- Mirror fallback on download failure ---
      // If the primary endpoint failed and we haven't tried the mirror yet,
      // retry with the mirror before giving up.
      const currentEndpoint = env.remoteHost as string
      const mirror = nextMirror(currentEndpoint)

      // Skip mirror retry when auto-detect already confirmed the mirror's
      // Hub API is broken (e.g. hf-mirror.com doesn't serve /api/models/).
      // Retrying would just waste time before the same Hub API failure.
      if (hubApiBroken) {
        throw new EmbeddingError(
          [
            `Failed to download model "${this.config.modelPath}" from ${currentEndpoint}.`,
            '',
            `Auto-mirror detected that ${mirror ?? 'the mirror'} is reachable for file ` +
              'downloads but its Hub API (/api/models/) is unavailable.',
            'Transformers.js requires the Hub API to list model files before downloading.',
            '',
            'Suggestions:',
            '  1. Use a full mirror that proxies the Hub API:',
            `     export HF_ENDPOINT=<full-mirror-url>`,
            '  2. Route traffic through a proxy to reach huggingface.co:',
            '     export HTTPS_PROXY=http://127.0.0.1:7890',
            '  3. Pre-download models to CACHE_DIR (see setup docs)',
            `  4. Set HF_AUTO_MIRROR=false to skip auto-detection`,
          ].join('\n'),
          nativeError
        )
      }

      if (mirror && !this.config.remoteHost) {
        console.error(
          `Embedder: Download failed from ${currentEndpoint}, retrying with mirror ${mirror}...`
        )
        env.remoteHost = mirror
        try {
          await this.loadModel(device)
          console.error(
            `Embedder: Model loaded successfully via mirror ${mirror} (device=${device})`
          )
          return
        } catch (retryError) {
          // Both failed — throw enhanced error with suggestions
          const suggestions = [
            `Both ${currentEndpoint} and ${mirror} are unreachable.`,
            'Suggestions:',
            `  1. Set HF_ENDPOINT to a reachable mirror (e.g. export HF_ENDPOINT=https://hf-mirror.com)`,
            '  2. Configure a proxy: export HTTPS_PROXY=http://127.0.0.1:7890',
            '  3. Manually download models to your CACHE_DIR (see setup docs)',
            '  4. Check your network connection',
          ].join('\n')
          throw new EmbeddingError(
            `Failed to download model "${this.config.modelPath}": ${suggestions}`,
            retryError as Error
          )
        }
      }

      // No mirror to fall back to — single-endpoint failure
      const message = await this.enrichDtypeFailureMessage(nativeError.message)
      throw new EmbeddingError(message, nativeError)
    }
  }

  /**
   * Load the transformers.js pipeline.
   * Extracted so retry-on-mirror-fallback can call it without duplicating logic.
   */
  private async loadModel(device: string): Promise<void> {
    this.model = await pipeline('feature-extraction', this.config.modelPath, {
      dtype: (this.config.dtype ?? 'fp32') as DataType,
      device: device as DeviceType,
    })
  }

  /**
   * Best-effort failure-path enrichment for an explicit `RAG_DTYPE`.
   *
   * When the load failed and a dtype was explicitly requested, consult the
   * model's available dtypes and, if the requested one is absent, return a
   * message that names what the model provides. The enumeration is a Hub
   * network call wrapped in its own try/catch: if it fails (e.g. air-gapped
   * after caching) it degrades to a generic clear, dtype-aware message rather
   * than surfacing a confusing secondary error (TD-3). This method never throws
   * and never converts the load failure into a fallback — the caller always
   * re-throws.
   *
   * @param nativeMessage - The underlying load-failure message.
   * @returns The message to wrap in the thrown `EmbeddingError`.
   */
  private async enrichDtypeFailureMessage(nativeMessage: string): Promise<string> {
    const requestedDtype = this.config.dtype
    if (requestedDtype === undefined) {
      return nativeMessage
    }

    try {
      const availableDtypes = await ModelRegistry.get_available_dtypes(this.config.modelPath)
      if (availableDtypes.includes(requestedDtype)) {
        // The requested dtype exists for this model, so the load failed for some
        // other reason — keep the native message, don't misattribute it to dtype.
        return nativeMessage
      }
      return `Model "${this.config.modelPath}" provides dtypes [${availableDtypes.join(', ')}]; requested dtype "${requestedDtype}" is unavailable. Set RAG_DTYPE to one of the available dtypes, or leave it unset for the fp32 default.`
    } catch {
      // Enumeration unavailable (e.g. offline). Degrade to a generic clear,
      // dtype-aware message — no secondary error, still re-thrown by the caller.
      return `Failed to load model "${this.config.modelPath}" with requested dtype "${requestedDtype}". The model may not provide this dtype, and the available-dtype list could not be retrieved. Set RAG_DTYPE to a dtype the model provides, or leave it unset for the fp32 default. (${nativeMessage})`
    }
  }

  /**
   * Ensure model is initialized (lazy initialization)
   * This method is called automatically by embed() and embedBatch()
   */
  private async ensureInitialized(): Promise<void> {
    // Already initialized
    if (this.model) {
      return
    }

    // Initialization already in progress, wait for it
    if (this.initPromise) {
      await this.initPromise
      return
    }

    const size = modelSizeHint(this.config.modelPath)
    const aliasNote = isAlias(this.config.modelPath)
      ? ` (alias "${this.config.modelPath}" → "${resolveModel(this.config.modelPath).name}")`
      : ''
    console.error(
      `Embedder: First use detected. Initializing model (downloading ${size}, may take 1-2 minutes)...${aliasNote}`
    )

    this.initPromise = this.initialize().catch((error) => {
      // Clear initPromise on failure to allow retry on the next call.
      this.initPromise = null
      throw error
    })

    await this.initPromise
  }

  /**
   * Convert single text to embedding vector
   *
   * @param text - Text
   * @returns Embedding vector (dimension depends on model)
   */
  async embed(text: string): Promise<number[]> {
    // Reject empty input before paying for model init.
    if (text.length === 0) {
      throw new EmbeddingError('Cannot generate embedding for empty text')
    }

    // Lazy initialization: initialize on first use if not already initialized
    await this.ensureInitialized()

    try {
      const options = { pooling: 'mean', normalize: true }
      const modelCall = this.model as (
        text: string,
        options: unknown
      ) => Promise<{ data: Float32Array }>
      const output = await modelCall(text, options)

      // Access raw data via .data property
      const embedding = Array.from(output.data)
      return embedding
    } catch (error) {
      if (error instanceof EmbeddingError) {
        throw error
      }
      throw new EmbeddingError(
        `Failed to generate embedding: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  /**
   * Convert multiple texts to embedding vectors with batch processing
   *
   * @param texts - Array of texts
   * @returns Array of embedding vectors (dimension depends on model)
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    // Nothing to embed → skip model init entirely.
    if (texts.length === 0) {
      return []
    }

    // Preserve embed()'s empty-text contract for batch elements (the previous
    // per-text implementation rejected empty strings via embed()).
    if (texts.some((text) => text.length === 0)) {
      throw new EmbeddingError('Cannot generate embedding for empty text')
    }

    // Lazy initialization: initialize on first use if not already initialized
    await this.ensureInitialized()

    try {
      const options = { pooling: 'mean', normalize: true }
      // True batched inference: the feature-extraction pipeline accepts an
      // array of texts and returns a single [batchLen, dim] tensor in one
      // forward pass. The previous implementation called the model once per
      // text via Promise.all, so `batchSize` had no real effect (onnxruntime
      // inference is not parallelized by Promise.all). Passing the whole batch
      // lets the runtime batch the matmuls. Mean-pooling honors the attention
      // mask, so per-row vectors match the single-text result.
      const modelCall = this.model as (
        input: string[],
        options: unknown
      ) => Promise<{ data: Float32Array; dims: number[] }>

      const embeddings: number[][] = []
      for (let i = 0; i < texts.length; i += this.config.batchSize) {
        const batch = texts.slice(i, i + this.config.batchSize)
        const output = await modelCall(batch, options)

        // Validate the output shape before slicing so a runtime/model contract
        // change surfaces as a clear error rather than silently wrong vectors.
        const dim = output?.dims?.[output.dims.length - 1]
        if (
          !output ||
          !(output.data instanceof Float32Array) ||
          typeof dim !== 'number' ||
          dim <= 0 ||
          output.data.length !== batch.length * dim
        ) {
          throw new EmbeddingError('Unexpected embedder batch output shape')
        }

        for (let row = 0; row < batch.length; row++) {
          embeddings.push(Array.from(output.data.subarray(row * dim, (row + 1) * dim)))
        }
      }

      return embeddings
    } catch (error) {
      if (error instanceof EmbeddingError) {
        throw error
      }
      throw new EmbeddingError(
        `Failed to generate batch embeddings: ${(error as Error).message}`,
        error as Error
      )
    }
  }
}
