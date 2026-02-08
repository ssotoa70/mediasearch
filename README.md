# MediaSearch

[![CI](https://github.com/ssotoa70/mediasearch/actions/workflows/ci.yml/badge.svg)](https://github.com/ssotoa70/mediasearch/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![GitHub release](https://img.shields.io/github/v/release/ssotoa70/mediasearch)](https://github.com/ssotoa70/mediasearch/releases)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)

A media transcription, indexing, and search platform **built exclusively for VAST Data infrastructure**. MediaSearch ingests audio and video files, transcribes them using pluggable ASR engines, generates vector embeddings for semantic search, and provides keyword, semantic, and hybrid search capabilities with sub-second latency.

**Status**: ✅ **Feature Complete** - All 50 adapter methods for production VAST deployment are implemented and tested.

## Problem Statement

Organizations with large media libraries need to make spoken content searchable. Traditional approaches require manual transcription or proprietary SaaS solutions that don't integrate with on-premises storage. MediaSearch provides an open, self-hosted solution that:

- Automatically transcribes media files as they're uploaded
- Supports multiple ASR engines (NVIDIA NIMs, Whisper, or bring-your-own)
- Enables precise search with timestamp-accurate results
- Scales horizontally for enterprise workloads
- Runs on VAST Data infrastructure in production, with local development support

## Implementation Status

### VAST Adapters (Production)

| Component | Methods | Status | Features |
|-----------|---------|--------|----------|
| **VAST DataBase** | 30/30 | ✅ Complete | Asset management, versioning, transcript storage, 384-dim vector search, DLQ operations |
| **VAST DataEngine Queue** | 9/9 | ✅ Complete | Job enqueuing (immediate & delayed), consumption, acknowledgment, retry with backoff, DLQ integration |
| **VAST DataEngine S3** | 11/11 | ✅ Complete | Object operations, bucket management, presigned URLs, event notifications |
| **TOTAL** | **50/50** | ✅ **100% COMPLETE** | Ready for production deployment |

### Search Capabilities

- ✅ **Keyword Search**: LIKE-based full-text search on transcript segments
- ✅ **Semantic Search**: Vector similarity using cosine distance (384-dimensional embeddings)
- ✅ **Hybrid Search**: Combined keyword + semantic with configurable weights
- ✅ **Visibility Filtering**: All queries automatically filter ACTIVE results (prevents partial/staging data exposure)

### Architecture Features

- ✅ **Transaction Support**: Atomic operations for asset versioning and state transitions
- ✅ **Error Handling**: Dead-letter queue with automatic retry logic and triage classification
- ✅ **Python Sidecar**: Full SQL query support with complex filtering (WHERE, ORDER BY, LIMIT, array_cosine_distance)
- ✅ **Comprehensive Testing**: 100+ unit tests with mocks (no VAST cluster required)
- ✅ **Production Logging**: Detailed console logging for debugging and monitoring

## Architecture

MediaSearch is designed as a **VAST-native platform** that leverages VAST Data's unified infrastructure:

```
┌─────────────────┐     ┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  VAST S3 Bucket │────▶│   Ingest    │────▶│ Orchestrator │────▶│ Search API  │
│  (Media Upload) │     │   Service   │     │              │     │             │
└─────────────────┘     └─────────────┘     └──────────────┘     └─────────────┘
                               │                    │
                               ▼                    ▼
                    ┌────────────────┐      ┌───────────┐
                    │ VAST DataBase  │      │ ASR/Embed │
                    │ (Index+Vectors)│      │  Engines  │
                    └────────────────┘      └───────────┘
```

### Production Stack (VAST Data)

VAST Data provides a unified infrastructure that combines storage, compute, and database in a single system:

| Component | VAST Service | Implementation | Purpose |
|-----------|--------------|-----------------|---------|
| Object Storage | VAST S3-compatible buckets | `vast-dataengine/S3 adapter` (11 methods) | Media file storage with event notifications |
| Compute | VAST DataEngine | `vast-dataengine/Queue adapter` (9 methods) | Serverless job execution for transcription, embedding generation |
| Database | VAST DataBase | `vast-database adapter` (30 methods) | Relational tables + 384-dim vector embeddings with semantic search |
| Python Bridge | HTTP RPC Sidecar | `services/vast-db-sidecar/app.py` | Flask server bridging Node.js to VAST Python SDK for database operations |

### Local Development Stack

For development and testing, swappable adapters provide equivalent functionality:

| Production | Local Equivalent | Notes |
|------------|------------------|-------|
| VAST S3 | MinIO | S3-compatible object storage |
| VAST DataEngine | Direct Node.js | In-process execution |
| VAST DataBase | PostgreSQL + pgvector | Relational + vector search |

**Key Design Principles:**

- **VAST-first architecture**: Production uses VAST DataBase + DataEngine exclusively
- **Adapter pattern**: All infrastructure behind port interfaces with swappable implementations
- **Lifecycle management**: Versioned assets with atomic visibility transitions (STAGING → ACTIVE → ARCHIVED)
- **Idempotent operations**: Safe retries with exponential backoff and dead-letter queue

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed design documentation.

## Non-Goals

This project intentionally avoids certain architectural patterns:

- **No PostgreSQL in production**: VAST DataBase provides all relational and vector storage needs
- **No Redis/message queues**: VAST DataEngine handles job orchestration natively
- **No external object stores**: Media lives in VAST S3-compatible storage only
- **No cloud-specific services**: No AWS SQS, Azure Service Bus, or GCP Pub/Sub dependencies

The local development adapters (PostgreSQL, Redis, MinIO) exist solely for offline development and are **never deployed to production**. This constraint is enforced by CI guardrails.

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

### Near-term (API Stabilization)
- [ ] Finalize search API contract and response schema
- [ ] Add OpenAPI/Swagger documentation
- [ ] Comprehensive error codes and messages

### Mid-term (Relevance & Quality)
- [ ] Search relevance tuning (BM25 weights, vector similarity thresholds)
- [ ] Multi-language ASR support with auto-detection
- [ ] Speaker diarization improvements
- [ ] Confidence score calibration

### Long-term (Enterprise Features)
- [ ] Multi-tenant support with namespace isolation
- [ ] Webhook notifications for processing events
- [ ] Prometheus metrics and Grafana dashboards
- [ ] Transcript editing and correction UI

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

Apache License 2.0 - see [LICENSE](LICENSE) for details.
