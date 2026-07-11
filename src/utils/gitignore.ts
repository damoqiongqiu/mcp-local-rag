// Gitignore support for list_files and ingest_directory scans.
// Reads .gitignore from project roots and creates filter functions
// that skip files/directories matching the patterns.

import { readFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import ignore from 'ignore'

/**
 * A gitignore filter that checks whether a given absolute file/directory path
 * should be skipped based on .gitignore rules (and our own SKIP_DIR_NAMES).
 */
export interface GitignoreFilter {
  /** Returns true when the path should be IGNORED (skipped) */
  ignores(absPath: string, isDir: boolean): boolean
}

/**
 * Create a no-op filter that never ignores anything.
 */
export function noopFilter(): GitignoreFilter {
  return { ignores: () => false }
}

/**
 * Walk up from a directory to find the nearest .gitignore file and parse it.
 * Returns a filter that checks paths relative to the gitignore's directory.
 *
 * @param rootDir - The root/base directory to start searching from
 * @returns A GitignoreFilter that respects .gitignore rules
 */
export async function loadGitignore(rootDir: string): Promise<GitignoreFilter> {
  const profiles: Array<{ ig: ReturnType<typeof ignore>; base: string }> = []

  // Walk up to find all .gitignore files (current → parent → ... → filesystem root)
  let current = rootDir
  const seen = new Set<string>()
  while (true) {
    if (seen.has(current)) break
    seen.add(current)

    const gitignorePath = join(current, '.gitignore')
    try {
      const content = await readFile(gitignorePath, 'utf-8')
      const ig = ignore().add(content)
      profiles.push({ ig, base: current })
    } catch {
      // .gitignore not found at this level — continue walking up
    }

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  if (profiles.length === 0) return noopFilter()

  return {
    ignores(absPath: string, isDir: boolean): boolean {
      for (const { ig, base } of profiles) {
        // Convert absolute path to relative path from the gitignore's directory
        if (!absPath.startsWith(base + sep) && absPath !== base) continue
        const relative = absPath === base ? '.' : absPath.slice(base.length + 1)
        // On macOS/Linux, always use forward slash for ignore patterns
        const normalized = relative.split(sep).join('/')
        // ignore() returns false for non-matching, true for matching, or
        // IgnoredPath object when matched. Check both truthy and the .ignored flag.
        const result = ig.ignores(normalized)
        if (result) return true
        // Directories: also check with trailing slash pattern
        if (isDir && !normalized.endsWith('/')) {
          if (ig.ignores(`${normalized}/`)) return true
        }
      }
      return false
    },
  }
}
