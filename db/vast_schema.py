#!/usr/bin/env python3
"""
VAST DataBase Schema Definition for MediaSearch

This script creates the MediaSearch schema in VAST DataBase.
Run this during production deployment to initialize the database.

Equivalent to db/migrations/001_initial_schema.sql for local PostgreSQL.

Usage:
    export VAST_ENDPOINT=http://your-vast-cluster:port
    export VAST_ACCESS_KEY_ID=your-access-key
    export VAST_SECRET_ACCESS_KEY=your-secret-key
    export VAST_DATABASE_BUCKET=mediasearch-db
    python vast_schema.py
"""

import os
import pyarrow as pa
import vastdb

# Configuration from environment
ENDPOINT = os.environ.get('VAST_ENDPOINT', 'http://localhost:8070')
ACCESS_KEY = os.environ.get('VAST_ACCESS_KEY_ID', '')
SECRET_KEY = os.environ.get('VAST_SECRET_ACCESS_KEY', '')
BUCKET_NAME = os.environ.get('VAST_DATABASE_BUCKET', 'mediasearch-db')
SCHEMA_NAME = os.environ.get('VAST_DATABASE_SCHEMA', 'mediasearch')

# Vector dimension for embeddings (matches common sentence transformers)
EMBEDDING_DIMENSION = 384


def create_media_assets_table(schema):
    """
    Create media_assets table (PRD Section 9.1)
    Stores metadata about ingested media files
    """
    columns = pa.schema([
        ('asset_id', pa.string()),  # UUID as string
        ('lineage_id', pa.string()),
        ('bucket', pa.string()),
        ('object_key', pa.string()),
        ('current_version_id', pa.string()),
        ('status', pa.string()),  # ENUM stored as string
        ('triage_state', pa.string()),
        ('recommended_action', pa.string()),
        ('transcription_engine', pa.string()),
        ('last_error', pa.string()),
        ('attempt', pa.int32()),
        ('file_size', pa.int64()),
        ('content_type', pa.string()),
        ('etag', pa.string()),
        ('duration_ms', pa.int64()),
        ('codec_info', pa.string()),
        ('tombstone', pa.bool_()),
        ('ingest_time', pa.timestamp('us')),
        ('updated_at', pa.timestamp('us')),
    ])

    table = schema.create_table('media_assets', columns)
    print(f"Created table: media_assets")
    return table


def create_asset_versions_table(schema):
    """
    Create asset_versions table
    Tracks versions during overwrites (PRD Section 15)
    """
    columns = pa.schema([
        ('version_id', pa.string()),  # Primary key
        ('asset_id', pa.string()),
        ('status', pa.string()),
        ('publish_state', pa.string()),
        ('etag', pa.string()),
        ('file_size', pa.int64()),
        ('created_at', pa.timestamp('us')),
    ])

    table = schema.create_table('asset_versions', columns)
    print(f"Created table: asset_versions")
    return table


def create_transcript_segments_table(schema):
    """
    Create transcript_segments table (PRD Section 9.1)
    Stores transcribed text with timing for keyword search
    """
    columns = pa.schema([
        ('segment_id', pa.string()),  # UUID as string
        ('asset_id', pa.string()),
        ('version_id', pa.string()),
        ('start_ms', pa.int64()),
        ('end_ms', pa.int64()),
        ('text', pa.string()),
        ('speaker', pa.string()),
        ('confidence', pa.float32()),
        ('visibility', pa.string()),  # STAGING/ACTIVE/ARCHIVED/SOFT_DELETED
        ('chunking_strategy', pa.string()),
        ('created_at', pa.timestamp('us')),
    ])

    table = schema.create_table('transcript_segments', columns)
    print(f"Created table: transcript_segments")
    return table


