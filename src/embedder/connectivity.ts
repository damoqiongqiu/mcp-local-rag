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
 * Resolve which HuggingFace endpoint to use.
 *
 * Logic:
 *   1. If HF_ENDPOINT is explicitly set → use it (manual override always wins)
 *   2. If HF_AUTO_MIRROR=0/false → use huggingface.co (no auto-detect)
 *   3. Probe huggingface.co (3s)
 *      - Reachable → use huggingface.co
 *      - Unreachable → switch to hf-mirror.com
 */
export async function resolveEndpoint(options: {
  /** Explicit HF_ENDPOINT from env. Undefined = not set. */
  explicitEndpoint?: string
  /** HF_AUTO_MIRROR — set to false to disable auto-detection */
  autoMirror?: boolean
}): Promise<ResolvedEndpoint> {
  // 1. Explicit override always wins
  if (options.explicitEndpoint) {
    return {
      endpoint: options.explicitEndpoint,
      switched: false,
      logLine: `Using explicit HF_ENDPOINT="${options.explicitEndpoint}"`,
    }
  }

  // 2. Auto-detection disabled → use default
  if (options.autoMirror === false) {
    return {
      endpoint: MIRROR_CHAIN[DEFAULT_MIRROR_INDEX],
      switched: false,
      logLine: `Auto-mirror disabled, using default ${MIRROR_CHAIN[DEFAULT_MIRROR_INDEX]}`,
    }
  }

  // 3. Probe primary
  const primaryUrl = MIRROR_CHAIN[DEFAULT_MIRROR_INDEX]
  const reachable = await probeEndpoint(primaryUrl)

  if (reachable) {
    return {
      endpoint: primaryUrl,
      switched: false,
      logLine: `${primaryUrl} is reachable, using as primary`,
    }
  }

  // 4. Primary unreachable → switch to mirror
  const mirrorUrl = MIRROR_CHAIN[1]
  return {
    endpoint: mirrorUrl,
    switched: true,
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
