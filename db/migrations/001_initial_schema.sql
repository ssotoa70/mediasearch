-- MediaSearch Initial Schema
-- This schema is for LOCAL DEVELOPMENT using PostgreSQL + pgvector
-- Production uses VAST DataBase with equivalent table structure

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Enum types matching domain enums
CREATE TYPE asset_status AS ENUM (
  'INGESTED',
  'TRANSCRIBING',
  'TRANSCRIBED',
  'INDEXED',
  'INDEX_PARTIAL',
  'DELETED',
  'QUARANTINED',
  'SKIPPED',
  'ERROR_RETRYABLE',
  'EMBEDDING_RETRYABLE',
  'BUILDING',
  'READY_TO_PUBLISH',
  'PUBLISHED',
  'ARCHIVED'
);

CREATE TYPE visibility AS ENUM (
  'STAGING',
  'ACTIVE',
  'ARCHIVED',
  'SOFT_DELETED'
);

CREATE TYPE triage_state AS ENUM (
  'NEEDS_MEDIA_FIX',
  'NEEDS_ENGINE_TUNING',
  'QUARANTINED'
);

CREATE TYPE asr_engine AS ENUM (
  'nvidia_nims',
  'whisper',
  'byo',
  'stub'
);

CREATE TYPE chunking_strategy AS ENUM (
  'sentence',
  'fixed_window'
);

-- =============================================================================
-- media_assets table (PRD Section 9.1)
-- Stores metadata about ingested media files
-- =============================================================================
CREATE TABLE media_assets (
  asset_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Tracks asset history across deletes/reuploads (PRD Section 18)
  lineage_id UUID NOT NULL DEFAULT uuid_generate_v4(),

  -- Source location
  bucket VARCHAR(255) NOT NULL,
  object_key VARCHAR(1024) NOT NULL,

  -- Version pointer - MUST be used in search filters (PRD Section 17)
  current_version_id VARCHAR(128),

  -- Processing state
  status asset_status NOT NULL DEFAULT 'INGESTED',
  triage_state triage_state,
  recommended_action TEXT,
  transcription_engine asr_engine NOT NULL DEFAULT 'nvidia_nims',
  last_error TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,

  -- File metadata
  file_size BIGINT NOT NULL,
  content_type VARCHAR(255) NOT NULL,
  etag VARCHAR(256) NOT NULL,
  duration_ms BIGINT,
  codec_info TEXT,

  -- Tombstone flag for soft deletes (PRD Section 18)
  tombstone BOOLEAN NOT NULL DEFAULT false,

  -- Timestamps
  ingest_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint on bucket + object_key for upsert
  CONSTRAINT unique_bucket_key UNIQUE (bucket, object_key)
);

-- Indexes for common queries
CREATE INDEX idx_media_assets_status ON media_assets(status);
CREATE INDEX idx_media_assets_bucket ON media_assets(bucket);
CREATE INDEX idx_media_assets_tombstone ON media_assets(tombstone) WHERE tombstone = false;
CREATE INDEX idx_media_assets_quarantined ON media_assets(triage_state) WHERE triage_state IS NOT NULL;

-- =============================================================================
-- asset_versions table
-- Tracks versions during overwrites (PRD Section 15)
-- =============================================================================
CREATE TABLE asset_versions (
  version_id VARCHAR(128) PRIMARY KEY,
  asset_id UUID NOT NULL REFERENCES media_assets(asset_id) ON DELETE CASCADE,

  -- Version state
  status asset_status NOT NULL DEFAULT 'BUILDING',
  publish_state visibility NOT NULL DEFAULT 'STAGING',

  -- File metadata for this version
  etag VARCHAR(256) NOT NULL,
  file_size BIGINT NOT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Index for finding versions by asset
  CONSTRAINT unique_asset_version UNIQUE (asset_id, version_id)
);

CREATE INDEX idx_asset_versions_asset ON asset_versions(asset_id);
CREATE INDEX idx_asset_versions_status ON asset_versions(status);

