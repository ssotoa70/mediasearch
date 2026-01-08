# MediaSearch Architecture

## Overview

MediaSearch is designed with a **VAST-first architecture**. Production deployments use VAST DataEngine and VAST DataBase, while local development uses PostgreSQL, Redis, and MinIO as emulators.

## Component Mapping

| Function | Production (VAST) | Local Development |
|----------|------------------|-------------------|
| Object Storage | VAST S3-compatible | MinIO |
| Database | VAST DataBase | PostgreSQL + pgvector |
| Job Queue | VAST DataEngine tables | Redis + BullMQ |
| Vector Search | VAST array_cosine_distance | pgvector cosine |
| Bucket Notifications | VAST native | MinIO polling |

## Adapter Pattern

All infrastructure is abstracted behind port interfaces:

```
┌─────────────────────────────────────────────────┐
│                Business Logic                    │
│     (Services: Ingest, Orchestrator, Search)     │
└─────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│                   Ports                          │
│  DatabasePort, QueuePort, StoragePort, ASRPort   │
└─────────────────────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
┌───────────────────┐       ┌───────────────────┐
│  VAST Adapters    │       │  Local Adapters   │
│  (Production)     │       │  (Development)    │
│                   │       │                   │
│  - VASTDatabase   │       │  - LocalPostgres  │
│  - VASTDataEngine │       │  - LocalQueue     │
│  - VASTS3         │       │  - LocalS3        │
└───────────────────┘       └───────────────────┘
```

## Services

### Ingest Service (port 3000)
- Receives S3 bucket notifications
- Validates media formats
- Creates asset records with STAGING visibility
- Enqueues transcription jobs

### Orchestrator Service (port 3003)
- Consumes transcription jobs from queue
- Calls ASR engine for transcription
- Applies segmentation (sentence-level or fixed-window)
- Generates embeddings
- Publishes version (atomic flip to ACTIVE)
- Handles retries with exponential backoff

### Search API (port 3001)
- Keyword search (full-text)
- Semantic search (vector similarity)
- Hybrid search (weighted combination)
- **CRITICAL**: Always filters visibility='ACTIVE'

### Triage Service (port 3002)
- Lists quarantined assets
- Allows retry/skip operations
- Manages DLQ items

## Data Flow

```
┌─────────┐     ┌─────────┐     ┌──────────────┐     ┌────────────┐
│ S3 Event│────▶│ Ingest  │────▶│ Orchestrator │────▶│ Search API │
│ (Upload)│     │ Service │     │              │     │            │
└─────────┘     └─────────┘     └──────────────┘     └────────────┘
                     │                  │
                     ▼                  ▼
              ┌───────────┐      ┌───────────┐
              │  Database │      │ ASR/Embed │
              │  (assets) │      │ Services  │
              └───────────┘      └───────────┘
```

## Lifecycle & Visibility

Per PRD requirements, all data follows this lifecycle:

1. **STAGING** - New transcripts during processing
2. **ACTIVE** - Published and searchable
3. **ARCHIVED** - Previous versions after update
4. **SOFT_DELETED** - Marked for deletion

Search **MUST** filter:
- `visibility = 'ACTIVE'`
- `version_id = asset.current_version_id`

## Error Handling

1. Retryable errors: exponential backoff (up to 5 attempts)
2. Non-retryable errors: immediate DLQ with triage_state
3. Triage states: NEEDS_MEDIA_FIX, NEEDS_ENGINE_TUNING, QUARANTINED
