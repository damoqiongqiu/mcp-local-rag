// ============================================
// HuggingFace connectivity auto-detection
// ============================================
//
// Problem: huggingface.co is blocked in mainland China. Users must manually
// set HF_ENDPOINT=https://hf-mirror.com. If they don't know this, model
// download hangs/blocks silently.
//
// Solution: multi-layer mirror chain:
//   1. Pre-flight HEAD probe to each mirror (3s timeout) — fast & cheap
//   2. Known-mirror auto-fallback when primary is unreachable
//   3. Download-failure retry with next mirror in the chain
//   4. ModelScope.cn fallback for Chinese users (different path template)
//
// Env vars:
//   HF_ENDPOINT      — explicit override, always wins (no auto-detect)
//   HF_AUTO_MIRROR    — set to "0" or "false" to disable auto-detection

// ============================================
// Mirror Configuration
// ============================================

/**
 * What kind of URL structure the mirror uses.
 *
 * - 'hf-hub': Standard HuggingFace Hub URL pattern.
 *   Files at {model}/resolve/{revision}/{file}
 *   Hub API at /api/models/{model}
 *
 * - 'modelscope': ModelScope.cn API pattern.
 *   Files at api/v1/models/{model}/repo?Revision=master&FilePath=...
 *   No Hub API — Transformers.js lists files by direct repo-file API.
 */
type MirrorUrlStyle = 'hf-hub' | 'modelscope'

/** Configuration for a single mirror in the fallback chain */
export interface MirrorConfig {
  /** Base URL of the mirror */
  url: string
  /** Transformers.js remotePathTemplate */
  pathTemplate: string
  /** URL structure style — determines probing strategy */
  urlStyle: MirrorUrlStyle
}

/**
 * Priority-ordered mirror chain for auto-detection.
 *
 * huggingface.co → hf-mirror.com → modelscope.cn
 *
 * ModelScope is last because:
 *  1. It's a different URL structure → requires env.remotePathTemplate
 *  2. Not all HF models are synced to ModelScope (coverage < 100%)
 *  3. ModelScope LFS files use 302 redirects with expiring auth keys
 *  4. It's the only working option for Chinese users without proxy
 */
const MIRROR_CHAIN: readonly MirrorConfig[] = [
  {
    url: 'https://huggingface.co',
    pathTemplate: '{model}/resolve/{revision}/',
    urlStyle: 'hf-hub',
  },
  {
    url: 'https://hf-mirror.com',
    pathTemplate: '{model}/resolve/{revision}/',
    urlStyle: 'hf-hub',
  },
  {
    url: 'https://modelscope.cn',
    pathTemplate: 'api/v1/models/{model}/repo?Revision=master&FilePath=',
    urlStyle: 'modelscope',
  },
]

/** Default mirror index (huggingface.co) */
const DEFAULT_MIRROR_INDEX = 0

/** timeout for HEAD probe (ms) */
const PROBE_TIMEOUT_MS = 3000

// ============================================
// Public API
// ============================================

export interface ResolvedEndpoint {
  /** The endpoint URL to use for model downloads */
  endpoint: string
  /**
   * Transformers.js remotePathTemplate for this endpoint.
   * Different mirrors use different URL structures.
   */
  remotePathTemplate: string
  /** true if auto-detection switched away from the primary */
  switched: boolean
  /**
   * Whether the endpoint supports the full HuggingFace Hub API.
   *
   * Transformers.js calls /api/models/{model} to list files before
   * downloading. Some mirrors (e.g. hf-mirror.com) only proxy file
   * downloads (/resolve/main/) but NOT the Hub API. When apiComplete
   * is false, the endpoint cannot be used for model initialization
   * even if it responds to HEAD pings.
   */
  apiComplete: boolean
  /** User-friendly log line describing what happened */
  logLine: string
}

/**
 * Probe a URL with a HEAD request.
 * Returns true if the endpoint responded within the timeout.
 */
export async function probeEndpoint(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      // Don't follow redirects — we just want to know if the host is reachable
      redirect: 'manual',
    })
    // Any response (2xx, 3xx, even 4xx) means the host is reachable
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Probe whether a mirror can serve model files.
 *
 * For 'hf-hub' mirrors: checks /api/models/{model} for JSON response.
 *   Transformers.js needs the Hub API to list model files before downloading.
 *   Some mirrors (e.g. hf-mirror.com) proxy file downloads but NOT the Hub API.
 *
 * For 'modelscope' mirrors: directly fetches a known small model file via
 *   the pathTemplate. ModelScope has no Hub API — Transformers.js lists files
 *   via the same repo API.
 */
