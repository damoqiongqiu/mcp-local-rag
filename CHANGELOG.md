# Changelog

## [0.17.0] — 2026-07-11

### Added

- `ingest_directory` MCP tool: batch ingest all supported files in a directory with extension filtering
- `reindex_stale` MCP tool: re-ingest files whose disk mtime is newer than their ingestion timestamp
- `list_files` stale detection: ingested files with newer disk mtime are flagged with `stale: true`
- `ingestFileCore` internal helper: parse→chunk→embed→insert pipeline without per-file backup/optimize

## [0.16.4] — 2026-07-11

### Docs

- README: add `HTTPS_PROXY` / `HTTP_PROXY` / `HF_ENDPOINT` to configuration table
- README: expand `CACHE_DIR` description with directory structure and path advice
- README: add step-by-step model download troubleshooting (proxy → path → mirror → npx cache)
- README: add "Rebuilding the Index" guide with CLI batch ingestion example

## [0.16.3] — 2026-07-11

### Added

- Proxy-aware fetch via `undici.ProxyAgent` for `HTTPS_PROXY` / `HTTP_PROXY`
- Custom fetch injected into `@huggingface/transformers` `env.fetch`

## [0.16.2] — 2026-07-11

### Added

- `HF_ENDPOINT` env var support for custom HuggingFace mirrors
- `remoteHost` config in Embedder

### Fixed

- Embedding model download blocked behind proxy (partial fix; completed in 0.16.3)
