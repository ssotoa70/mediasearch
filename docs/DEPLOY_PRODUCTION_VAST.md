# Production Deployment on VAST Data Infrastructure

**Difficulty Level**: ⭐⭐⭐ Advanced
**Time to Complete**: 1-2 hours setup + validation
**Requirements**: VAST Data cluster, Kubernetes (optional), Docker

This guide walks you through deploying MediaSearch to production on VAST Data infrastructure.

---

## 🎯 What You'll Get

After following this guide, you'll have:
- ✅ All services running on VAST Data
- ✅ S3 bucket notifications configured
- ✅ DataBase initialized with schema
- ✅ DataEngine functions registered
- ✅ Production-grade monitoring & logging

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Organization                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌──────────┐  ┌──────────┐              │
│  │   Ingest    │  │ Search   │  │ Triage   │              │
│  │   Service   │  │   API    │  │ Service  │              │
│  └──────┬──────┘  └─────┬────┘  └─────┬────┘              │
│         │                │             │                    │
│         └────────────────┼─────────────┘                    │
│                          │                                   │
│         ┌────────────────┴─────────────┐                    │
│         │                              │                    │
│         ▼                              ▼                    │
│  ┌────────────────────────────────────────┐               │
│  │    VAST Data Infrastructure            │               │
│  ├────────────────────────────────────────┤               │
│  │ ┌─────────────┐ ┌──────────────────┐  │               │
│  │ │ VAST S3     │ │  VAST DataBase   │  │               │
│  │ │ (Media)     │ │  (Metadata +     │  │               │
│  │ │             │ │   Vectors)       │  │               │
│  │ └─────────────┘ └──────────────────┘  │               │
│  │                                        │               │
│  │ ┌──────────────────────────────────┐  │               │
│  │ │  VAST DataEngine (Serverless)    │  │               │
│  │ │  (ASR, Embeddings, Processing)   │  │               │
│  │ └──────────────────────────────────┘  │               │
│  └────────────────────────────────────────┘               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

### Required Credentials & Information

Collect these BEFORE you start:

```
VAST Data Cluster:
├─ VAST_ENDPOINT: http://your-vast-cluster:port
├─ VAST_ACCESS_KEY_ID: your-access-key
├─ VAST_SECRET_ACCESS_KEY: your-secret-key
├─ VAST_REGION: us-east-1 (typical default)
└─ VAST_DATABASE_BUCKET: mediasearch-db (or your bucket)

Network Access:
├─ Cluster IP/hostname accessible from deployment location
├─ Port 8070 (VAST API) reachable
├─ Port 9090 (S3) reachable
└─ DNS resolution working

Infrastructure:
├─ Kubernetes cluster (optional but recommended)
├─ Container registry (Docker Hub, ECR, etc.)
├─ SSL certificates for HTTPS
└─ Monitoring/logging system (optional)
```

---

## Step 1: Prepare VAST Cluster

### 1a. Verify VAST Connectivity

```bash
# Test connection to VAST
curl -v http://your-vast-cluster:8070/api/v1/health

# Expected response: HTTP 200 with cluster health info
```

### 1b. Create S3 Bucket for Media

```bash
# Using AWS CLI with VAST endpoint:
aws s3 mb s3://mediasearch-media \
  --endpoint-url http://your-vast-cluster:9090 \
  --region us-east-1

# Verify bucket created
aws s3 ls \
  --endpoint-url http://your-vast-cluster:9090
```

### 1c. Create Database Bucket

```bash
# VAST DataBase uses separate bucket for metadata
aws s3 mb s3://mediasearch-db \
  --endpoint-url http://your-vast-cluster:9090 \
  --region us-east-1
```

### 1d. Initialize VAST Schema

