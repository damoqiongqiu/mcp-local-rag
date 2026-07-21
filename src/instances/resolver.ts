// Instance configuration resolver.
//
// Resolves the final InstanceConfig list by parsing RAG_INSTANCES (multi-instance)
// or falling back to BASE_DIRS / BASE_DIR (legacy single-instance). Applies
// security checks, realpath normalization, nesting detection, and dbPath
// conflict detection.

import { realpath } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import { parseBaseDirsEnv } from '../utils/base-dirs.js'
import { checkSensitivePath } from '../utils/sensitive-path.js'
import { parseRagInstances } from './parser.js'
import {
  type InstanceConfig,
  InstanceConfigError,
  type InstanceConfigResult,
  type InstanceConfigWarning,
} from './types.js'

// ============================================
// Public API
// ============================================

/**
 * Take the first root from a BASE_DIRS value as the sole baseDir.
 * Throws if BASE_DIRS is malformed or empty.
 */
export function legacyBaseDir(raw: string): string {
  const parsed = parseBaseDirsEnv(raw)
  if (!parsed.ok) throw parsed.error
  const first = parsed.value[0]
  if (first === undefined) {
    throw new InstanceConfigError('BASE_DIRS is empty')
  }
  return first
}

/**
 * Resolve the final instance configuration from environment variables.
 *
 * Precedence:
 *  1. RAG_INSTANCES — multi-instance JSON array (highest)
 *  2. BASE_DIRS — legacy JSON array (deprecation warning, single instance)
 *  3. BASE_DIR — legacy single path (backward compatible)
 *  4. None — error
 *
 * On success, returns the resolved instances and any warnings.
 * On failure, returns a structured InstanceConfigError.
 */
export async function resolveInstances(
  env: NodeJS.ProcessEnv,
  cwd: string
): Promise<InstanceConfigResult | { error: InstanceConfigError }> {
  const ragInstancesRaw = env['RAG_INSTANCES']
  const baseDirsRaw = env['BASE_DIRS']
  const baseDirRaw = env['BASE_DIR']
  const dbPathRaw = env['DB_PATH']

  if (ragInstancesRaw !== undefined && ragInstancesRaw.trim().length > 0) {
    return resolveMultiInstance(ragInstancesRaw, cwd)
  }

  if (baseDirsRaw !== undefined && baseDirsRaw.trim().length > 0) {
    return resolveLegacyBaseDirs(baseDirsRaw, dbPathRaw, cwd)
  }

  if (baseDirRaw !== undefined && baseDirRaw.trim().length > 0) {
    return resolveLegacyBaseDir(baseDirRaw, dbPathRaw, cwd)
  }

  return { error: new InstanceConfigError('No base directory configured') }
}

// ============================================
// Multi-instance resolution (RAG_INSTANCES)
// ============================================

async function resolveMultiInstance(
  raw: string,
  cwd: string
): Promise<InstanceConfigResult | { error: InstanceConfigError }> {
  const parsed = parseRagInstances(raw)
  if (!parsed.ok) {
    return { error: new InstanceConfigError(parsed.error) }
  }

  const instances: InstanceConfig[] = []

  for (const input of parsed.value) {
    // Security check before realpath so policy violations surface even
    // when the directory exists and is readable.
    const sensitiveError = checkSensitivePath(input.baseDir, 'RAG_INSTANCES')
    if (sensitiveError !== undefined) {
      return { error: new InstanceConfigError(sensitiveError) }
    }

    let resolvedBaseDir: string
    try {
      resolvedBaseDir = await realpath(resolve(input.baseDir))
    } catch (cause) {
      return {
        error: new InstanceConfigError(
          `Failed to resolve base directory for instance "${input.name}": ${input.baseDir}`,
          cause
        ),
      }
    }

    instances.push({
      name: input.name,
      baseDir: withTrailingSep(resolvedBaseDir),
      dbPath: resolve(cwd, input.dbPath),
      rawBaseDir: input.baseDir,
    })
  }

  const warnings = collectWarnings(instances)
  return { instances, warnings }
}