export async function probeApiEndpoint(
  mirror: MirrorConfig,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    if (mirror.urlStyle === 'hf-hub') {
      // Probe HF Hub API endpoint
      const apiUrl = `${mirror.url.replace(/\/$/, '')}/api/models/Xenova/all-MiniLM-L6-v2`
      const response = await fetch(apiUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) return false
      const contentType = response.headers.get('content-type') || ''
      return contentType.includes('application/json')
    }

    // modelscope: probe via the repo API.
    // NOTE: ModelScope does NOT support HEAD on the repo endpoint (returns 404).
    // Use GET with a tiny file (config.json, ~650 bytes) to minimize overhead.
    // Transformers.js adds leading / to {file}, so the URL would be
    // FilePath=/config.json — ModelScope needs FilePath=config.json.
    // We match Transformers.js behaviour by including the leading slash here,
    // then patch it in the embedder's env.fetch wrapper.
    const testModel = 'Xenova/all-MiniLM-L6-v2'
    const testFile = '/config.json' // leading / matches what Transformers.js does
    const resolvedPath = mirror.pathTemplate
      .replace('{model}', testModel)
      .replace('{revision}', 'master')
      .replace('{file}', testFile)
    const testUrl = `${mirror.url.replace(/\/$/, '')}/${resolvedPath}`
    // Strip leading / from FilePath= for ModelScope — the probe simulates
    // what the embedder's env.fetch fixup does at runtime.
    const fixedUrl = testUrl.replace(/(FilePath=)(\/)/g, '$1')
    const response = await fetch(fixedUrl, { method: 'GET', signal: controller.signal })
    // 302 (LFS redirect) or 200 (direct) both mean the file exists
    // 404 means the model isn't on ModelScope
    return response.ok || response.status === 302
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolve which HuggingFace endpoint to use.
 *
 * Walks the MIRROR_CHAIN in priority order, probing each mirror for
 * reachability and API completeness. Returns the first working mirror.
 *
 * Logic:
 *   1. If HF_ENDPOINT is explicitly set → use it (manual override always wins)
 *   2. If HF_AUTO_MIRROR=0/false → use huggingface.co (no auto-detect)
 *   3. Walk the chain, for each mirror:
 *      a. Probe reachability (3s HEAD)
 *      b. If reachable → probe API completeness
 *         - hf-hub mirrors: check /api/models/ JSON response
 *         - modelscope mirrors: check a known file exists
 *      c. If API works → use this mirror
 *      d. If API broken → log and continue to next mirror
 *   4. If no mirror works → return primary with apiComplete=false
 */
export async function resolveEndpoint(options: {
  /** Explicit HF_ENDPOINT from env. Undefined = not set. */
  explicitEndpoint?: string
  /** HF_AUTO_MIRROR — set to false to disable auto-detection */
  autoMirror?: boolean
}): Promise<ResolvedEndpoint> {
  // 1. Explicit override always wins — user takes responsibility for API
  const explicit = options.explicitEndpoint
  if (explicit) {
    return {
      endpoint: explicit,
      remotePathTemplate: '{model}/resolve/{revision}/',
      switched: false,
      apiComplete: true,
      logLine: `Using explicit HF_ENDPOINT="${explicit}"`,
    }
  }

  // 2. Auto-detection disabled → use default
  const primary = MIRROR_CHAIN[DEFAULT_MIRROR_INDEX]!
  if (options.autoMirror === false) {
    return {
      endpoint: primary.url,
      remotePathTemplate: primary.pathTemplate,
      switched: false,
      apiComplete: true,
      logLine: `Auto-mirror disabled, using default ${primary.url}`,
    }
  }

  // 3. Walk the mirror chain
  const attempts: string[] = []

  for (const mirror of MIRROR_CHAIN) {
    const reachable = await probeEndpoint(mirror.url)

    if (!reachable) {
      attempts.push(`${mirror.url} (unreachable)`)
      continue
    }

    // Mirror is reachable — check whether it can actually serve models
    const apiOk = await probeApiEndpoint(mirror)

    if (!apiOk) {
      // Reachable but API is incomplete/degraded
      const reason =
        mirror.urlStyle === 'modelscope'
          ? 'model not found on ModelScope (model may not be mirrored)'
          : 'Hub API (/api/models/) is unavailable'
      attempts.push(`${mirror.url} (reachable but ${reason})`)
      continue
    }

    // Found a fully working mirror!
    const logLine =
      mirror === primary
        ? `${mirror.url} is reachable, using as primary`
        : `${primary.url} is unreachable, auto-switching to mirror ${mirror.url}`

    return {
      endpoint: mirror.url,
      remotePathTemplate: mirror.pathTemplate,
      switched: mirror !== primary,
      apiComplete: true,
      logLine,
    }
  }

  // 4. No mirror works — return primary with detailed diagnostic
  const diagnostic =
    attempts.length > 0
      ? [
          `${primary.url} is unreachable. Checked mirrors: ${attempts.join(', ')}.`,
          '',
          'No working endpoint found. Suggestions:',
          '  1. Set HF_ENDPOINT to a full mirror that supports the Hub API:',
          '     export HF_ENDPOINT=https://hf-mirror.com (or another mirror URL)',
          '  2. Route traffic through a proxy to reach huggingface.co:',
          '     export HTTPS_PROXY=http://127.0.0.1:7890',
          '  3. Pre-download models to CACHE_DIR (see setup docs)',
          '  4. Set HF_AUTO_MIRROR=false to skip auto-detection',
        ].join('\n')
      : `Both ${primary.url} and all mirrors are unreachable. Network may be restricted.`

  return {
    endpoint: primary.url,
    remotePathTemplate: primary.pathTemplate,
    switched: false,
    apiComplete: false,
    logLine: diagnostic,
  }
}

/**
 * Get the next mirror in the chain after the current one.
 * Returns undefined if current is the last in the chain.
 */
export function nextMirror(currentEndpoint: string): MirrorConfig | undefined {
  const idx = MIRROR_CHAIN.findIndex((m) => m.url === currentEndpoint)
  if (idx === -1) return undefined
  return MIRROR_CHAIN[idx + 1]
}

export { MIRROR_CHAIN, PROBE_TIMEOUT_MS }