```bash
# 1. Connect to cluster
ssh vast-admin@your-vast-cluster

# 2. Run schema creation
export VAST_ENDPOINT=http://localhost:8070
export VAST_ACCESS_KEY_ID=your-key
export VAST_SECRET_ACCESS_KEY=your-secret
export VAST_DATABASE_BUCKET=mediasearch-db

# 3. From MediaSearch repo, run schema initialization
python db/vast_schema.py

# You should see:
# Created table: media_assets
# Created table: asset_versions
# Created table: transcript_segments
# Created table: transcript_embeddings
# Created table: transcription_jobs
# Created table: dlq_items
```

---

## Step 2: Configure Deployment

### 2a. Create Production Configuration

```bash
# Create .env.production
cat > .env.production << 'EOF'
# Environment
NODE_ENV=production
BACKEND=vast

# VAST Cluster
VAST_ENDPOINT=http://your-vast-cluster:8070
VAST_S3_ENDPOINT=http://your-vast-cluster:9090
VAST_ACCESS_KEY_ID=your-access-key
VAST_SECRET_ACCESS_KEY=your-secret-key
VAST_REGION=us-east-1
VAST_DATABASE_BUCKET=mediasearch-db
VAST_DATABASE_SCHEMA=mediasearch

# Media Storage
MEDIA_BUCKET=mediasearch-media

# ASR & Embeddings
ASR_ENGINE=NVIDIA_NIMS        # or WHISPER, or BYO
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
EMBEDDING_DIMENSION=384

# Processing
JOB_CONCURRENCY=8
MAX_RETRY_ATTEMPTS=5
RETRY_BACKOFF_BASE_MS=1000

# Service Ports
INGEST_PORT=3000
SEARCH_PORT=3001
TRIAGE_PORT=3002
ORCHESTRATOR_PORT=3003
VAST_SIDECAR_PORT=5000

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Monitoring (optional)
PROMETHEUS_ENABLED=true
METRICS_PORT=9090
EOF

# Review the configuration
cat .env.production
```

### 2b. Set Environment Variables

```bash
# Load the production configuration
export $(cat .env.production | xargs)

# Verify critical variables
echo "Endpoint: $VAST_ENDPOINT"
echo "Access Key: $VAST_ACCESS_KEY_ID"
echo "Bucket: $VAST_DATABASE_BUCKET"
```

---

## Step 3: Build Container Images

### 3a. Build Service Images

```bash
# Build all service images
docker build -t mediasearch-ingest:0.9.0 \
  -f docker/Dockerfile.ingest .

docker build -t mediasearch-orchestrator:0.9.0 \
  -f docker/Dockerfile.orchestrator .

docker build -t mediasearch-search-api:0.9.0 \
  -f docker/Dockerfile.search-api .

docker build -t mediasearch-triage:0.9.0 \
  -f docker/Dockerfile.triage .
```

### 3b. Build Sidecar Image

```bash
# Build VAST sidecar
docker build -t mediasearch-vast-sidecar:0.9.0 \
  services/vast-db-sidecar/
```

### 3c. Push to Registry

```bash
# Login to your registry (Docker Hub example)
docker login

# Tag images
docker tag mediasearch-ingest:0.9.0 your-registry/mediasearch-ingest:0.9.0
docker tag mediasearch-orchestrator:0.9.0 your-registry/mediasearch-orchestrator:0.9.0
docker tag mediasearch-search-api:0.9.0 your-registry/mediasearch-search-api:0.9.0
docker tag mediasearch-triage:0.9.0 your-registry/mediasearch-triage:0.9.0
docker tag mediasearch-vast-sidecar:0.9.0 your-registry/mediasearch-vast-sidecar:0.9.0

# Push to registry
docker push your-registry/mediasearch-ingest:0.9.0
docker push your-registry/mediasearch-orchestrator:0.9.0
docker push your-registry/mediasearch-search-api:0.9.0
docker push your-registry/mediasearch-triage:0.9.0
docker push your-registry/mediasearch-vast-sidecar:0.9.0
```

---

## Step 4: Deploy Services

### Option A: Docker Compose (Simple)

