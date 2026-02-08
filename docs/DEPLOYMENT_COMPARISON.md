# Deployment Comparison: Local vs Production

Quick reference comparing local development and production VAST deployments.

---

## 📊 Quick Comparison Table

| Aspect | Local Development | Production VAST |
|--------|-------------------|-----------------|
| **Infrastructure** | Docker Compose | VAST Data Cluster |
| **Database** | PostgreSQL | VAST DataBase |
| **Object Storage** | MinIO (S3-compatible) | VAST S3 (native) |
| **Queue System** | Redis | VAST DataEngine |
| **Time to Deploy** | 15-20 minutes | 1-2 hours |
| **Cost** | ~$0 (your machine) | Depends on VAST license |
| **Scalability** | Single machine (4-8 cores) | Horizontal (cluster-wide) |
| **High Availability** | No | Yes (multi-node) |
| **Backup/Disaster Recovery** | Manual | Built-in |
| **Monitoring** | Console logs | Prometheus/ELK/Splunk |
| **Typical Use Case** | Development, testing | Production workloads |

---

## 🔄 Data Flow Comparison

### Local Development
```
Upload (MinIO UI)
    ↓
Ingest Service → PostgreSQL
    ↓
Orchestrator → ASR → Embeddings
    ↓
PostgreSQL (vectors, transcripts)
    ↓
Search API ← Query
```

### Production (VAST)
```
Upload (S3 CLI/API)
    ↓
Ingest Service → VAST DataBase
    ↓
Orchestrator (DataEngine) → ASR → Embeddings
    ↓
VAST DataBase (vectors, transcripts)
    ↓
Search API ← Query
```

---

## 🎯 When to Use Each

### Use Local Development When:
- ✅ Learning the system
- ✅ Writing code and tests
- ✅ Debugging issues
- ✅ No real media library to process
- ✅ Team has limited resources
- ✅ Need fast iteration

### Use Production (VAST) When:
- ✅ Processing real media files
- ✅ Supporting users/applications
- ✅ High volume (100s of files/day)
- ✅ Need fast search (sub-second)
- ✅ 24/7 availability required
- ✅ Compliance/security requirements

---

## 📋 Configuration Differences

### Local Development (.env)
```bash
BACKEND=local              # Use local adapters
ASR_ENGINE=STUB           # Fake transcription
EMBEDDING_MODEL=stub      # Fake embeddings
JOB_CONCURRENCY=4         # Limited parallelism
```

### Production VAST (.env.production)
```bash
BACKEND=vast              # Use VAST adapters
ASR_ENGINE=NVIDIA_NIMS    # Real ASR service
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
JOB_CONCURRENCY=8         # More parallelism
VAST_ENDPOINT=http://cluster:8070
VAST_DATABASE_BUCKET=mediasearch-db
```

---

## 🚀 Performance Comparison

| Operation | Local Dev | Production |
|-----------|-----------|------------|
| **Index 1 audio file** | ~30 seconds | ~5 seconds |
| **Search (keyword)** | ~100ms | ~50ms |
| **Search (semantic)** | ~500ms | ~200ms |
| **Concurrent jobs** | 4 | 8+ (configurable) |
| **Data durability** | None | Built-in redundancy |
| **Failover** | Manual restart | Automatic |

---

## 💾 Data Management

### Local Development
- Data stored in Docker volumes
- No automatic backups
- Data lost if Docker volume deleted
- Manual export required for sharing

### Production VAST
- Data stored in VAST DataBase
- Automatic snapshots/backups
- Replication across nodes
- Built-in disaster recovery

---

## 🔐 Security Comparison

| Aspect | Local Dev | Production |
|--------|-----------|------------|
| **Network Isolation** | None (localhost) | Private cluster |
| **Authentication** | Basic credentials | VAST IAM + TLS |
| **Encryption** | None | At-rest + in-transit |
| **Audit Logging** | Console only | Centralized audit trail |
| **Access Control** | Single user | Multi-tenant ready |
| **Compliance** | Not applicable | SOC2, HIPAA ready |

---

## 📈 Scaling Scenarios

### Local Development Limits
```
Machine Specs: 16GB RAM, 8 CPU cores
├─ PostgreSQL: 4GB
├─ Redis: 2GB
├─ Services: 4GB
├─ Docker overhead: 2GB
└─ Available: 4GB for concurrency

Typical: 4-8 concurrent jobs
Max files/day: ~100-200
```

### Production VAST Scale-out
```
VAST Cluster: 3-10+ nodes
├─ DataBase: Distributed (all nodes)
├─ DataEngine: Distributed (all nodes)
├─ S3: Distributed (all nodes)
└─ Auto-scaling based on load

Typical: 50+ concurrent jobs
Max files/day: 1000+
```

---

## 🔧 Development to Production Migration Path

```
1. Develop locally
   ├─ Use BACKEND=local
   ├─ Write tests with mocks
   └─ Validate business logic

2. Pre-production testing
   ├─ Deploy to staging VAST cluster
   ├─ Use BACKEND=vast
   ├─ Test with real data volumes
   └─ Performance tuning

3. Production rollout
   ├─ Deploy to production VAST cluster
   ├─ Monitor first 24 hours
   ├─ Gradual traffic increase
   └─ Celebrate! 🎉
```

---

## ✅ Pre-Migration Checklist

Before switching from local to production:

### Code Readiness
- [ ] All tests passing
- [ ] No hardcoded BACKEND=local references
- [ ] Environment variables properly configured
- [ ] Error handling for VAST-specific issues

### Infrastructure Readiness
- [ ] VAST cluster provisioned and tested
- [ ] Network connectivity verified
- [ ] Credentials securely stored
- [ ] Backups and DR plan documented

### Operational Readiness
- [ ] Monitoring dashboards set up
- [ ] Alert thresholds configured
- [ ] Runbook documentation complete
- [ ] Team trained on operations

### Data Readiness
- [ ] Test data loaded
- [ ] Schema validated
- [ ] Performance baselines established
- [ ] Capacity planning done

---

## 🆘 Troubleshooting

### Test Connecting to VAST from Local Machine

```bash
# If you want to test VAST connection before deploying
export BACKEND=vast
export VAST_ENDPOINT=http://vast-cluster:8070
export VAST_ACCESS_KEY_ID=your-key
export VAST_SECRET_ACCESS_KEY=your-secret

# Run connection test
npm run test -- --grep "VAST connection"
```

### Fall Back to Local if VAST Unreachable

```bash
# If production has issues, quickly revert to local
export BACKEND=local
docker-compose up -d  # Start local PostgreSQL/MinIO/Redis
npm run dev
```

---

## 📞 Getting Help

| Issue | Where to Get Help |
|-------|------------------|
| **Local Dev Setup** | See [DEPLOY_LOCAL_DEV.md](./DEPLOY_LOCAL_DEV.md) |
| **VAST Production** | See [DEPLOY_PRODUCTION_VAST.md](./DEPLOY_PRODUCTION_VAST.md) |
| **VAST-specific** | [VAST Support Portal](https://support.vastdata.com) |
| **General Issues** | [GitHub Issues](https://github.com/ssotoa70/mediasearch/issues) |

---

*Last Updated: 2026-02-08*
