// RAG_INSTANCES environment variable parser.
//
// Parses the RAG_INSTANCES JSON array into structured ParsedInstanceInput
// objects with field-level validation and detailed error messages.

import { basename } from 'node:path'

// ============================================
// Types
// ============================================

/**
 * Raw parsed input from RAG_INSTANCES before resolution.
 * `name` is optional in the JSON — when absent, the parser derives it
 * from the last path segment of `baseDir`.
 */
export interface ParsedInstanceInput {
  name: string
  baseDir: string
  dbPath: string
}

/**
 * Discriminated result of {@link parseRagInstances}.
 * Callers branch on `ok` to handle syntax/config errors without try/catch.
 */
export type ParseRagInstancesResult =
  | { ok: true; value: ParsedInstanceInput[] }
  | { ok: false; error: string }

// ============================================
// Public API
// ============================================

/**
 * Parse the RAG_INSTANCES environment variable.
 *
 * Accepts a JSON array of objects with `name` (optional), `baseDir` (required),
 * and `dbPath` (required) string fields. Produces field-level error messages
 * referencing the exact array index and field where validation fails.
 *
 * When `name` is absent, it defaults to the last path segment of `baseDir`.
 */
export function parseRagInstances(raw: string): ParseRagInstancesResult {
  const trimmed = raw.trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return {
      ok: false,
      error: `RAG_INSTANCES is not valid JSON: ${truncate(raw)}`,
    }
  }

  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      error: `RAG_INSTANCES must be a JSON array (received ${describeType(parsed)})`,
    }
  }

  if (parsed.length === 0) {
    return {
      ok: false,
      error: 'RAG_INSTANCES must not be an empty array',
    }
  }

  const result: ParsedInstanceInput[] = []

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i]
    if (item === null || typeof item !== 'object') {
      return {
        ok: false,
        error: `RAG_INSTANCES[${i}] must be an object (received ${describeType(item)})`,
      }
    }

    const obj = item as Record<string, unknown>

    // Validate baseDir
    const baseDir = validateStringField(obj, 'baseDir', i)
    if (baseDir.error) return { ok: false, error: baseDir.error }

    // Validate dbPath
    const dbPath = validateStringField(obj, 'dbPath', i)
    if (dbPath.error) return { ok: false, error: dbPath.error }

    // Validate name (optional, defaults to last segment of baseDir)
    let name: string
    if ('name' in obj && (obj as { name?: unknown }).name !== undefined) {
      const nameResult = validateStringField(obj, 'name', i)
      if (nameResult.error) return { ok: false, error: nameResult.error }
      name = nameResult.value
    } else {
      name = basename(baseDir.value) || baseDir.value
    }

    result.push({ name, baseDir: baseDir.value, dbPath: dbPath.value })
  }

  // Check for duplicate names
  for (let i = 0; i < result.length; i++) {
    const ri = result[i]
    if (ri === undefined) continue
    for (let j = i + 1; j < result.length; j++) {
      const rj = result[j]
      if (rj === undefined) continue
      if (ri.name === rj.name) {
        return {
          ok: false,
          error: `RAG_INSTANCES[${i}] and RAG_INSTANCES[${j}] have duplicate name: ${ri.name}`,
        }
      }
    }
  }

  return { ok: true, value: result }
}

// ============================================
// Private helpers
// ============================================

interface ValidateStringFieldResult {
  error?: string
  value: string
}

function validateStringField(
  obj: Record<string, unknown>,
  field: string,
  index: number
): ValidateStringFieldResult {
  if (!(field in obj)) {
    return { value: '', error: `RAG_INSTANCES[${index}] is missing required field: ${field}` }
  }

  const value = obj[field]
  if (typeof value !== 'string') {
    return {
      value: '',
      error: `RAG_INSTANCES[${index}].${field} must be a string (received ${describeType(value)})`,
    }
  }

  if (value.trim().length === 0) {
    return { value: '', error: `RAG_INSTANCES[${index}].${field} must not be empty` }
  }

  return { value: value.trim() }
}

function describeType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function truncate(input: string, max = 100): string {
  if (input.length <= max) return input
  return `${input.slice(0, max)}...`
}
