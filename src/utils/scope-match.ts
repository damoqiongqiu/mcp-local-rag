// Boundary-safe, exact-or-descendant path prefix matcher shared by both BFS
// walkers and both list surfaces (MCP `list_files` and the `list` CLI).
//
// This is the JS counterpart of `vectordb`'s SQL `buildPrefixPredicate`
// (`src/vectordb/index.ts`): both implement the same exact-or-descendant
// contract (`path = prefix OR path startsWith prefix + separator`) with the
// same separator-boundary and trailing-separator normalization, so `/foo/bar`
// matches `/foo/bar` and `/foo/bar/x.md` but not `/foo/barista`. Both reference
// #146's boundary rules — a change to one must be mirrored in the other.

import { sep as PATH_SEP } from 'node:path'

// Derive the boundary separator from the prefix, mirroring `buildPrefixPredicate`:
// a `\`-style prefix uses `\`, a `/`-style prefix uses `/`, otherwise the
// platform separator. (Caveat inherited from the SQL side: on posix, `\` is a
// legal filename char, so a `/`-path containing `\` mis-derives the separator.)
function deriveSeparator(prefix: string): string {
  return prefix.includes('\\') ? '\\' : prefix.includes('/') ? '/' : PATH_SEP
}

// Strip trailing separators so `/a/b`, `/a/b/`, `/a/b//` normalize alike. A
// prefix of only separators (e.g. a lone posix root `/`) is kept as a single
// separator so its descendant boundary is `/<sep>` rather than empty.
function stripTrailingSeparators(prefix: string, separator: string): string {
  let end = prefix.length
  while (end > 0 && prefix[end - 1] === separator) {
    end--
  }
  if (end === 0) {
    return separator
  }
  return prefix.slice(0, end)
}

/**
 * True when `path` equals `prefix` or is a descendant of it, using a separator
 * boundary so `/foo/bar` does not match `/foo/barista`. The separator is derived
 * from `prefix`; trailing separators on `prefix` are normalized so `/a/b`,
 * `/a/b/`, and `/a/b//` are equivalent. `path` is compared verbatim, matching
 * the SQL contract in `buildPrefixPredicate`.
 */
export function isUnderOrEqual(path: string, prefix: string): boolean {
  const separator = deriveSeparator(prefix)
  const normalized = stripTrailingSeparators(prefix, separator)
  const descendant = normalized.endsWith(separator) ? normalized : normalized + separator
  return path === normalized || path.startsWith(descendant)
}

/**
 * True when `path` is under-or-equal any prefix in `prefixes` (union). Empty or
 * undefined `prefixes` semantics are the caller's concern; an empty list yields
 * false (membership against no prefixes).
 */
export function matchesAnyScope(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => isUnderOrEqual(path, prefix))
}

/**
 * Directory-visit predicate for the scoped BFS walk, shared by both walkers so
 * the boundary semantics live in one place. Visit `dir` when there is no scope,
 * when `dir` is in-scope (under-or-equal a prefix), or when `dir` is an ancestor
 * of some prefix (must be descended to reach the scoped subtree). An absent or
 * empty `scope` visits every directory (traversal unchanged).
 */
export function shouldVisitDir(dir: string, scope?: string[]): boolean {
  if (!scope || scope.length === 0) return true
  return matchesAnyScope(dir, scope) || scope.some((prefix) => isUnderOrEqual(prefix, dir))
}

/**
 * File-collect predicate for the scoped BFS walk, shared by both walkers.
 * Collect `path` when there is no scope, or when `path` is in-scope. An absent
 * or empty `scope` collects every supported file (collection unchanged).
 */
export function isInScope(path: string, scope?: string[]): boolean {
  return !scope || scope.length === 0 || matchesAnyScope(path, scope)
}
