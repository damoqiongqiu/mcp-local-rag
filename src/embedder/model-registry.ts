// Model registry: whitelist, alias resolution, validation, metadata lookup

/**
 * Known embedding model entry.
 *
 * The `name` field MUST match the model identifier that Transformers.js
 * `pipeline('feature-extraction', name)` accepts.  For HuggingFace models
 * this is the full `<namespace>/<repo>` string (e.g. `Xenova/all-MiniLM-L6-v2`).
 */
export interface ModelEntry {
  /** HuggingFace model path accepted by Transformers.js pipeline() */
  name: string
  /** Human-readable display label */
  label: string
  /** Approximate ONNX model download size (in MB) */
  approxSizeMb: number
  /** Embedding vector dimension */
  dimension: number
}

// ============================================
// Curated model whitelist
// ============================================

/**
 * Recommended embedding models, ordered by size.
 *
 * Every entry here has been verified to work with Transformers.js
 * `feature-extraction` pipeline on cpu (the default device).
 */
export const KNOWN_MODELS: ModelEntry[] = [
  {
    name: 'Xenova/all-MiniLM-L6-v2',
    label: 'all-MiniLM-L6-v2 (384d, ~90MB)',
    approxSizeMb: 90,
    dimension: 384,
  },
  {
    name: 'Xenova/multi-qa-MiniLM-L6-cos-v1',
    label: 'multi-qa-MiniLM-L6-cos-v1 (384d, ~90MB)',
    approxSizeMb: 90,
    dimension: 384,
  },
  {
    name: 'Xenova/all-MiniLM-L12-v2',
    label: 'all-MiniLM-L12-v2 (384d, ~130MB)',
    approxSizeMb: 130,
    dimension: 384,
  },
  {
    name: 'Xenova/bge-small-en-v1.5',
    label: 'bge-small-en-v1.5 (384d, ~130MB)',
    approxSizeMb: 130,
    dimension: 384,
  },
  {
    name: 'Xenova/bge-base-en-v1.5',
    label: 'bge-base-en-v1.5 (768d, ~420MB)',
    approxSizeMb: 420,
    dimension: 768,
  },
  {
    name: 'Xenova/all-mpnet-base-v2',
    label: 'all-mpnet-base-v2 (768d, ~420MB)',
    approxSizeMb: 420,
    dimension: 768,
  },
]

// ============================================
// Alias resolution
// ============================================

/**
 * Short aliases that map to full model names.
 *
 * These allow users to type e.g. `--model-name mini` instead of the
 * verbose full path.  Aliases are case-insensitive, and `mini` is the
 * recommended default.
 */
export const MODEL_ALIASES: Record<string, string> = {
  mini: 'Xenova/all-MiniLM-L6-v2',
  'mini-l6': 'Xenova/all-MiniLM-L6-v2',
  'mini-l12': 'Xenova/all-MiniLM-L12-v2',
  mpnet: 'Xenova/all-mpnet-base-v2',
  'bge-small': 'Xenova/bge-small-en-v1.5',
  'bge-base': 'Xenova/bge-base-en-v1.5',
  'multi-qa': 'Xenova/multi-qa-MiniLM-L6-cos-v1',
}

// ============================================
// Public API
// ============================================

/**
 * Resolve a model name through the alias table, then lookup in the known-model
 * list.  Returns the canonical `name` and the full `ModelEntry` if recognised,
 * or `null` if the model is unknown.
 *
 * Unknown models are NOT rejected here — this function is advisory only.
 * Callers should decide whether to warn or reject based on context.
 */
export function resolveModel(input: string): { name: string; entry: ModelEntry | null } {
  const lowerAlias = MODEL_ALIASES[input.toLowerCase()]
  const canonicalName = lowerAlias ?? input

  const entry = KNOWN_MODELS.find((m) => m.name === canonicalName) ?? null
  return { name: canonicalName, entry }
}

/**
 * Human-readable size hint for the initialisation log line.
 *
 * - Known model → `"~90MB"`
 * - Unknown model → `"unknown size"` so the user knows we don't have metadata.
 */
export function modelSizeHint(modelName: string): string {
  const { entry } = resolveModel(modelName)
  if (entry) return `~${entry.approxSizeMb}MB`
  return 'unknown size'
}

/**
 * Generate a user-friendly validation warning for unknown / suspicious models.
 * Returns `undefined` when the model looks fine.
 *
 * This is intentionally non-blocking — we warn but never reject.  Users
 * may legitimately use Transformers.js-compatible models not in our curated
 * list, and we don't want to break that.
 */
export function validateModelAdvisory(modelName: string): string | undefined {
  const { entry } = resolveModel(modelName)

  if (!entry) {
    const knownList = KNOWN_MODELS.map((m) => `  - ${m.name}  ${m.label}`).join('\n')
    const aliasList = Object.entries(MODEL_ALIASES)
      .map(([alias, target]) => `  - ${alias} → ${target}`)
      .join('\n')
    return (
      `Model "${modelName}" is not in the known-model list.\n` +
      `Known models:\n${knownList}\n` +
      `Aliases:\n${aliasList}`
    )
  }
  return undefined
}

/**
 * Look up whether a model name is a known alias (before resolution).
 * Used to give a nicer log message.
 */
export function isAlias(input: string): boolean {
  return input.toLowerCase() in MODEL_ALIASES
}
