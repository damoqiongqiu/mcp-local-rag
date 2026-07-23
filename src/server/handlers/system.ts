// System handlers — health_check

import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import type { Embedder } from '../../embedder/index.js'
import type { InstanceRouter } from '../../instances/router.js'
import type { RagContentBlock } from '../error-utils.js'

export interface HealthCheckDeps {
  instanceRouter: InstanceRouter
  embedder: Embedder
  dbPath: string
  cacheDir: string
  device?: string | undefined
  modelName: string
  dtype?: string | undefined
  configError: { message: string } | null
  rawBaseDirs: readonly string[]
}

export async function handleHealthCheck(
  deps: HealthCheckDeps
): Promise<{ content: RagContentBlock[] }> {
  const checks: Array<{
    name: string
    status: 'pass' | 'fail' | 'warn'
    message: string
  }> = []

  // 1. Config / BASE_DIRs
  listRoots: if (deps.configError !== null) {
    checks.push({
      name: 'config',
      status: 'fail',
      message: `Configuration error: ${deps.configError.message}`,
    })
  } else {
    for (const dir of deps.rawBaseDirs) {
      try {
        await access(dir, constants.R_OK)
      } catch {
        checks.push({
          name: 'config',
          status: 'fail',
          message: `BASE_DIR "${dir}" does not exist or is not readable.`,
        })
        break listRoots
      }
    }
    checks.push({
      name: 'config',
      status: 'pass',
      message:
        deps.rawBaseDirs.length === 1
          ? `BASE_DIR accessible: ${deps.rawBaseDirs[0]}`
          : `${deps.rawBaseDirs.length} BASE_DIRs accessible.`,
    })
  }

  // 2. Embedder
  try {
    const vec = await deps.embedder.embed('health_check probe')
    if (vec.length > 0) {
      checks.push({
        name: 'embedder',
        status: 'pass',
        message: `Model "${deps.modelName}" loaded on ${deps.device ?? 'cpu'} (dtype: ${deps.dtype ?? 'fp32'}, dim: ${vec.length}).`,
      })
    } else {
      checks.push({
        name: 'embedder',
        status: 'fail',
        message: 'Embedder returned an empty vector — model may be corrupted.',
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    checks.push({
      name: 'embedder',
      status: 'fail',
      message: `Embedder probe failed: ${msg}. Check your proxy settings (HTTPS_PROXY) or try HF_AUTO_MIRROR=true for CN mirrors.`,
    })
  }

  // 3. LanceDB
  try {
    const files = await deps.instanceRouter.listFiles()
    const totalChunks = files.reduce((sum, f) => sum + f.chunkCount, 0)
    const instanceCount = deps.instanceRouter.instanceNames.length
    checks.push({
      name: 'lancedb',
      status: 'pass',
      message: `${files.length} files indexed (${totalChunks} chunks) across ${instanceCount} instance(s).`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    checks.push({
      name: 'lancedb',
      status: 'fail',
      message: `LanceDB read failed: ${msg}. Check DB_PATH ("${deps.dbPath}") — is the directory accessible? Try running an ingest first.`,
    })
  }

  // 4. Cache directory
  try {
    await access(deps.cacheDir, constants.W_OK)
    checks.push({
      name: 'cache',
      status: 'pass',
      message: `Model cache directory writable: ${deps.cacheDir}`,
    })
  } catch {
    checks.push({
      name: 'cache',
      status: 'warn',
      message: `Cache directory "${deps.cacheDir}" is not writable — models cannot be downloaded. Create it or set CACHE_DIR to a writable path.`,
    })
  }

  // Build summary
  const failures = checks.filter((c) => c.status === 'fail')
  const warns = checks.filter((c) => c.status === 'warn')
  const allPass = failures.length === 0

  const lines: string[] = []
  lines.push(allPass ? '✅ Health Check: All checks passed.' : '⚠️ Health Check: Issues found.')
  lines.push('')
  for (const c of checks) {
    const icon = c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'
    lines.push(`  ${icon} ${c.name}: ${c.message}`)
  }
  lines.push('')

  const result: Record<string, unknown> = {
    healthy: allPass,
    checks: checks.map((c) => ({ name: c.name, status: c.status, message: c.message })),
    passCount: checks.length - failures.length - warns.length,
    failCount: failures.length,
    warnCount: warns.length,
    summary: lines.join('\n'),
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
}
