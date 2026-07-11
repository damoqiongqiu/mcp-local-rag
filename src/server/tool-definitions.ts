// MCP tool schema definitions for RAGServer

import type { Tool } from '@modelcontextprotocol/sdk/types.js'

/**
 * All MCP tool definitions for the RAG server.
 * These are purely declarative schema objects that describe
 * what tools exist and their input parameters.
 */
export const toolDefinitions: Tool[] = [
  {
    name: 'query_documents',
    description:
      'Search ingested documents with hybrid keyword + semantic matching. Returns results sorted by relevance, each with filePath, chunkIndex, text, fileTitle, score (0 = best, higher = worse), and source (for ingest_data items).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search query. Preserve specific user terms (for keyword match); add context when the query is vague (for semantic match).',
        },
        limit: {
          type: 'number',
          minimum: 1,
          maximum: 20,
          description:
            'Max results (default 10, range 1-20). Lower favors precision, higher recall.',
        },
        scope: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description:
            'Optional absolute path prefix(es) — one string or a list (unioned) — restricting results to a filePath equal to or under a prefix. "/docs/api" matches "/docs/api/auth.md" but not "/docs/apiv2". Must be absolute (server OS style); a relative prefix matches nothing — derive one from a filePath returned by an earlier query, or omit scope.',
        },
        fromTimestamp: {
          type: 'string',
          description:
            'Optional ISO 8601 timestamp — only return chunks ingested on or after this time. Example: "2026-07-01T00:00:00Z".',
        },
        untilTimestamp: {
          type: 'string',
          description:
            'Optional ISO 8601 timestamp — only return chunks ingested on or before this time. Example: "2026-07-10T23:59:59Z".',
        },
        highlightContext: {
          type: 'number',
          minimum: 0,
          maximum: 500,
          description:
            'Characters of surrounding context around each query-term match in the returned chunks (default 0 = no highlight). When > 0, results include a "matchContext" array with highlighted snippets.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'ingest_file',
    description:
      'Ingest a document file (PDF, DOCX, TXT, MD) into the vector database. Path must be absolute; re-ingesting the same path replaces its existing data. Returns { filePath, chunkCount, timestamp, fileTitle }.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description:
            'Absolute path to the file to ingest. Example: "/Users/user/documents/manual.pdf"',
        },
        visual: {
          type: 'boolean',
          description: 'Run VLM captioning on figure pages (PDF only; default false).',
        },
        visualQuality: {
          type: 'string',
          enum: ['fast', 'quality'],
          default: 'fast',
          description:
            'VLM profile when visual is true (default "fast"). "quality" is more accurate on figures with in-image text but much heavier and slower. Ignored when visual is false.',
        },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'ingest_data',
    description:
      'Ingest in-memory content as a string (use ingest_file for files on disk). The source identifier enables re-ingestion to update existing content. Returns { filePath, chunkCount, timestamp, fileTitle }.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The content to ingest (text, HTML, or Markdown)',
        },
        metadata: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              description:
                'Source identifier. For web pages, use the URL (e.g., "https://example.com/page"). For other content, use URL-scheme format: "{type}://{date}" or "{type}://{date}/{detail}". Examples: "clipboard://2024-12-30", "chat://2024-12-30/project-discussion", "note://2024-12-30/meeting".',
            },
            format: {
              type: 'string',
              enum: ['text', 'html', 'markdown'],
              description:
                'Content format: text (plain/copied text), html (fetched web pages), or markdown.',
            },
          },
          required: ['source', 'format'],
        },
      },
      required: ['content', 'metadata'],
    },
  },
  {
    name: 'delete_file',
    description:
      'Delete a previously ingested file or data from the vector database. Use filePath for files ingested via ingest_file, or source for data ingested via ingest_data. Either filePath or source must be provided. Returns deleted (operation succeeded), removedChunks, and existed (whether anything was actually present).',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description:
            'Absolute path to the file (for ingest_file). Example: "/Users/user/documents/manual.pdf"',
        },
        source: {
          type: 'string',
          description:
            'Source identifier used in ingest_data. Examples: "https://example.com/page", "clipboard://2024-12-30"',
        },
      },
    },
  },
  {
    name: 'list_files',
    description:
      'List supported files (PDF, DOCX, TXT, MD) under the configured base directories and whether each is ingested. Returns { baseDirs, files, sources }; sources lists ingested items reported apart from the file scan, chiefly ingest_data content (web pages, clipboard, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description:
            'Optional absolute path prefix(es) — one string or a list (unioned) — restricting the listing to files reachable at a path equal to or under a prefix within the base directories. "/docs/api" matches "/docs/api/x.md" but not "/docs/apiv2". Must be absolute (server OS style); a relative prefix matches nothing. Scope filters files by their scan path; ingest_data sources, which have no base-directory path, are always listed.',
        },
      },
    },
  },
  {
    name: 'status',
    description:
      'Get index status: { documentCount, chunkCount, memoryUsage (MB), uptime (s), ftsIndexEnabled, searchMode }.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_chunk_neighbors',
    description:
      'Read the chunks immediately before and after a query_documents result, in the same document, for more surrounding context. Pass chunkIndex from the result plus exactly one of filePath (ingest_file) or source (ingest_data). Returns the target chunk (isTarget: true) and its neighbors, ascending by chunkIndex; an out-of-range chunkIndex returns []. Defaults: before=2, after=2 (max 50 each).',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description:
            'Absolute path to the file (for ingest_file documents). Provide exactly one of filePath or source. Example: "/Users/user/documents/manual.pdf".',
        },
        source: {
          type: 'string',
          description:
            'Source identifier (for ingest_data documents). Provide exactly one of filePath or source. Examples: "https://example.com/page", "clipboard://2024-12-30".',
        },
        chunkIndex: {
          type: 'number',
          description: 'Zero-based target chunk index (non-negative integer).',
        },
        before: {
          type: 'number',
          description: 'Number of chunks to retrieve before the target (0–50, default 2).',
        },
        after: {
          type: 'number',
          description: 'Number of chunks to retrieve after the target (0–50, default 2).',
        },
      },
      required: ['chunkIndex'],
    },
  },
  {
    name: 'ingest_directory',
    description:
      'Batch ingest all supported files in a directory. Recursively scans for code and document files under the given path, ingesting each one with AST-level (code) / semantic chunking. Returns per-file status plus totals. Use this for initial bulk ingestion or after deleting the database.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Absolute path to the directory to ingest. Must be within a configured base directory. Example: "/Users/user/project/src".',
        },
        extensionFilter: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional file extension filter (without leading dot). Example: ["ts", "tsx", "js"]. When omitted, all supported file types are ingested.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'reindex_stale',
    description:
      'Re-ingest all files whose disk contents have changed since the last ingestion (detected via mtime comparison). Returns the count of stale files that were re-ingested. Use when you know files have been modified but the index is out of date.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'reindex_all',
    description:
      'Re-ingest ALL indexed files from scratch. Delete existing chunks, then re-ingest every previously-indexed file. Use after changing the embedding model, chunker parameters, or when the index is corrupted. This is a slow, destructive operation — prefer reindex_stale for routine updates.',
    inputSchema: {
      type: 'object',
      properties: {
        optimizeAfter: {
          type: 'boolean',
          description:
            'Run optimize() after all files are re-ingested (default true). Set to false when calling reindex_all in a loop.',
        },
      },
    },
  },
  {
    name: 'config',
    description:
      'Read or update runtime configuration. Without arguments, returns current config (hybridWeight, maxDistance, maxFiles, grouping). With arguments, updates the specified keys and returns the new config. Changes take effect immediately — no restart required.',
    inputSchema: {
      type: 'object',
      properties: {
        hybridWeight: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Hybrid search weight (0.0 = vector only, 1.0 = BM25 only).',
        },
        maxDistance: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'Maximum vector distance threshold for quality filtering.',
        },
        maxFiles: {
          type: 'number',
          minimum: 1,
          description: 'Maximum number of distinct files to return in search results.',
        },
        grouping: {
          type: 'string',
          enum: ['similar', 'related'],
          description: 'Grouping mode: "similar" (single group) or "related" (two groups).',
        },
      },
    },
  },
  {
    name: 'export_index',
    description:
      'Export the current index to a JSON file for backup or migration. Returns the export file path and stats (document count, chunk count, file size). The exported file can be re-imported with a future import_index tool.',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: {
          type: 'string',
          description:
            'Absolute path for the export file. Defaults to "{dbPath}/export-{timestamp}.json".',
        },
      },
    },
  },
  {
    name: 'dedup_check',
    description:
      'Detect near-duplicate documents in the index by computing content hashes for every chunk. Returns file pairs with high chunk overlap, sorted by similarity. Use to identify accidentally duplicated or re-ingested content.',
    inputSchema: {
      type: 'object',
      properties: {
        threshold: {
          type: 'number',
          minimum: 0.5,
          maximum: 1.0,
          description:
            'Similarity threshold (0.5 = 50% chunk overlap, default 0.8). Only pairs above this threshold are reported.',
        },
      },
    },
  },
]
