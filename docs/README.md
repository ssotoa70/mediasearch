# MediaSearch Documentation

MediaSearch is a media transcription, indexing, and search platform built on VAST Data infrastructure.

## Documentation

- [Architecture Overview](./ARCHITECTURE.md) - System design and component overview
- [Local Development](./LOCAL_DEV.md) - Running locally with Docker
- [Deploy on VAST](./DEPLOY_ON_VAST.md) - Production deployment guide
- [API Reference](./API.md) - REST API documentation

## Quick Links

| Topic | Description |
|-------|-------------|
| [Getting Started](#getting-started) | Run MediaSearch locally |
| [Configuration](#configuration) | Environment variables |
| [Search Types](#search-types) | Keyword, semantic, hybrid |

## Getting Started

```bash
# Install dependencies
pnpm install

# Start local infrastructure
docker compose up -d

# Build packages
pnpm build

# Run demo
pnpm demo
```

## Configuration

Key environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `BACKEND` | `vast` or `local` | `local` |
| `ASR_ENGINE` | `NVIDIA_NIMS`, `WHISPER`, `BYO`, `STUB` | `STUB` |
| `EMBEDDING_USE_STUB` | Use stub embeddings | `true` |

See `.env.example` for full configuration.

## Search Types

1. **Keyword Search** - Full-text search using PostgreSQL/VAST text matching
2. **Semantic Search** - Vector similarity using embeddings
3. **Hybrid Search** - Weighted combination of keyword and semantic
