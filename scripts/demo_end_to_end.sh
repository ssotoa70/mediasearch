#!/bin/bash
#
# MediaSearch End-to-End Demo Script
#
# This script demonstrates the full MediaSearch pipeline:
# 1. Start local infrastructure (PostgreSQL, Redis, MinIO)
# 2. Run database migrations
# 3. Start all services
# 4. Upload a sample media file
# 5. Wait for processing
# 6. Search for content
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "MediaSearch End-to-End Demo"
echo "========================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker is required but not installed"
        exit 1
    fi

    if ! command -v pnpm &> /dev/null; then
        log_error "pnpm is required but not installed"
        log_info "Install with: npm install -g pnpm"
        exit 1
    fi

    log_info "Prerequisites OK"
}

# Start infrastructure
start_infra() {
    log_info "Starting local infrastructure..."
    cd "$PROJECT_DIR"
    docker compose up -d

    log_info "Waiting for services to be ready..."
    sleep 5

    # Check PostgreSQL
    until docker compose exec -T postgres pg_isready -U mediasearch > /dev/null 2>&1; do
        log_info "Waiting for PostgreSQL..."
        sleep 2
    done

    # Check Redis
    until docker compose exec -T redis redis-cli ping > /dev/null 2>&1; do
        log_info "Waiting for Redis..."
        sleep 2
    done

    # Check MinIO
    until curl -sf http://localhost:9000/minio/health/live > /dev/null 2>&1; do
        log_info "Waiting for MinIO..."
        sleep 2
    done

    log_info "Infrastructure ready"
}

# Run migrations
run_migrations() {
    log_info "Running database migrations..."
    cd "$PROJECT_DIR"

    # Apply migrations using psql
    docker compose exec -T postgres psql -U mediasearch -d mediasearch \
        -f /docker-entrypoint-initdb.d/001_initial_schema.sql || true

    log_info "Migrations complete"
}

# Build packages
build_packages() {
    log_info "Building packages..."
    cd "$PROJECT_DIR"
    pnpm install
    pnpm build
    log_info "Build complete"
}

# Create sample media file
create_sample_file() {
    log_info "Creating sample media file..."

    SAMPLE_DIR="$PROJECT_DIR/tmp"
    mkdir -p "$SAMPLE_DIR"

    # Create a simple test audio file (silent WAV)
    # For a real demo, you would use an actual audio file
    SAMPLE_FILE="$SAMPLE_DIR/sample.wav"

    if [ ! -f "$SAMPLE_FILE" ]; then
        log_warn "Creating placeholder sample file"
        # Create a minimal valid WAV file (44 bytes header + some silence)
        printf 'RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00' > "$SAMPLE_FILE"
    fi

    echo "$SAMPLE_FILE"
}

# Upload to MinIO
upload_sample() {
    local sample_file="$1"
    log_info "Uploading sample file to MinIO..."

    # Create bucket if it doesn't exist
    docker compose exec -T minio mc alias set local http://localhost:9000 minioadmin minioadmin 2>/dev/null || true
    docker compose exec -T minio mc mb local/media 2>/dev/null || true

    # Upload file
    docker compose cp "$sample_file" minio:/tmp/sample.wav
    docker compose exec -T minio mc cp /tmp/sample.wav local/media/sample.wav

    log_info "Upload complete: media/sample.wav"
}

# Start services
start_services() {
    log_info "Starting MediaSearch services..."
    cd "$PROJECT_DIR"

    # Start services in background
    log_info "Starting Ingest service on port 3000..."
    BACKEND=local pnpm --filter @mediasearch/ingest start &
    INGEST_PID=$!

    log_info "Starting Orchestrator service on port 3003..."
    BACKEND=local pnpm --filter @mediasearch/orchestrator start &
    ORCH_PID=$!

    log_info "Starting Search API on port 3001..."
    BACKEND=local pnpm --filter @mediasearch/search-api start &
    SEARCH_PID=$!

    log_info "Starting Triage service on port 3002..."
    BACKEND=local pnpm --filter @mediasearch/triage start &
    TRIAGE_PID=$!

    # Wait for services to start
    sleep 5

    log_info "Services started"
    echo "  Ingest:       http://localhost:3000"
    echo "  Search API:   http://localhost:3001"
    echo "  Triage:       http://localhost:3002"
    echo "  Orchestrator: http://localhost:3003"
}

# Trigger ingestion
trigger_ingest() {
    log_info "Triggering ingestion..."

    curl -s -X POST http://localhost:3000/events/s3 \
        -H "Content-Type: application/json" \
        -d '{
            "event_type": "ObjectCreated",
            "bucket": "media",
            "object_key": "sample.wav"
        }' | jq . || echo "Ingestion triggered"

    log_info "Ingestion triggered"
}

# Wait for processing
wait_for_processing() {
    log_info "Waiting for processing to complete..."

    for i in {1..30}; do
        sleep 2
        log_info "Checking processing status... ($i/30)"

        # Check orchestrator stats
        STATS=$(curl -s http://localhost:3003/stats 2>/dev/null || echo "{}")
        SUCCEEDED=$(echo "$STATS" | jq -r '.jobsSucceeded // 0')

        if [ "$SUCCEEDED" -gt "0" ]; then
            log_info "Processing complete!"
            return 0
        fi
    done

    log_warn "Processing timeout - continuing anyway"
}

# Test search
test_search() {
    log_info "Testing search..."

    echo ""
    echo "Keyword search for 'mock':"
    curl -s "http://localhost:3001/search?q=mock&type=keyword" | jq .

    echo ""
    echo "Semantic search for 'test audio':"
    curl -s "http://localhost:3001/search?q=test%20audio&type=semantic" | jq .

    log_info "Search tests complete"
}

# Cleanup
cleanup() {
    log_info "Cleaning up..."

    # Kill background processes
    kill $INGEST_PID $ORCH_PID $SEARCH_PID $TRIAGE_PID 2>/dev/null || true

    log_info "To stop infrastructure: docker compose down"
}

# Main
main() {
    check_prerequisites

    echo ""
    log_info "Step 1: Start infrastructure"
    start_infra

    echo ""
    log_info "Step 2: Run migrations"
    run_migrations

    echo ""
    log_info "Step 3: Build packages"
    build_packages

    echo ""
    log_info "Step 4: Create and upload sample file"
    SAMPLE=$(create_sample_file)
    upload_sample "$SAMPLE"

    echo ""
    log_info "Step 5: Start services"
    start_services

    echo ""
    log_info "Step 6: Trigger ingestion"
    trigger_ingest

    echo ""
    log_info "Step 7: Wait for processing"
    wait_for_processing

    echo ""
    log_info "Step 8: Test search"
    test_search

    echo ""
    echo "========================================"
    log_info "Demo complete!"
    echo "========================================"
    echo ""
    echo "Services are still running. Press Ctrl+C to stop."
    echo ""
    echo "Try these commands:"
    echo "  curl http://localhost:3001/search?q=mock"
    echo "  curl http://localhost:3000/stats"
    echo "  curl http://localhost:3002/quarantined"
    echo ""

    # Wait for user interrupt
    trap cleanup EXIT
    wait
}

main "$@"
