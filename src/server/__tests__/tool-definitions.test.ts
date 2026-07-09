import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'
import { toolDefinitions } from '../tool-definitions.js'

const findTool = (name: string): Tool => {
  const tool = toolDefinitions.find((t) => t.name === name)
  if (!tool) throw new Error(`tool ${name} not found`)
  return tool
}

describe('list_files tool definition scope', () => {
  const listFiles = findTool('list_files')
  const scope = (listFiles.inputSchema.properties as Record<string, unknown>)?.scope as
    | Record<string, unknown>
    | undefined

  it('advertises an optional scope property', () => {
    expect(scope).toBeDefined()
    // scope is optional: list_files declares no required arguments (backward compatible)
    expect(listFiles.inputSchema.required).toBeUndefined()
  })

  it('uses the string | array<string> oneOf shape', () => {
    expect(scope?.oneOf).toEqual([{ type: 'string' }, { type: 'array', items: { type: 'string' } }])
  })

  it('describes scope on a reachable/scan-path basis, not the query stored-filePath phrasing', () => {
    const description = scope?.description as string
    expect(description).toMatch(/reachable/i)
    // MUST NOT copy the query_documents wording, which contradicts the scan-path basis
    expect(description).not.toMatch(/filePath equal to or under/)
  })

  it('keeps boundary-safe and absolute-path guidance', () => {
    const description = scope?.description as string
    expect(description).toContain('/docs/api')
    expect(description).toContain('/docs/apiv2')
    expect(description).toMatch(/absolute/i)
  })
})
