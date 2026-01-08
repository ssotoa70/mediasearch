import {
  AssetStatus,
  Visibility,
  TriageState,
  ASREngine,
  ChunkingStrategy,
  S3EventType,
} from './enums.js';

/**
 * Media asset entity as defined in PRD Section 9.1
 * Represents a media file (audio/video) in the system
 */
export interface MediaAsset {
  /** Stable unique identifier for the asset */
  asset_id: string;

  /** Tracks asset history across deletes/reuploads for audit */
  lineage_id: string;

  /** Source S3-compatible bucket */
  bucket: string;

  /** Object path/key in bucket */
  object_key: string;

  /** Pointer to the currently active version - MUST be used in search filters */
  current_version_id: string | null;

  /** Processing status */
  status: AssetStatus;

  /** Triage state when quarantined */
  triage_state: TriageState | null;

  /** Recommended action for triage */
  recommended_action: string | null;

  /** Selected transcription engine */
  transcription_engine: ASREngine;

  /** Last error message */
  last_error: string | null;

  /** Current retry attempt count */
  attempt: number;

  /** Timestamp when asset was ingested */
  ingest_time: Date;

  /** Timestamp of last update */
  updated_at: Date;

  /** File size in bytes */
  file_size: number;

  /** Content type (MIME) */
  content_type: string;

  /** ETag/hash for deduplication */
  etag: string;

  /** Whether this is a tombstone record (deleted asset) */
  tombstone: boolean;

  /** Codec information for debugging */
  codec_info: string | null;

  /** Duration in milliseconds */
  duration_ms: number | null;
}

/**
 * Asset version entity - tracks versions during overwrites
 */
export interface AssetVersion {
  /** Version identifier (computed from etag + size + mtime) */
  version_id: string;

  /** Parent asset */
  asset_id: string;

  /** Version status */
  status: AssetStatus;

  /** Publish state for visibility control */
  publish_state: Visibility;

  /** Timestamp when version was created */
  created_at: Date;

  /** ETag/hash */
  etag: string;

  /** File size */
  file_size: number;
}

/**
 * Transcript segment entity as defined in PRD Section 9.1
 * Represents a chunk of transcribed text with timing
 */
export interface TranscriptSegment {
  /** Unique segment identifier */
  segment_id: string;

  /** Parent asset */
  asset_id: string;

  /** Asset version this segment belongs to */
  version_id: string;

  /** Segment start time in milliseconds */
  start_ms: number;

  /** Segment end time in milliseconds */
  end_ms: number;

  /** Transcribed text */
  text: string;

  /** Speaker label from diarization */
  speaker: string | null;

  /** ASR confidence score 0-1 */
  confidence: number;

  /** Visibility state - MUST be ACTIVE to appear in search */
  visibility: Visibility;

  /** Chunking strategy used */
  chunking_strategy: ChunkingStrategy;

  /** Timestamp when segment was created */
  created_at: Date;
}

/**
 * Transcript embedding entity as defined in PRD Section 9.1
 * Stores vector embeddings for semantic search
 */
export interface TranscriptEmbedding {
  /** Unique embedding identifier */
  embedding_id: string;

  /** Parent asset */
  asset_id: string;

  /** Asset version */
  version_id: string;

  /** Corresponding segment */
  segment_id: string;

  /** Vector embedding (array of floats) */
  embedding: number[];

  /** Embedding model used */
  model: string;

  /** Vector dimension */
  dimension: number;

  /** Visibility state - MUST be ACTIVE to appear in search */
  visibility: Visibility;

  /** Timestamp when embedding was created */
  created_at: Date;
}

/**
 * Transcription job for the queue
 */
export interface TranscriptionJob {
  /** Unique job identifier */
  job_id: string;

  /** Target asset */
  asset_id: string;

  /** Target version */
  version_id: string;

  /** Engine policy for this job */
  engine_policy: EnginePolicy;

  /** Current attempt number */
  attempt: number;

  /** Idempotency key to prevent duplicate processing */
  idempotency_key: string;

  /** Timestamp when job was enqueued */
  enqueued_at: Date;

  /** Scheduled execution time (for backoff) */
  scheduled_at: Date;
}

/**
 * Engine policy configuration
 */
export interface EnginePolicy {
  /** Preferred ASR engine */
  engine: ASREngine;

  /** Enable speaker diarization (default: true as per PRD) */
  diarization_enabled: boolean;

  /** Preferred execution mode */
  execution_mode: ExecutionMode;

  /** Compute threshold for chunking fallback (seconds) */
  compute_threshold_seconds: number;

  /** Force specific chunking strategy */
  force_chunking_strategy: ChunkingStrategy | null;
}

/**
 * Default engine policy per PRD requirements
 */
export const DEFAULT_ENGINE_POLICY: EnginePolicy = {
  engine: ASREngine.NVIDIA_NIMS,
  diarization_enabled: true, // PRD: "enabled by default"
  execution_mode: ExecutionMode.GPU,
  compute_threshold_seconds: 300, // 5 minutes threshold for chunking fallback
  force_chunking_strategy: null,
};

/**
 * S3 bucket notification event
 */
export interface S3Event {
  /** Event type */
  event_type: S3EventType;

  /** Bucket name */
  bucket: string;

  /** Object key */
  object_key: string;

  /** Object ETag */
  etag: string;

  /** Object size */
  size: number;

  /** Modification time */
  mtime: Date;

  /** Content type */
  content_type: string;
}

/**
 * ASR result from transcription engine
 */
export interface ASRResult {
  /** Success flag */
  success: boolean;

  /** Error if failed */
  error?: ASRError;

  /** Transcribed segments */
  segments: ASRSegment[];

  /** Total duration in ms */
  duration_ms: number;

  /** Engine used */
  engine: ASREngine;
}

export interface ASRSegment {
  /** Start time in ms */
  start_ms: number;

  /** End time in ms */
  end_ms: number;

  /** Transcribed text */
  text: string;

  /** Speaker label */
  speaker: string | null;

  /** Confidence score */
  confidence: number;
}

export interface ASRError {
  /** Error code */
  code: string;

  /** Error message */
  message: string;

  /** Whether error is retryable */
  retryable: boolean;
}

/**
 * Search result hit
 */
export interface SearchHit {
  /** Asset reference */
  asset_id: string;

  /** Segment start time for playback seeking */
  start_ms: number;

  /** End time */
  end_ms: number;

  /** Text snippet */
  snippet: string;

  /** Search score */
  score: number;

  /** Speaker if available */
  speaker: string | null;

  /** Asset metadata */
  asset: {
    bucket: string;
    object_key: string;
  };
}

/**
 * Search query parameters
 */
export interface SearchQuery {
  /** Search text */
  query: string;

  /** Optional bucket filter */
  bucket?: string;

  /** Optional speaker filter */
  speaker?: string;

  /** Optional time range filter */
  time_range?: {
    start_ms: number;
    end_ms: number;
  };

  /** Maximum results */
  limit: number;

  /** Offset for pagination */
  offset: number;
}

/**
 * DLQ (Dead Letter Queue) item
 */
export interface DLQItem {
  /** Item ID */
  dlq_id: string;

  /** Original job */
  job: TranscriptionJob;

  /** Asset ID */
  asset_id: string;

  /** Version ID */
  version_id: string;

  /** Error details */
  error: ASRError;

  /** Processing logs */
  logs: string[];

  /** Timestamp when added to DLQ */
  created_at: Date;
}

import { ExecutionMode } from './enums.js';
