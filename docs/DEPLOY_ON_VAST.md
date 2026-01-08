# Deploy MediaSearch on VAST

This guide covers deploying MediaSearch to production using VAST Data infrastructure.

## Prerequisites

- VAST Cluster with DataEngine and DataBase enabled
- S3 credentials for VAST storage
- Kubernetes cluster (or container runtime) for services
- NVIDIA GPU nodes (optional, for accelerated ASR)

## Architecture Mapping

| Local Component | VAST Production Equivalent |
|-----------------|---------------------------|
| PostgreSQL + pgvector | VAST DataBase |
| Redis + BullMQ | VAST DataEngine (table-based queue) |
| MinIO | VAST S3-compatible storage |
| Polling notifications | VAST native bucket notifications |

## Configuration

Set these environment variables for production:

```bash
# Backend selection
BACKEND=vast

# VAST DataBase connection
VAST_ENDPOINT=http://your-vast-cluster:8070
VAST_ACCESS_KEY_ID=your-access-key
VAST_SECRET_ACCESS_KEY=your-secret-key
VAST_DATABASE_BUCKET=mediasearch-db
VAST_DATABASE_SCHEMA=mediasearch

# VAST S3 storage
VAST_S3_ENDPOINT=http://your-vast-cluster:80
VAST_REGION=us-east-1

# Media bucket
MEDIA_BUCKET=media

# ASR Engine (production)
ASR_ENGINE=NVIDIA_NIMS
NVIDIA_NIMS_ENDPOINT=http://your-nims-server:8000
NVIDIA_NIMS_API_KEY=your-api-key

# Embeddings (production)
EMBEDDING_USE_STUB=false
EMBEDDING_ENDPOINT=http://your-embedding-server:8080
EMBEDDING_MODEL=all-MiniLM-L6-v2
```

## Step 1: Create VAST DataBase Schema

Run the schema creation script on your VAST cluster:

```bash
# Using vastdb Python SDK
python db/vast_schema.py
```

This creates tables:
- `media_assets` - Asset metadata and lifecycle
- `asset_versions` - Version tracking
- `transcript_segments` - Transcribed text with timing
- `transcript_embeddings` - Vector embeddings
- `dlq` - Dead letter queue items
- `jobs` - Job tracking (replaces Redis queue)

## Step 2: Configure Bucket Notifications

In VAST Web UI or via API:

1. Create media bucket
2. Configure bucket notification for ObjectCreated/ObjectRemoved
3. Point notifications to Ingest service webhook

## Step 3: Deploy Services

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mediasearch-ingest
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: ingest
        image: mediasearch/ingest:latest
        env:
        - name: BACKEND
          value: "vast"
        - name: VAST_ENDPOINT
          valueFrom:
            secretKeyRef:
              name: vast-credentials
              key: endpoint
        # ... other env vars
        ports:
        - containerPort: 3000
```

### Service Scaling

| Service | Recommended Replicas | Notes |
|---------|---------------------|-------|
| Ingest | 2-3 | Stateless, scale for webhook load |
| Orchestrator | 2-4 | Scale for job processing |
| Search API | 2-4 | Scale for query load |
| Triage | 1 | Low traffic admin service |

## Step 4: VAST DataEngine Integration

VAST DataEngine can directly invoke processing functions:

```python
# Example DataEngine function registration
from vastdb import VastDBClient

def on_object_created(event):
    """DataEngine function triggered by S3 notification"""
    bucket = event['bucket']
    key = event['key']

    # Process directly or enqueue to jobs table
    # ...
```

## Step 5: Vector Search Optimization

VAST DataBase vector search functions:

```sql
-- Cosine similarity (recommended)
SELECT * FROM transcript_embeddings
WHERE visibility = 'ACTIVE'
ORDER BY array_cosine_distance(embedding, :query_vector)
LIMIT 10;

-- Euclidean distance
SELECT * FROM transcript_embeddings
WHERE visibility = 'ACTIVE'
ORDER BY array_distance(embedding, :query_vector)
LIMIT 10;
```

## Monitoring

### Health Endpoints

- `GET /health` - Liveness check
- `GET /ready` - Readiness check
- `GET /stats` - Service statistics

### Metrics to Monitor

- Job processing latency
- Queue depth
- DLQ item count
- Search latency (p50, p95, p99)
- ASR success rate

## Troubleshooting

### Common Issues

1. **Vector dimension mismatch**
   - Ensure EMBEDDING_DIMENSION matches your model
   - Default is 384 for MiniLM

2. **Bucket notification delays**
   - Check VAST notification configuration
   - Verify webhook endpoint is reachable

3. **ASR timeouts**
   - Increase JOB_TIMEOUT_MS for long media
   - Consider chunking for files > 5 minutes

4. **Search returns empty**
   - Verify visibility='ACTIVE' in queries
   - Check current_version_id is set