-- =============================================================================
-- transcript_segments table (PRD Section 9.1)
-- Stores transcribed text with timing for keyword search
-- =============================================================================
CREATE TABLE transcript_segments (
  segment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id UUID NOT NULL REFERENCES media_assets(asset_id) ON DELETE CASCADE,
  version_id VARCHAR(128) NOT NULL,

  -- Timing (PRD Section 11: results MUST return start_ms)
  start_ms BIGINT NOT NULL,
  end_ms BIGINT NOT NULL,

  -- Transcript content
  text TEXT NOT NULL,
  speaker VARCHAR(64),
  confidence REAL NOT NULL,

  -- Visibility state (PRD Section 9.1, 17)
  -- Search MUST filter visibility = 'ACTIVE'
  visibility visibility NOT NULL DEFAULT 'STAGING',

  -- Chunking strategy used
  chunking_strategy chunking_strategy NOT NULL DEFAULT 'sentence',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Idempotency: unique on (asset_id, version_id, segment_id)
  CONSTRAINT unique_segment UNIQUE (asset_id, version_id, segment_id)
);

-- Full-text search index for keyword search
CREATE INDEX idx_segments_text_search ON transcript_segments
  USING GIN (to_tsvector('english', text));

-- Indexes for filtering
CREATE INDEX idx_segments_asset_version ON transcript_segments(asset_id, version_id);
CREATE INDEX idx_segments_visibility ON transcript_segments(visibility);
CREATE INDEX idx_segments_active ON transcript_segments(asset_id, version_id)
  WHERE visibility = 'ACTIVE';

-- =============================================================================
-- transcript_embeddings table (PRD Section 9.1)
-- Stores vector embeddings for semantic search
-- Uses pgvector extension for vector operations
-- =============================================================================
CREATE TABLE transcript_embeddings (
  embedding_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id UUID NOT NULL REFERENCES media_assets(asset_id) ON DELETE CASCADE,
  version_id VARCHAR(128) NOT NULL,
  segment_id UUID NOT NULL,

  -- Vector embedding (pgvector type)
  -- Dimension 384 matches common sentence transformers
  embedding vector(384) NOT NULL,

  -- Embedding model used
  model VARCHAR(128) NOT NULL,
  dimension INTEGER NOT NULL,

  -- Visibility state (PRD Section 9.1, 17)
  -- Search MUST filter visibility = 'ACTIVE'
  visibility visibility NOT NULL DEFAULT 'STAGING',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Idempotency: unique on (asset_id, version_id, segment_id)
  CONSTRAINT unique_embedding UNIQUE (asset_id, version_id, segment_id)
);

-- Vector similarity search index (IVFFlat for performance)
CREATE INDEX idx_embeddings_vector ON transcript_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Indexes for filtering
CREATE INDEX idx_embeddings_asset_version ON transcript_embeddings(asset_id, version_id);
CREATE INDEX idx_embeddings_visibility ON transcript_embeddings(visibility);
CREATE INDEX idx_embeddings_active ON transcript_embeddings(asset_id, version_id)
  WHERE visibility = 'ACTIVE';

