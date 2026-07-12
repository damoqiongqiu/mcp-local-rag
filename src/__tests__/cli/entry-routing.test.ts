// Smoke tests for the top-level CLI entry routing in src/index.ts.
// These spawn the entry as a real subprocess via tsx so we observe the
// actual exit codes and stderr surface that users see.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '../../..')
const ENTRY = resolve(PROJECT_ROOT, 'src/index.ts')
const DIST_ENTRY = resolve(PROJECT_ROOT, 'dist/index.js')

interface RunResult {
  status: number | null
  stderr: string
  stdout: string
}

function runCli(args: string[]): RunResult {
  const result = spawnSync(process.execPath, ['--import', 'tsx', ENTRY, ...args], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
    timeout: 15000,
  })
  return {
    status: result.status,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

/**
 * Run the compiled dist entry (no tsx). This path does not have the code-chunk
 * exports-field issue that tsx triggers, so it exercises the known-subcommand
 * routing branch that tsx-based tests cannot reach.
 */
function runCliDist(args: string[], env?: Record<string, string>): RunResult {
  const result = spawnSync(process.execPath, [DIST_ENTRY, ...args], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
    timeout: 15000,
    env: { ...process.env, ...env },
  })
  return {
    status: result.status,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

// ============================================
// KNOWN_SUBCOMMANDS / SUBCOMMANDS sync
// ============================================

describe('KNOWN_SUBCOMMANDS vs SUBCOMMANDS sync', () => {
  it('KNOWN_SUBCOMMANDS in src/index.ts matches SUBCOMMANDS in cli-main.ts', () => {
    const indexSrc = readFileSync(resolve(PROJECT_ROOT, 'src/index.ts'), 'utf-8')
    const cliMainSrc = readFileSync(resolve(PROJECT_ROOT, 'src/cli-main.ts'), 'utf-8')

    // Extract KNOWN_SUBCOMMANDS set content from src/index.ts
    const knownMatch = indexSrc.match(/KNOWN_SUBCOMMANDS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/)
    expect(knownMatch).toBeTruthy()
    const knownCommands = new Set(
      (knownMatch![1] ?? '')
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter(Boolean)
    )

    // Extract SUBCOMMANDS array from cli-main.ts
    const subMatch = cliMainSrc.match(/SUBCOMMANDS\s*=\s*\[([\s\S]*?)\]\s*as\s+const/)
    expect(subMatch).toBeTruthy()
    const subCommands = new Set(
      (subMatch![1] ?? '')
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter(Boolean)
    )

    // Both sets must be identical
    const onlyInKnown = [...knownCommands].filter((c) => !subCommands.has(c))
    const onlyInSub = [...subCommands].filter((c) => !knownCommands.has(c))

    if (onlyInKnown.length > 0) {
      expect.fail(
        `KNOWN_SUBCOMMANDS has extra entries not in SUBCOMMANDS: ${onlyInKnown.join(', ')}`
      )
    }
    if (onlyInSub.length > 0) {
      expect.fail(`SUBCOMMANDS has entries missing from KNOWN_SUBCOMMANDS: ${onlyInSub.join(', ')}`)
    }

    expect(knownCommands.size).toBe(subCommands.size)
  })
})

// ============================================
// CLI entry routing (tsx)
// ============================================

describe('CLI entry routing', () => {
  it('rejects global CLI flags on the bare server launch and points at env vars', () => {
    const { status, stderr } = runCli(['--db-path', '/tmp/should-not-apply'])

    expect(status).toBe(1)
    expect(stderr).toContain('Global CLI options are not supported')
    expect(stderr).toContain('DB_PATH')
    expect(stderr).toContain('MODEL_NAME')
  })

  it('errors on unknown subcommands and lists the available commands', () => {
    const { status, stderr } = runCli(['definitely-not-a-command'])

    expect(status).toBe(1)
    expect(stderr).toContain('Unknown command:')
    expect(stderr).toContain('skills')
    expect(stderr).toContain('ingest')
    expect(stderr).toContain('read-neighbors')
  })

  it('strips ANSI escape and control characters from the echoed unknown command', () => {
    const evil = '\u001b[31mboom\u001b[0m\r\n--inject'
    const { status, stderr } = runCli([evil])

    expect(status).toBe(1)
    expect(stderr).toContain('Unknown command:')
    // None of the control characters from the input should reach stderr verbatim.
    expect(stderr).not.toContain('\u001b[31m')
    expect(stderr).not.toContain('\u001b[0m')
  })

  it('does NOT treat known subcommands as unknown (tsx) — skills case', () => {
    // Even though code-chunk may fail under tsx, the routing in src/index.ts
    // must recognise known subcommands and NOT emit "Unknown command".
    const { stderr } = runCli(['skills', 'install', '--help'])

    expect(stderr).not.toContain('Unknown command')
  })

  it('does NOT treat known subcommands as unknown (tsx) — status case', () => {
    const { stderr } = runCli(['status', '--help'])

    expect(stderr).not.toContain('Unknown command')
  })
})

// ============================================
// CLI entry routing (compiled dist — exercises the full dynamic import path)
// ============================================

describe('CLI entry routing (compiled dist)', () => {
  const distReady = existsSync(DIST_ENTRY)

  it.runIf(distReady)('routes known subcommand (dist)', () => {
    // Use `status` — the lightest subcommand that only queries the DB.
    // With RAG_DB_PATH pointing to a non-existent dir, it should produce a
    // useful error message (not "Unknown command").
    const { status, stderr, stdout } = runCliDist(['status'], {
      RAG_DB_PATH: resolve(PROJECT_ROOT, '_tmp_nonexistent_db'),
    })

    // Routing must NOT emit "Unknown command" — the subcommand was recognised.
    expect(stderr).not.toContain('Unknown command')
    // status should either succeed or produce a DB-related error, never crash.
    expect([0, 1]).toContain(status)
  })

  it.runIf(distReady)('routes known ingest subcommand and shows help (dist)', () => {
    const { status, stderr, stdout } = runCliDist(['ingest', '--help'], {
      RAG_DB_PATH: resolve(PROJECT_ROOT, '_tmp_nonexistent_db'),
    })

    expect(stderr).not.toContain('Unknown command')
    // --help should exit 0 or 1 (not a crash)
    expect([0, 1]).toContain(status)
    // Should show usage info for ingest
    expect(stderr + stdout).toMatch(/ingest/i)
  })
})