```bash
# Create production compose file
cat > docker-compose.production.yml << 'EOF'
version: '3.9'

services:
  vast-sidecar:
    image: your-registry/mediasearch-vast-sidecar:0.9.0
    environment:
      VAST_ENDPOINT: ${VAST_ENDPOINT}
      VAST_ACCESS_KEY_ID: ${VAST_ACCESS_KEY_ID}
      VAST_SECRET_ACCESS_KEY: ${VAST_SECRET_ACCESS_KEY}
      VAST_DATABASE_BUCKET: ${VAST_DATABASE_BUCKET}
      VAST_DATABASE_SCHEMA: ${VAST_DATABASE_SCHEMA}
      VAST_SIDECAR_PORT: ${VAST_SIDECAR_PORT}
    ports:
      - "5000:5000"
    restart: unless-stopped
    networks:
      - mediasearch

  ingest:
    image: your-registry/mediasearch-ingest:0.9.0
    environment:
      BACKEND: vast
      VAST_ENDPOINT: ${VAST_ENDPOINT}
      VAST_ACCESS_KEY_ID: ${VAST_ACCESS_KEY_ID}
      VAST_SECRET_ACCESS_KEY: ${VAST_SECRET_ACCESS_KEY}
      VAST_SIDECAR_URL: http://vast-sidecar:5000
      MEDIA_BUCKET: ${MEDIA_BUCKET}
      PORT: 3000
    ports:
      - "3000:3000"
    depends_on:
      - vast-sidecar
    restart: unless-stopped
    networks:
      - mediasearch

  orchestrator:
    image: your-registry/mediasearch-orchestrator:0.9.0
    environment:
      BACKEND: vast
      VAST_ENDPOINT: ${VAST_ENDPOINT}
      VAST_ACCESS_KEY_ID: ${VAST_ACCESS_KEY_ID}
      VAST_SECRET_ACCESS_KEY: ${VAST_SECRET_ACCESS_KEY}
      VAST_SIDECAR_URL: http://vast-sidecar:5000
      ASR_ENGINE: ${ASR_ENGINE}
      JOB_CONCURRENCY: ${JOB_CONCURRENCY}
      PORT: 3003
    depends_on:
      - vast-sidecar
    restart: unless-stopped
    networks:
      - mediasearch

  search-api:
    image: your-registry/mediasearch-search-api:0.9.0
    environment:
      BACKEND: vast
      VAST_ENDPOINT: ${VAST_ENDPOINT}
      VAST_ACCESS_KEY_ID: ${VAST_ACCESS_KEY_ID}
      VAST_SECRET_ACCESS_KEY: ${VAST_SECRET_ACCESS_KEY}
      VAST_SIDECAR_URL: http://vast-sidecar:5000
      PORT: 3001
    ports:
      - "3001:3001"
    depends_on:
      - vast-sidecar
    restart: unless-stopped
    networks:
      - mediasearch

  triage:
    image: your-registry/mediasearch-triage:0.9.0
    environment:
      BACKEND: vast
      VAST_ENDPOINT: ${VAST_ENDPOINT}
      VAST_ACCESS_KEY_ID: ${VAST_ACCESS_KEY_ID}
      VAST_SECRET_ACCESS_KEY: ${VAST_SECRET_ACCESS_KEY}
      VAST_SIDECAR_URL: http://vast-sidecar:5000
      PORT: 3002
    ports:
      - "3002:3002"
    depends_on:
      - vast-sidecar
    restart: unless-stopped
    networks:
      - mediasearch

networks:
  mediasearch:
    driver: bridge
EOF

# Deploy
docker-compose -f docker-compose.production.yml up -d

# Verify all running
docker-compose -f docker-compose.production.yml ps
```

### Option B: Kubernetes (Recommended for Scale)