-- =============================================================================
-- transcription_jobs table
-- Queue implementation for local development
-- Production uses VAST DataEngine
-- =============================================================================
CREATE TABLE transcription_jobs (
  job_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id UUID NOT NULL REFERENCES media_assets(asset_id) ON DELETE CASCADE,
  version_id VARCHAR(128) NOT NULL,

  -- Engine policy (JSONB for flexibility)
  engine_policy JSONB NOT NULL,

  -- Retry tracking
  attempt INTEGER NOT NULL DEFAULT 0,
  idempotency_key VARCHAR(256) NOT NULL,

  -- Scheduling
  status VARCHAR(32) NOT NULL DEFAULT 'waiting',
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Error tracking
  last_error TEXT,

  CONSTRAINT unique_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX idx_jobs_status ON transcription_jobs(status);
CREATE INDEX idx_jobs_scheduled ON transcription_jobs(scheduled_at) WHERE status = 'waiting';

-- =============================================================================
-- dlq_items table
-- Dead letter queue for failed jobs (PRD Section 16)
-- =============================================================================
CREATE TABLE dlq_items (
  dlq_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID,
  asset_id UUID NOT NULL,
  version_id VARCHAR(128) NOT NULL,

  -- Error details
  error_code VARCHAR(64) NOT NULL,
  error_message TEXT NOT NULL,
  error_retryable BOOLEAN NOT NULL,

  -- Original job data
  job_data JSONB NOT NULL,

  -- Processing logs
  logs TEXT[],

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dlq_asset ON dlq_items(asset_id);
CREATE INDEX idx_dlq_created ON dlq_items(created_at);

-- =============================================================================
-- Update trigger for updated_at
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_media_assets_updated
  BEFORE UPDATE ON media_assets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- Search function for keyword search
-- Enforces visibility and current_version_id filters (PRD Section 17)
-- =============================================================================
CREATE OR REPLACE FUNCTION search_keyword(
  query_text TEXT,
  result_limit INTEGER DEFAULT 20,
  result_offset INTEGER DEFAULT 0,
  bucket_filter VARCHAR DEFAULT NULL,
  speaker_filter VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  asset_id UUID,
  start_ms BIGINT,
  end_ms BIGINT,
  snippet TEXT,
  score REAL,
  speaker VARCHAR,
  bucket VARCHAR,
  object_key VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.asset_id,
    s.start_ms,
    s.end_ms,
    ts_headline('english', s.text, plainto_tsquery('english', query_text)) as snippet,
    ts_rank(to_tsvector('english', s.text), plainto_tsquery('english', query_text)) as score,
    s.speaker,
    a.bucket,
    a.object_key
  FROM transcript_segments s
  JOIN media_assets a ON s.asset_id = a.asset_id
  WHERE
    -- MUST filter visibility = 'ACTIVE' (PRD Section 17)
    s.visibility = 'ACTIVE'
    -- MUST filter by current_version_id (PRD Section 17)
    AND s.version_id = a.current_version_id
    -- Asset must not be deleted
    AND a.tombstone = false
    -- Full-text search
    AND to_tsvector('english', s.text) @@ plainto_tsquery('english', query_text)
    -- Optional filters
    AND (bucket_filter IS NULL OR a.bucket = bucket_filter)
    AND (speaker_filter IS NULL OR s.speaker = speaker_filter)
  ORDER BY score DESC
  LIMIT result_limit
  OFFSET result_offset;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Search function for semantic (vector) search
-- Enforces visibility and current_version_id filters (PRD Section 17)
-- =============================================================================
CREATE OR REPLACE FUNCTION search_semantic(
  query_embedding vector(384),
  result_limit INTEGER DEFAULT 20,
  result_offset INTEGER DEFAULT 0,
  bucket_filter VARCHAR DEFAULT NULL,
  speaker_filter VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  asset_id UUID,
  start_ms BIGINT,
  end_ms BIGINT,
  snippet TEXT,
  score REAL,
  speaker VARCHAR,
  bucket VARCHAR,
  object_key VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.asset_id,
    s.start_ms,
    s.end_ms,
    s.text as snippet,
    (1 - (e.embedding <=> query_embedding))::REAL as score,
    s.speaker,
    a.bucket,
    a.object_key
  FROM transcript_embeddings e
  JOIN transcript_segments s ON
    e.asset_id = s.asset_id
    AND e.version_id = s.version_id
    AND e.segment_id = s.segment_id
  JOIN media_assets a ON e.asset_id = a.asset_id
  WHERE
    -- MUST filter visibility = 'ACTIVE' (PRD Section 17)
    e.visibility = 'ACTIVE'
    AND s.visibility = 'ACTIVE'
    -- MUST filter by current_version_id (PRD Section 17)
    AND e.version_id = a.current_version_id
    -- Asset must not be deleted
    AND a.tombstone = false
    -- Optional filters
    AND (bucket_filter IS NULL OR a.bucket = bucket_filter)
    AND (speaker_filter IS NULL OR s.speaker = speaker_filter)
  ORDER BY e.embedding <=> query_embedding
  LIMIT result_limit
  OFFSET result_offset;
END;
$$ LANGUAGE plpgsql;
