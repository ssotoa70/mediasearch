# Local Development Deployment Guide

**Difficulty Level**: ⭐ Beginner
**Time to Complete**: 15-20 minutes
**Requirements**: Docker, Docker Compose, Node.js 20+, pnpm

This guide walks you through deploying MediaSearch on your local machine for development and testing.

---

## 🎯 What You'll Get

After following this guide, you'll have:
- ✅ PostgreSQL database with media schema
- ✅ MinIO S3-compatible object storage
- ✅ Redis queue system
- ✅ All 4 MediaSearch services running
- ✅ Sample media file for testing

---

## Step 1: Prerequisites Check

Before starting, verify you have these installed:

### macOS
```bash
# Check if Homebrew is installed
brew --version

# If not, install Homebrew:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Then install requirements
brew install node docker colima
brew install --cask docker
```

### Linux (Ubuntu/Debian)
```bash
# Install Docker
sudo apt-get update
sudo apt-get install -y docker.io docker-compose
sudo usermod -aG docker $USER

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
npm install -g pnpm
```

### Windows (with WSL2)
```bash
# Install Docker Desktop for Windows (includes Docker and Docker Compose)
# https://www.docker.com/products/docker-desktop

# In PowerShell as Administrator:
winget install OpenJS.NodeJS
npm install -g pnpm
```

**Verify installation**:
```bash
node --version          # Should be v20.0.0 or higher
pnpm --version          # Should be 9.0.0 or higher
docker --version        # Should show Docker version
docker-compose --version  # Should show Docker Compose version
```

---

## Step 2: Clone & Install

```bash
# 1. Clone the repository
git clone https://github.com/ssotoa70/mediasearch.git
cd mediasearch

# 2. Install dependencies
pnpm install

# This downloads all required Node packages (~500MB)
# Takes 2-5 minutes depending on internet speed
```

**What it does**:
- Downloads all code dependencies
- Sets up the monorepo workspace
- Prepares the build system

---

## Step 3: Start Local Infrastructure

```bash
# 1. Start Docker containers
docker-compose up -d

# 2. Verify all services started
docker-compose ps

# You should see:
# - PostgreSQL (port 5432)
# - MinIO (port 9000)
# - Redis (port 6379)
```

**What's running**:
- 🗄️ **PostgreSQL**: Stores media metadata, transcripts, embeddings
- 📦 **MinIO**: Simulates AWS S3 for local file storage
- 📋 **Redis**: In-memory queue for job processing

**Access MinIO UI** (optional):
```
Browser: http://localhost:9001
Username: minioadmin
Password: minioadmin
```

---

## Step 4: Configure Environment

```bash
# 1. Copy example configuration
cp .env.example .env

# 2. Verify the settings (defaults are fine for local dev)
cat .env | grep -E "^[A-Z_]+" | head -10
```

**Default configuration for local development**:
```
BACKEND=local              # Use local adapters (PostgreSQL, Redis, MinIO)
ASR_ENGINE=STUB           # Stub engine for testing (no real transcription)
EMBEDDING_MODEL=stub      # Stub embeddings
JOB_CONCURRENCY=4         # Process 4 jobs in parallel
MAX_RETRY_ATTEMPTS=5      # Retry failed jobs 5 times
```

---

## Step 5: Build All Services

```bash
# This compiles TypeScript and prepares everything
pnpm build

# Takes 2-3 minutes on first run
# Subsequent builds are faster (incremental)
```

**What it does**:
- Compiles TypeScript to JavaScript
- Bundles code for each service
- Creates optimized builds

---

## Step 6: Start All Services

**Option A: Start all services together** (recommended for beginners)
```bash
pnpm dev
```

**Option B: Start services individually** (if you need to debug specific service)
```bash
# Terminal 1: Ingest service
pnpm -r --filter "./services/ingest" dev

# Terminal 2: Orchestrator service
pnpm -r --filter "./services/orchestrator" dev

# Terminal 3: Search API service
pnpm -r --filter "./services/search-api" dev

# Terminal 4: Triage service
pnpm -r --filter "./services/triage" dev
```

**Wait for the logs**:
```
[ingest] Server running on http://localhost:3000
[search-api] Server running on http://localhost:3001
[triage] Server running on http://localhost:3002
[orchestrator] Started processing jobs
```

---

## Step 7: Test the System

### 7a. Upload a Test File

```bash
# Option 1: Use MinIO UI
# 1. Go to http://localhost:9001
# 2. Login (minioadmin / minioadmin)
# 3. Click "media" bucket
# 4. Click "Upload" and select any audio/video file

# Option 2: Use curl command
# Create a simple test file
echo "fake audio data" > /tmp/test.mp3

# Upload it
curl -X PUT http://localhost:9000/media/test.mp3 \
  -H "Authorization: AWS minioadmin:minioadmin" \
  -d @/tmp/test.mp3
```

### 7b: Trigger Ingest

```bash
# Tell MediaSearch about the new file
curl -X POST http://localhost:3000/events/s3 \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "ObjectCreated",
    "bucket": "media",
    "object_key": "test.mp3"
  }'

# You should see in console:
# [ingest] Processing file: test.mp3
# [orchestrator] Starting transcription job
```

