#!/usr/bin/env node

// Entry point for mcp-local-rag
// Routes to CLI subcommands or starts the MCP server
//
// Heavy imports (cli-main, server-main) are deferred via dynamic import()
// so that unknown-subcommand and server-with-flags paths do not eagerly
// load code-chunk, which tsx cannot resolve (its exports-field shape is
// incompatible with tsx's custom ESM loader). See entry-routing.test.ts.

import { parseGlobalOptions } from './cli/options.js'

// ============================================
// Routing helpers
// ============================================

/**
 * Known subcommand names — keep in sync with SUBCOMMANDS in cli-main.ts.
 * Inlined here to avoid eagerly importing cli-main.ts (which transitively
 * imports code-chunk via cli/ingest → chunker/code-chunker).
 */
const KNOWN_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'skills',
  'ingest',
  'list',
  'query',
  'status',
  'delete',
  'read-neighbors',
])

/** Replace control chars and truncate, so an unexpected argv value
 *  echoed to stderr cannot smuggle ANSI escapes or CR/LF into log lines. */
function sanitizeForEcho(s: string): string {
  return s.replace(/\p{Cc}/gu, '?').slice(0, 100)
}

// ============================================
// Routing
// ============================================

const { globalOptions, remainingArgs } = parseGlobalOptions(process.argv.slice(2))
const firstArg = remainingArgs[0]

if (firstArg !== undefined && KNOWN_SUBCOMMANDS.has(firstArg)) {
  // CLI subcommand — dynamic import defers code-chunk load until needed.
  const { handleCli } = await import('./cli-main.js')
  handleCli(
    firstArg as Parameters<typeof handleCli>[0],
    remainingArgs.slice(1),
    globalOptions
  ).catch((error) => {
    console.error(error)
    process.exit(1)
  })
} else if (remainingArgs.length === 0) {
  if (Object.keys(globalOptions).length > 0) {
    console.error('Global CLI options are not supported when launching the MCP server directly.')
    console.error(
      'Use environment variables like DB_PATH, CACHE_DIR, MODEL_NAME, BASE_DIR, BASE_DIRS, and MAX_FILE_SIZE instead.'
    )
    process.exit(1)
  }

  // Default: start MCP server (env-only, no CLI flags)
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason)
    process.exit(1)
  })

  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error)
    process.exit(1)
  })

  // Dynamic import defers code-chunk load until server mode is confirmed.
  const { startServer } = await import('./server-main.js')
  startServer()
} else {
  // Unknown command: never touched code-chunk — tsx-friendly path.
  console.error(`Unknown command: ${sanitizeForEcho(firstArg ?? '')}`)
  // Report known commands from the inlined set (in sync with cli-main.ts).
  console.error(`Available commands: ${[...KNOWN_SUBCOMMANDS].join(', ')}`)
  process.exit(1)
}
