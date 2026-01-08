# MediaSearch

A media transcription, indexing, and search platform designed for VAST Data infrastructure. MediaSearch ingests audio and video files, transcribes them using pluggable ASR engines, generates vector embeddings, and provides keyword, semantic, and hybrid search capabilities with sub-second latency.

## Problem Statement

Organizations with large media libraries need to make spoken content searchable. Traditional approaches require manual transcription or proprietary SaaS solutions that don't integrate with on-premises storage. MediaSearch provides an open, self-hosted solution that:

- Automatically transcribes media files as they're uploaded
- Supports multiple ASR engines (NVIDIA NIMs, Whisper, or bring-your-own)
- Enables precise search with timestamp-accurate results
- Scales horizontally for enterprise workloads
- Runs on VAST Data infrastructure in production, with local development support

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  S3 Bucket  │────▶│   Ingest    │────▶│ Orchestrator │────▶│ Search API  │
│  (Upload)   │     │   Service   │     │              │     │             │
└─────────────┘     └─────────────┘     └──────────────┘     └─────────────┘
                           │                    │
                           ▼                    ▼
                    ┌───────────┐        ┌───────────┐
                    │  Database │        │ ASR/Embed │
                    │           │        │  Engines  │
                    └───────────┘        └───────────┘
```

**Key Design Principles:**

- **VAST-first architecture**: Production uses VAST DataBase + DataEngine; local dev uses PostgreSQL + Redis + MinIO
- **Adapter pattern**: All infrastructure behind port interfaces with swappable implementations
- **Lifecycle management**: Versioned assets with atomic visibility transitions (STAGING → ACTIVE → ARCHIVED)
- **Idempotent operations**: Safe retries with exponential backoff and dead-letter queue

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed design documentation.

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker & Docker Compose

## Quick Start

```bash
# Clone repository
git clone https://github.com/ssotoa70/mediasearch.git
cd mediasearch

# Install dependencies
pnpm install

# Start local infrastructure (PostgreSQL, Redis, MinIO)
docker compose up -d

# Build all packages
pnpm build

# Run end-to-end demo
pnpm demo
```

The demo will:
1. Start all services
2. Upload a sample file
3. Process it through the pipeline
4. Execute search queries

### Manual Testing

```bash
# Upload a file to MinIO (localhost:9001, user: minioadmin)
# Or trigger ingestion manually:
curl -X POST http://localhost:3000/events/s3 \
  -H "Content-Type: application/json" \
  -d '{"event_type": "ObjectCreated", "bucket": "media", "object_key": "test.mp3"}'

# Search (after processing completes)
curl "http://localhost:3001/search?q=hello&type=keyword"
curl "http://localhost:3001/search?q=greeting&type=semantic"
```

## Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Description | Default |
|----------|-------------|---------|
| `BACKEND` | Infrastructure backend (`vast` or `local`) | `local` |
| `ASR_ENGINE` | ASR engine (`NVIDIA_NIMS`, `WHISPER`, `BYO`, `STUB`) | `STUB` |
| `EMBEDDING_MODEL` | Embedding model name | `stub` |
| `EMBEDDING_DIMENSION` | Vector dimension | `384` |
| `MEDIA_BUCKET` | S3 bucket for media files | `media` |
| `JOB_CONCURRENCY` | Parallel job processing | `4` |
| `MAX_RETRY_ATTEMPTS` | Retries before DLQ | `5` |

See `.env.example` for complete configuration options.

## Services

| Service | Port | Description |
|---------|------|-------------|
| Ingest | 3000 | S3 event handler, job creation |
| Search API | 3001 | Keyword, semantic, hybrid search |
| Triage | 3002 | DLQ management, quarantine handling |
| Orchestrator | 3003 | Job processing, ASR, embeddings |

## Project Structure

```
mediasearch/
├── packages/
│   ├── domain/              # Business logic, types, port interfaces
│   └── adapters/
│       ├── local-postgres/  # PostgreSQL adapter (dev)
│       ├── local-queue/     # Redis/BullMQ adapter (dev)
│       ├── local-s3/        # MinIO adapter (dev)
│       ├── vast-database/   # VAST DataBase adapter (prod)
│       └── vast-dataengine/ # VAST DataEngine adapter (prod)
├── services/
│   ├── ingest/              # S3 event ingestion
│   ├── orchestrator/        # Job processing pipeline
│   ├── search-api/          # Search endpoints
│   └── triage/              # DLQ management
├── db/migrations/           # Database schema
├── docker/                  # Dockerfiles
├── docs/                    # Documentation
└── scripts/                 # Utility scripts
```

## Documentation

- [Architecture Overview](docs/ARCHITECTURE.md)
- [Local Development](docs/LOCAL_DEV.md)
- [Deploy on VAST](docs/DEPLOY_ON_VAST.md)
- [API Reference](docs/API.md)

## Roadmap

- [ ] Real-time streaming transcription
- [ ] Multi-language support with auto-detection
- [ ] Speaker identification and clustering
- [ ] Transcript editing and correction UI
- [ ] Webhook notifications for processing events
- [ ] Prometheus metrics and Grafana dashboards
- [ ] Kubernetes Helm chart

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

Apache License 2.0 - see [LICENSE](LICENSE) for details.