```bash
# Create namespace
kubectl create namespace mediasearch

# Create secrets
kubectl create secret generic vast-credentials \
  --from-literal=access_key_id=${VAST_ACCESS_KEY_ID} \
  --from-literal=secret_access_key=${VAST_SECRET_ACCESS_KEY} \
  -n mediasearch

# Deploy using Helm (example)
# Or apply individual Kubernetes manifests from k8s/ directory
kubectl apply -f k8s/vast-sidecar.yaml -n mediasearch
kubectl apply -f k8s/ingest.yaml -n mediasearch
kubectl apply -f k8s/orchestrator.yaml -n mediasearch
kubectl apply -f k8s/search-api.yaml -n mediasearch
kubectl apply -f k8s/triage.yaml -n mediasearch

# Verify deployment
kubectl get pods -n mediasearch
kubectl get svc -n mediasearch
```

---

## Step 5: Verify Deployment

### 5a. Health Checks

```bash
# Check each service is responding
curl http://your-deploy:3000/health   # Ingest
curl http://your-deploy:3001/health   # Search API
curl http://your-deploy:3002/health   # Triage
curl http://your-deploy:3003/health   # Orchestrator

# Expected response:
# {"status":"healthy","timestamp":"2026-02-08T..."}
```

### 5b. Test VAST Connection

```bash
# Verify database connection
curl -X POST http://your-deploy:3001/test/vast-connection \
  -H "Content-Type: application/json"

# Expected: {"status":"connected"}
```

### 5c. Run Validation Tests

```bash
# Full validation suite
# 1. Upload a test file
# 2. Verify it appears in VAST S3
# 3. Trigger processing
# 4. Verify job in database
# 5. Run search query
# 6. Verify result

curl -X POST http://your-deploy:3001/test/end-to-end \
  -H "Content-Type: application/json" \
  -d '{"test_file":"test.mp3"}'
```

---

## Step 6: Configure Monitoring

### 6a. Prometheus Metrics

```bash
# If PROMETHEUS_ENABLED=true, metrics available at:
curl http://your-deploy:9090/metrics

# Common metrics to monitor:
# - http_request_duration_seconds (API latency)
# - job_processing_duration_seconds (processing time)
# - dlq_items_total (dead-letter queue depth)
# - search_query_latency_ms (search response time)
```

### 6b. Logging Setup

```bash
# All services output JSON logs (if LOG_FORMAT=json)
# Aggregate with your logging system (ELK, Splunk, DataDog, etc.)

# Example: Send logs to ELK Stack
# docker-compose -f docker-compose.production.yml logs -f | \
#   filebeat -c filebeat.yml
```

### 6c. Alerting Rules

```yaml
# Example Prometheus alert rules
groups:
  - name: mediasearch
    rules:
      - alert: ServiceDown
        expr: up{job="mediasearch"} == 0
        for: 5m
        annotations:
          summary: "MediaSearch service {{ $labels.instance }} is down"

      - alert: HighDLQDepth
        expr: dlq_items_total > 100
        annotations:
          summary: "DLQ has {{ $value }} items, check for processing errors"

      - alert: SearchLatencyHigh
        expr: search_query_latency_ms > 5000
        annotations:
          summary: "Search queries taking > 5 seconds"
```

---

## Step 7: Production Operations

### 7a. Scaling

```bash
# Scale orchestrator for more throughput
kubectl scale deployment orchestrator --replicas=5 -n mediasearch

# Or with Docker Compose
docker-compose -f docker-compose.production.yml up -d --scale orchestrator=5
```

### 7b. Updates & Rollouts

```bash
# Rolling update to new version
kubectl set image deployment/ingest \
  ingest=your-registry/mediasearch-ingest:0.9.1 \
  -n mediasearch

# Verify rollout
kubectl rollout status deployment/ingest -n mediasearch

# Rollback if needed
kubectl rollout undo deployment/ingest -n mediasearch
```

### 7c: Backup Strategy

```bash
# Backup VAST DataBase
# Export schema and data regularly
python scripts/backup_vast_schema.py

# Archive to S3 or other storage
aws s3 sync ./backups s3://your-backup-bucket/mediasearch/
```

---

## Step 8: Security Hardening

### 8a. Network Security

