// CLI status subcommand — show vector database status

import { createVectorStore, formatCliError } from './common.js'
import type { GlobalOptions } from './options.js'
import { resolveGlobalConfig } from './options.js'

// ============================================
// Help
// ============================================

const HELP_TEXT = `Usage: mcp-local-rag [global-options] status

Show vector database status (document count, chunk count, memory usage, etc.).

Options:
  -h, --help             Show this help

Global options (must appear before "status"):
  --db-path <path>       LanceDB database path
  --cache-dir <path>     Model cache directory
  --model-name <name>    Embedding model`

// ============================================
// Arg Parsing
// ============================================

/**
 * Parse status-specific CLI arguments.
 * Status accepts no options or positional args — only -h/--help.
 * Unknown flags or positional args cause an error.
 */
function parseArgs(args: string[]): { help: boolean } {
  let help = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '-h' || arg === '--help') {
      help = true
    } else if (arg === '--instance') {
      // Instance is handled in global options; just consume the value
      if (i + 1 >= args.length || (args[i + 1] ?? '').startsWith('-')) {
        console.error('Missing value for --instance')
        process.exit(1)
      }
      i++ // skip value
    } else if (arg.startsWith('-')) {
      console.error(`Unknown option: ${arg}`)
      console.error(HELP_TEXT)
      process.exit(1)
    } else {
      console.error(`Unexpected argument: ${arg}`)
      console.error(HELP_TEXT)
      process.exit(1)
    }
  }

  return { help }
}

// ============================================
// Main Entry Point
// ============================================

/**
 * Run the status CLI subcommand.
 * @param args - Arguments after "status" (should be empty or --help)
 * @param globalOptions - Global options parsed before the subcommand
 */
export async function runStatus(args: string[], globalOptions: GlobalOptions = {}): Promise<void> {
  // Parse CLI options
  const { help } = parseArgs(args)

  // Handle --help
  if (help) {
    console.error(HELP_TEXT)
    process.exit(0)
  }

  // Resolve global config
  const globalConfig = resolveGlobalConfig(globalOptions)

  try {
    // Create and initialize VectorStore (no Embedder needed for status)
    const vectorStore = createVectorStore(globalConfig)
    await vectorStore.initialize()

    // Get status
    const status = await vectorStore.getStatus()

    // Output JSON to stdout
    process.stdout.write(JSON.stringify(status))
  } catch (error) {
    const reason = formatCliError(error)
    console.error(`Error: ${reason}`)
    process.exit(1)
  }
}