// ============================================
// Legacy single-instance resolution (BASE_DIRS)
// ============================================

async function resolveLegacyBaseDirs(
  baseDirsRaw: string,
  dbPathRaw: string | undefined,
  cwd: string
): Promise<InstanceConfigResult | { error: InstanceConfigError }> {
  let baseDirRaw: string
  try {
    baseDirRaw = legacyBaseDir(baseDirsRaw)
  } catch (error) {
    if (error instanceof InstanceConfigError) return { error }
    return { error: new InstanceConfigError('Failed to parse BASE_DIRS', error) }
  }

  return resolveSingleLegacy(baseDirRaw, dbPathRaw, cwd, 'BASE_DIRS', [
    {
      kind: 'base-dirs-deprecated',
      message: 'BASE_DIRS is deprecated. Use RAG_INSTANCES instead.',
    },
  ])
}

// ============================================
// Legacy single-instance resolution (BASE_DIR)
// ============================================

async function resolveLegacyBaseDir(
  baseDirRaw: string,
  dbPathRaw: string | undefined,
  cwd: string
): Promise<InstanceConfigResult | { error: InstanceConfigError }> {
  return resolveSingleLegacy(baseDirRaw, dbPathRaw, cwd, 'BASE_DIR', [])
}

// ============================================
// Shared legacy helper
// ============================================

async function resolveSingleLegacy(
  baseDirRaw: string,
  dbPathRaw: string | undefined,
  cwd: string,
  flagName: string,
  preWarnings: InstanceConfigWarning[]
): Promise<InstanceConfigResult | { error: InstanceConfigError }> {
  const sensitiveError = checkSensitivePath(baseDirRaw, flagName)
  if (sensitiveError !== undefined) {
    return { error: new InstanceConfigError(sensitiveError) }
  }

  let resolvedBaseDir: string
  try {
    resolvedBaseDir = await realpath(resolve(baseDirRaw))
  } catch (cause) {
    return {
      error: new InstanceConfigError(`Failed to resolve base directory: ${baseDirRaw}`, cause),
    }
  }

  resolvedBaseDir = withTrailingSep(resolvedBaseDir)

  const name = basename(baseDirRaw) || baseDirRaw
  const instances: InstanceConfig[] = [
    {
      name,
      baseDir: resolvedBaseDir,
      dbPath: resolve(cwd, dbPathRaw ?? './db'),
      rawBaseDir: baseDirRaw,
    },
  ]

  return { instances, warnings: preWarnings }
}

// ============================================
// Warnings collection
// ============================================

function collectWarnings(instances: InstanceConfig[]): InstanceConfigWarning[] {
  const warnings: InstanceConfigWarning[] = []

  // Detect nested baseDirs
  for (let i = 0; i < instances.length; i++) {
    const parent = instances[i]
    if (parent === undefined) continue
    for (let j = 0; j < instances.length; j++) {
      if (i === j) continue
      const child = instances[j]
      if (child === undefined) continue
      if (child.baseDir.startsWith(parent.baseDir)) {
        warnings.push({
          kind: 'nested-base-dir',
          message: `Instance baseDir "${child.baseDir}" is nested inside instance "${parent.name}" baseDir.`,
        })
      }
    }
  }

  // Detect dbPath conflicts
  for (let i = 0; i < instances.length; i++) {
    const a = instances[i]
    if (a === undefined) continue
    for (let j = i + 1; j < instances.length; j++) {
      const b = instances[j]
      if (b === undefined) continue
      if (a.dbPath === b.dbPath) {
        warnings.push({
          kind: 'db-path-conflict',
          message: `Instances "${a.name}" and "${b.name}" share the same dbPath: ${a.dbPath}`,
        })
      }
    }
  }

  return warnings
}

// ============================================
// Internal helpers
// ============================================

function withTrailingSep(path: string): string {
  return path.endsWith(sep) ? path : path + sep
}