```bash
# Restrict VAST access to known IPs
# Configure firewall rules:
# - Allow cluster → VAST cluster (port 8070, 9090)
# - Deny direct internet access to VAST

# Use TLS for all communication
# Enable SSL certificates in service configuration
```

### 8b. Credential Management

```bash
# NEVER commit credentials to git
# Use secure secrets management:

# Option 1: Kubernetes Secrets
kubectl create secret generic vast-creds \
  --from-literal=key=value -n mediasearch

# Option 2: HashiCorp Vault
# Configure sidecar to retrieve credentials from Vault

# Option 3: AWS Secrets Manager / Azure Key Vault
# Managed secrets service provided by cloud provider
```

### 8c. Access Control

```bash
# Use VAST's built-in access controls
# - Create IAM users with minimal permissions
# - Restrict API keys to specific operations
# - Enable audit logging

# Example: IAM policy for MediaSearch
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::mediasearch-media",
        "arn:aws:s3:::mediasearch-db"
      ]
    }
  ]
}
```

---

## 📊 Operational Runbook

### Daily Tasks

- [ ] Monitor service health dashboards
- [ ] Check DLQ depth (should be near 0)
- [ ] Review error logs for patterns
- [ ] Verify VAST cluster connectivity

### Weekly Tasks

- [ ] Backup database schema
- [ ] Review performance metrics
- [ ] Check certificate expiration dates
- [ ] Update dependency security patches

### Monthly Tasks

- [ ] Full system health audit
- [ ] Disaster recovery drill
- [ ] Capacity planning review
- [ ] Security audit

---

## 🆘 Troubleshooting

### Issue: Services can't connect to VAST

```bash
# 1. Verify VAST endpoint is accessible
ping your-vast-cluster
telnet your-vast-cluster 8070

# 2. Check credentials
echo $VAST_ACCESS_KEY_ID
echo $VAST_SECRET_ACCESS_KEY

# 3. Test direct connection
python -c "
import vastdb
session = vastdb.connect(
  endpoint='$VAST_ENDPOINT',
  access='$VAST_ACCESS_KEY_ID',
  secret='$VAST_SECRET_ACCESS_KEY'
)
print('Connection successful!')
"
```

### Issue: High DLQ Depth

```bash
# 1. Check what's failing
curl http://your-deploy:3002/dlq/items?limit=10

# 2. Review error messages
# Common causes:
# - ASR service unavailable
# - Unsupported media format
# - Insufficient permissions

# 3. Fix and retry jobs
curl -X POST http://your-deploy:3002/dlq/retry \
  -H "Content-Type: application/json" \
  -d '{"dlq_ids": ["dlq-1", "dlq-2"]}'
```

### Issue: Search Returning No Results

```bash
# 1. Verify data was indexed
# Check transcript count
curl http://your-deploy:3001/stats/transcripts

# 2. Check visibility filtering
# Ensure results are ACTIVE (not STAGING/ARCHIVED)
curl "http://your-deploy:3001/search?q=test&debug=true"

# 3. Verify embeddings generated
curl http://your-deploy:3001/stats/embeddings
```

---

## ✅ Deployment Checklist

After following this guide:

- [ ] VAST cluster is running and accessible
- [ ] S3 buckets created (media + database)
- [ ] Schema initialized in VAST DataBase
- [ ] Container images built and pushed
- [ ] Services deployed and responding
- [ ] All health checks passing
- [ ] Monitoring configured
- [ ] Backups scheduled
- [ ] Access controls implemented
- [ ] Team trained on operations

**Congratulations! You now have a production-grade deployment on VAST Data! 🎉**

---

## 📞 Support

- **VAST Support**: https://support.vastdata.com
- **Issues**: https://github.com/ssotoa70/mediasearch/issues
- **Documentation**: [docs/](.)

---

*Last Updated: 2026-02-08*
*For local development, see [DEPLOY_LOCAL_DEV.md](./DEPLOY_LOCAL_DEV.md)*
