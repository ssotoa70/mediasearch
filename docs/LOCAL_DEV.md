# Local Development Guide

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker & Docker Compose

## Quick Start

```bash
# Clone and install
cd mediasearch
pnpm install

# Start local infrastructure
docker compose up -d

# Build all packages
pnpm build

# Run end-to-end demo
pnpm demo
```

## Infrastructure

Docker Compose starts these services:

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL | 5432 | Database (emulates VAST DataBase) |
| Redis | 6379 | Job queue (emulates VAST DataEngine) |
| MinIO | 9000, 9001 | S3 storage (emulates VAST S3) |

## Development Workflow

### Start Infrastructure

```bash
docker compose up -d
```

### Watch Mode

```bash
# Start all services in watch mode
pnpm dev

# Or start individual services
pnpm --filter @mediasearch/ingest dev
pnpm --filter @mediasearch/orchestrator dev
pnpm --filter @mediasearch/search-api dev
```

### Run Tests

```bash
# All tests
pnpm test

# Unit tests only
pnpm test:unit

# Integration tests
pnpm test:integration
```

### Type Check

```bash
pnpm typecheck
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Key settings for local development:

```bash
BACKEND=local
ASR_ENGINE=stub
EMBEDDING_USE_STUB=true
```

## Testing with Real ASR

To test with actual ASR engines:

### Whisper (Local)

```bash
# Start Whisper server (requires Python environment)
pip install faster-whisper
python -m faster_whisper.server

# Configure
ASR_ENGINE=WHISPER
WHISPER_ENDPOINT=http://localhost:9000
```

### NVIDIA NIMs

```bash
ASR_ENGINE=NVIDIA_NIMS
NVIDIA_NIMS_ENDPOINT=http://your-nims-server:8000
NVIDIA_NIMS_API_KEY=your-key
```

## MinIO Console

Access MinIO web console at http://localhost:9001

- Username: `minioadmin`
- Password: `minioadmin`

Upload files to the `media` bucket to trigger processing.

## Database Access

```bash
# Connect to PostgreSQL
docker compose exec postgres psql -U mediasearch -d mediasearch

# View assets
SELECT * FROM media_assets;

# View segments
SELECT * FROM transcript_segments WHERE visibility = 'ACTIVE';
```

## Redis Access

```bash
# Connect to Redis
docker compose exec redis redis-cli

# View queue stats
KEYS *
```

## Troubleshooting

### Migrations Not Applied

```bash
# Manually run migrations
docker compose exec postgres psql -U mediasearch -d mediasearch \
  -f /docker-entrypoint-initdb.d/001_initial_schema.sql
```

### Service Not Starting

Check logs:
```bash
docker compose logs ingest
docker compose logs orchestrator
```

### Port Conflicts

Edit `docker-compose.yml` to change ports:
```yaml
ports:
  - "15432:5432"  # Alternative PostgreSQL port
```

## Project Structure

```
mediasearch/
├── packages/
│   ├── domain/           # Business logic, types, ports
│   └── adapters/
│       ├── local-postgres/   # PostgreSQL adapter
│       ├── local-queue/      # Redis/BullMQ adapter
│       ├── local-s3/         # MinIO adapter
│       ├── vast-database/    # VAST DataBase adapter
│       └── vast-dataengine/  # VAST DataEngine adapter
├── services/
│   ├── ingest/           # S3 event handler
│   ├── orchestrator/     # Job processor
│   ├── search-api/       # Search endpoints
│   ├── triage/           # DLQ management
│   └── asr-worker/       # ASR worker (optional)
├── db/
│   └── migrations/       # Database schema
├── docker/               # Dockerfiles
├── docs/                 # Documentation
└── scripts/              # Utility scripts
```