def create_transcript_embeddings_table(schema):
    """
    Create transcript_embeddings table (PRD Section 9.1)
    Stores vector embeddings for semantic search
    Uses VAST Database vector type
    """
    # Vector type in VAST DB: list of floats with fixed dimension
    columns = pa.schema([
        ('embedding_id', pa.string()),
        ('asset_id', pa.string()),
        ('version_id', pa.string()),
        ('segment_id', pa.string()),
        # Vector embedding - VAST DB uses list of floats
        ('embedding', pa.list_(
            pa.field(name='item', type=pa.float32(), nullable=False),
            EMBEDDING_DIMENSION
        )),
        ('model', pa.string()),
        ('dimension', pa.int32()),
        ('visibility', pa.string()),
        ('created_at', pa.timestamp('us')),
    ])

    table = schema.create_table('transcript_embeddings', columns)
    print(f"Created table: transcript_embeddings")
    return table


def create_transcription_jobs_table(schema):
    """
    Create transcription_jobs table
    Queue implementation - can use VAST DataBase as job queue
    """
    columns = pa.schema([
        ('job_id', pa.string()),
        ('asset_id', pa.string()),
        ('version_id', pa.string()),
        ('engine_policy', pa.string()),  # JSON string
        ('attempt', pa.int32()),
        ('idempotency_key', pa.string()),
        ('status', pa.string()),
        ('enqueued_at', pa.timestamp('us')),
        ('scheduled_at', pa.timestamp('us')),
        ('started_at', pa.timestamp('us')),
        ('completed_at', pa.timestamp('us')),
        ('last_error', pa.string()),
    ])

    table = schema.create_table('transcription_jobs', columns)
    print(f"Created table: transcription_jobs")
    return table


def create_dlq_items_table(schema):
    """
    Create dlq_items table
    Dead letter queue for failed jobs (PRD Section 16)
    """
    columns = pa.schema([
        ('dlq_id', pa.string()),
        ('job_id', pa.string()),
        ('asset_id', pa.string()),
        ('version_id', pa.string()),
        ('error_code', pa.string()),
        ('error_message', pa.string()),
        ('error_retryable', pa.bool_()),
        ('job_data', pa.string()),  # JSON string
        ('logs', pa.list_(pa.string())),
        ('created_at', pa.timestamp('us')),
    ])

    table = schema.create_table('dlq_items', columns)
    print(f"Created table: dlq_items")
    return table


def main():
    """Create MediaSearch schema in VAST DataBase"""

    if not ACCESS_KEY or not SECRET_KEY:
        print("Error: VAST_ACCESS_KEY_ID and VAST_SECRET_ACCESS_KEY must be set")
        print("For local development, use PostgreSQL with db/migrations/001_initial_schema.sql")
        return 1

    print(f"Connecting to VAST DataBase at {ENDPOINT}")
    print(f"Bucket: {BUCKET_NAME}, Schema: {SCHEMA_NAME}")

    try:
        # Connect to VAST DataBase
        session = vastdb.connect(
            endpoint=ENDPOINT,
            access=ACCESS_KEY,
            secret=SECRET_KEY
        )

        with session.transaction() as tx:
            # Get or create bucket
            bucket = tx.bucket(BUCKET_NAME)

            # Create schema
            try:
                schema = bucket.create_schema(SCHEMA_NAME)
                print(f"Created schema: {SCHEMA_NAME}")
            except Exception as e:
                if "already exists" in str(e).lower():
                    schema = bucket.schema(SCHEMA_NAME)
                    print(f"Using existing schema: {SCHEMA_NAME}")
                else:
                    raise

            # Create tables
            create_media_assets_table(schema)
            create_asset_versions_table(schema)
            create_transcript_segments_table(schema)
            create_transcript_embeddings_table(schema)
            create_transcription_jobs_table(schema)
            create_dlq_items_table(schema)

        print("\nVAST DataBase schema created successfully!")
        print("\nNext steps:")
        print("1. Configure your services with BACKEND=vast")
        print("2. Set VAST_* environment variables")
        print("3. Deploy DataEngine functions")

        return 0

    except Exception as e:
        print(f"Error creating schema: {e}")
        return 1


if __name__ == '__main__':
    exit(main())
