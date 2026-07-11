// ============================================
// HuggingFace connectivity auto-detection
// ============================================
//
// Problem: huggingface.co is blocked in mainland China. Users must manually
// set HF_ENDPOINT=https://hf-mirror.com. If they don't know this, model
// download hangs/blocks silently.
//
// Solution: three-layer approach:
//   1. Pre-flight HEAD probe to huggingface.co (3s timeout) — fast & cheap
//   2. Known-mirror auto-fallback when primary is unreachable
//   3. Download-failure retry with mirror if we haven't already
//
// Env vars:
//   HF_ENDPOINT      — explicit override, always wins (no auto-detect)
//   HF_AUTO_MIRROR    — set to "0" or "false" to disable auto-detection

// ============================================
// Mirror Configuration
// ============================================

/** Priority-ordered HuggingFace endpoints */
const MIRROR_CHAIN = ['https://huggingface.co', 'https://hf-mirror.com'] as const

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
 * Probe whether a mirror's Hub API is functional.
 *
 * Transformers.js needs /api/models/{model} to return JSON listing
 * the model's files. Some mirrors (e.g. hf-mirror.com) proxy file
 * downloads but NOT the Hub API — the endpoint returns HTML instead
 * of JSON, causing Transformers.js to see an empty file list → the
 * model path template `{file}` is never filled → download fails
 * with opaque errors.
 *
 * We probe with a small known model (all-MiniLM-L6-v2) to keep the
 * response payload tiny (a few KB).
 */
export async function probeApiEndpoint(
  mirrorUrl: string,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const apiUrl = `${mirrorUrl.replace(/\/$/, '')}/api/models/Xenova/all-MiniLM-L6-v2`
    const response = await fetch(apiUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) return false

    const contentType = response.headers.get('content-type') || ''
    return contentType.includes('application/json')
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolve which HuggingFace endpoint to use.
 *
 * Logic:
 *   1. If HF_ENDPOINT is explicitly set → use it (manual override always wins)
 *   2. If HF_AUTO_MIRROR=0/false → use huggingface.co (no auto-detect)
 *   3. Probe huggingface.co (3s HEAD)
 *      - Reachable → use huggingface.co
 *      - Unreachable → probe mirror (hf-mirror.com)
 *        - Mirror unreachable → both down, error
 *        - Mirror reachable → probe mirror's /api/models/ Hub API
 *          - API works → switch to mirror (full mirror)
 *          - API broken → DON'T switch. Primary is unreachable and mirror
 *            is API-incomplete — model download will fail. Return the
 *            primary with apiComplete=false so the caller can surface a
 *            targeted diagnostic.
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
      switched: false,
      apiComplete: true,
      logLine: `Using explicit HF_ENDPOINT="${explicit}"`,
    }
  }

  // 2. Auto-detection disabled → use default
  if (options.autoMirror === false) {
    return {
      endpoint: MIRROR_CHAIN[DEFAULT_MIRROR_INDEX],
      switched: false,
      apiComplete: true,
      logLine: `Auto-mirror disabled, using default ${MIRROR_CHAIN[DEFAULT_MIRROR_INDEX]}`,
    }
  }

  // 3. Probe primary
  const primaryUrl = MIRROR_CHAIN[DEFAULT_MIRROR_INDEX]
  const primaryReachable = await probeEndpoint(primaryUrl)

  if (primaryReachable) {
    return {
      endpoint: primaryUrl,
      switched: false,
      apiComplete: true,
      logLine: `${primaryUrl} is reachable, using as primary`,
    }
  }

  // 4. Primary unreachable → check mirror
  const mirrorUrl = MIRROR_CHAIN[1]
  const mirrorReachable = await probeEndpoint(mirrorUrl)

  if (!mirrorReachable) {
    // Both primary and mirror are down
    return {
      endpoint: primaryUrl,
      switched: false,
      apiComplete: false,
      logLine: `Both ${primaryUrl} and ${mirrorUrl} are unreachable. Network may be restricted.`,
    }
  }

  // 5. Mirror reachable → probe Hub API completeness
  //
  // Some mirrors (e.g. hf-mirror.com) proxy file downloads (/resolve/main/)
  // but NOT the Hub API (/api/models/). Transformers.js needs the API to
  // list model files before downloading — without it, model init fails.
  const apiOk = await probeApiEndpoint(mirrorUrl)

  if (!apiOk) {
    return {
      endpoint: primaryUrl, // Can't use mirror without Hub API
      switched: false,
      apiComplete: false,
      logLine:
        `${primaryUrl} is unreachable. Mirror ${mirrorUrl} is reachable ` +
        `but its Hub API (/api/models/) is unavailable — Transformers.js ` +
        `requires the API to list model files before downloading. ` +
        `Set HF_ENDPOINT to a full mirror, use HTTPS_PROXY, or pre-download models.`,
    }
  }

  // Full mirror — both file downloads and Hub API available
  return {
    endpoint: mirrorUrl,
    switched: true,
    apiComplete: true,
    logLine: `${primaryUrl} is unreachable, auto-switching to mirror ${mirrorUrl}`,
  }
}

/**
 * Get the next mirror in the chain after the current one.
 * Returns undefined if current is the last in the chain.
 */
export function nextMirror(currentEndpoint: string): string | undefined {
  const idx = MIRROR_CHAIN.indexOf(currentEndpoint as (typeof MIRROR_CHAIN)[number])
  if (idx === -1) return undefined
  return MIRROR_CHAIN[idx + 1]
}

export { MIRROR_CHAIN, PROBE_TIMEOUT_MS }