### 7c: Run a Search Query

**Wait 5-10 seconds** for processing, then:

```bash
# Keyword search
curl "http://localhost:3001/search?q=test&type=keyword"

# Expected response:
# {
#   "results": [],
#   "took_ms": 42,
#   "visibility_filtered": 0
# }
```

**Results are empty because**:
- We used a stub ASR engine (didn't actually transcribe)
- This is normal! The system is working, just no real transcripts to search

---

## Step 8: Run the Automated Demo

```bash
# This runs a complete end-to-end workflow
pnpm demo

# The demo will:
# 1. Upload a sample media file
# 2. Process it through all services
# 3. Run search queries
# 4. Clean up
```

---

## 🎮 Development Workflows

### Modify Code & See Changes

```bash
# All services run in watch mode (auto-reload)
# 1. Edit code in packages/ or services/
# 2. Service automatically rebuilds
# 3. Refresh browser or re-run curl command
```

### Run Tests

```bash
# Unit tests (fast)
pnpm test:unit

# Integration tests (requires Docker running)
pnpm test:integration

# All tests
pnpm test
```

### Type Checking

```bash
# Verify TypeScript types are correct
pnpm typecheck

# Lint code style
pnpm lint
```

### View Database Schema

```bash
# Connect to PostgreSQL
psql -h localhost -U postgres -d mediasearch

# View tables
\dt

# View transcripts table
SELECT * FROM transcripts LIMIT 5;

# Exit
\q
```

### Access Redis

```bash
# Connect to Redis CLI
redis-cli -h localhost

# View all keys
KEYS *

# Check queue lengths
LLEN transcription_jobs
```

---

## 🛑 Stopping & Cleanup

### Stop Services (Keep Docker Containers)

```bash
# Stop all services
pnpm dev:stop

# Docker containers still running, restart with:
# pnpm dev
```

### Stop Everything

```bash
# Stop all services and containers
docker-compose down

# Restart with:
# docker-compose up -d
# pnpm dev
```

### Full Reset (Start Fresh)

```bash
# Stop and remove all containers + volumes
docker-compose down -v

# Remove node_modules (optional)
rm -rf node_modules pnpm-lock.yaml

# Start fresh
docker-compose up -d
pnpm install
pnpm build
pnpm dev
```

---

## 📊 Monitoring & Debugging

### View Service Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f postgres
docker-compose logs -f redis
docker-compose logs -f minio
```

### Monitor Performance

```bash
# View resource usage
docker stats

# Show which processes are using resources
top
```

### Health Checks

```bash
# Check if Ingest service is healthy
curl http://localhost:3000/health

# Check if Search API is healthy
curl http://localhost:3001/health

# Check if Orchestrator is healthy
curl http://localhost:3003/health
```

---

## ❓ Troubleshooting

### Issue: Docker containers won't start

```bash
# Solution 1: Check Docker is running
docker ps

# Solution 2: Increase Docker memory
# Docker Desktop → Preferences → Resources → Memory (set to 4GB minimum)

# Solution 3: Restart Docker
docker-compose down
docker system prune
docker-compose up -d
```

### Issue: Port already in use

```bash
# Find what's using the port
lsof -i :3000  # Check port 3000

# Kill the process
kill -9 <PID>

# Or use different ports
# Edit docker-compose.yml and change port mappings
```

### Issue: Services crash immediately

```bash
# Check logs
docker-compose logs <service-name>

# Most common: Database not ready
# Wait 10 seconds and restart:
docker-compose restart
```

### Issue: Node memory error

```bash
# Increase Node memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
pnpm dev
```

---

## 🎓 Next Steps

1. **Play with the Code**: Modify services and see changes live
2. **Write Tests**: Add test cases in `*.test.ts` files
3. **Explore Database**: Query PostgreSQL to understand data structures
4. **Try Different ASR Engines**: Change `ASR_ENGINE` in `.env` to `WHISPER`
5. **Read Architecture Docs**: See [docs/ARCHITECTURE.md](./ARCHITECTURE.md)

---

## 🆘 Getting Help

- **Documentation**: See [docs/](../docs/)
- **Issues**: Check [GitHub Issues](https://github.com/ssotoa70/mediasearch/issues)
- **Architecture Questions**: Read [ARCHITECTURE.md](./ARCHITECTURE.md)
- **API Reference**: See [API.md](./API.md)

---

## ✅ Checklist

After following this guide, you should be able to:

- [ ] All Docker containers running
- [ ] All Node services started
- [ ] Can access MinIO UI at localhost:9001
- [ ] Can run curl commands to search
- [ ] Can view logs for each service
- [ ] Can modify code and see changes
- [ ] Can run tests successfully
- [ ] Understand the basic workflow: Upload → Process → Search

**Congratulations! You now have a fully functional local development environment! 🎉**

---

*Last Updated: 2026-02-08*
*For production deployment, see [DEPLOY_PRODUCTION_VAST.md](./DEPLOY_PRODUCTION_VAST.md)*
