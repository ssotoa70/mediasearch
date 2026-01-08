/**
 * Asset processing status as defined in PRD Section 9.1
 */
export enum AssetStatus {
  INGESTED = 'INGESTED',
  TRANSCRIBING = 'TRANSCRIBING',
  TRANSCRIBED = 'TRANSCRIBED',
  INDEXED = 'INDEXED',
  INDEX_PARTIAL = 'INDEX_PARTIAL', // Keyword search available, embeddings failed
  DELETED = 'DELETED',
  QUARANTINED = 'QUARANTINED',
  SKIPPED = 'SKIPPED',
  PENDING_RETRY = 'PENDING_RETRY', // Awaiting retry after transient failure
  FAILED = 'FAILED', // Permanently failed (skipped by operator)
  BUILDING = 'BUILDING',
  READY_TO_PUBLISH = 'READY_TO_PUBLISH',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

/**
 * Visibility states for transcript segments and embeddings
 * As defined in PRD Section 9.1 - MUST filter visibility="ACTIVE" in search
 */
export enum Visibility {
  STAGING = 'STAGING',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  SOFT_DELETED = 'SOFT_DELETED',
}

/**
 * Triage states for quarantined assets
 * As defined in PRD Section 16
 */
export enum TriageState {
  NEEDS_MEDIA_FIX = 'NEEDS_MEDIA_FIX',
  NEEDS_ENGINE_TUNING = 'NEEDS_ENGINE_TUNING',
  QUARANTINED = 'QUARANTINED',
}

/**
 * Failure classification for retry logic
 */
export enum FailureClassification {
  RETRYABLE = 'RETRYABLE',
  NON_RETRYABLE = 'NON_RETRYABLE',
}

/**
 * Supported ASR engines as defined in PRD Section 6.3
 */
export enum ASREngine {
  NVIDIA_NIMS = 'nvidia_nims',  // Default engine
  WHISPER = 'whisper',
  BYO = 'byo', // Bring Your Own
  STUB = 'stub', // Local development stub
}

/**
 * Chunking strategy as defined in PRD Section 7
 */
export enum ChunkingStrategy {
  SENTENCE = 'sentence',  // Default: sentence-level segmentation
  FIXED_WINDOW = 'fixed_window', // Fallback: 5-second windows
}

/**
 * S3 event types
 */
export enum S3EventType {
  OBJECT_CREATED = 'ObjectCreated',
  OBJECT_REMOVED = 'ObjectRemoved',
}

/**
 * Search type
 */
export enum SearchType {
  KEYWORD = 'keyword',
  SEMANTIC = 'semantic',
  HYBRID = 'hybrid',
}

/**
 * Execution mode for ASR
 */
export enum ExecutionMode {
  CPU = 'cpu',
  GPU = 'gpu',
}
