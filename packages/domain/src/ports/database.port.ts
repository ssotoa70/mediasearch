import {
  MediaAsset,
  AssetVersion,
  TranscriptSegment,
  TranscriptEmbedding,
  SearchHit,
  SearchQuery,
  DLQItem,
} from '../types/entities.js';
import { AssetStatus, Visibility, TriageState, SearchType } from '../types/enums.js';

/**
 * Database port interface
 *
 * Production: Implemented by VAST DataBase adapter using vastdb Python SDK
 * Local: Implemented by PostgreSQL + pgvector adapter
 *
 * All operations MUST be idempotent where noted (PRD Section 16)
 */
export interface DatabasePort {
  // ==================== Transaction Support ====================

  /**
   * Begin a new transaction
   * VAST: Uses vastdb session.transaction()
   * Local: Uses PostgreSQL transaction
   */
  beginTransaction(): Promise<Transaction>;

  // ==================== Media Assets ====================

  /**
   * Get asset by ID
   */
  getAsset(assetId: string): Promise<MediaAsset | null>;

  /**
   * Get asset by bucket and object key
   */
  getAssetByKey(bucket: string, objectKey: string): Promise<MediaAsset | null>;

  /**
   * Upsert asset record - MUST be idempotent
   * Key: (bucket, object_key)
   */
  upsertAsset(asset: Omit<MediaAsset, 'updated_at'>): Promise<MediaAsset>;

  /**
   * Update asset status
   */
  updateAssetStatus(
    assetId: string,
    status: AssetStatus,
    options?: {
      triageState?: TriageState;
      lastError?: string;
      attempt?: number;
      recommendedAction?: string;
    }
  ): Promise<void>;

  /**
   * Mark asset as deleted (tombstone)
   */
  tombstoneAsset(assetId: string): Promise<void>;

  /**
   * Set current version pointer - atomic operation for cutover
   */
  setCurrentVersion(assetId: string, versionId: string): Promise<void>;

  // ==================== Asset Versions ====================

  /**
   * Create new version record
   */
  createVersion(version: AssetVersion): Promise<AssetVersion>;

  /**
   * Get version by ID
   */
  getVersion(versionId: string): Promise<AssetVersion | null>;

  /**
   * Update version status
   */
  updateVersionStatus(versionId: string, status: AssetStatus): Promise<void>;

  /**
   * Check if version already processed (idempotency check)
   */
  isVersionProcessed(versionId: string): Promise<boolean>;

  // ==================== Transcript Segments ====================

  /**
   * Batch insert segments - MUST be idempotent
   * Key: (asset_id, version_id, segment_id)
   */
  upsertSegments(segments: TranscriptSegment[]): Promise<void>;

  /**
   * Get segments for asset version
   */
  getSegments(assetId: string, versionId: string): Promise<TranscriptSegment[]>;

  /**
   * Update segment visibility for version
   * Used for STAGING -> ACTIVE promotion and ACTIVE -> ARCHIVED demotion
   */
  updateSegmentVisibility(
    assetId: string,
    versionId: string,
    visibility: Visibility
  ): Promise<void>;

  /**
   * Soft delete all segments for asset
   */
  softDeleteSegments(assetId: string): Promise<void>;

  // ==================== Transcript Embeddings ====================

  /**
   * Batch insert embeddings - MUST be idempotent
   * Key: (asset_id, version_id, segment_id)
   */
  upsertEmbeddings(embeddings: TranscriptEmbedding[]): Promise<void>;

  /**
   * Get embeddings for asset version
   */
  getEmbeddings(assetId: string, versionId: string): Promise<TranscriptEmbedding[]>;

  /**
   * Update embedding visibility for version
   */
  updateEmbeddingVisibility(
    assetId: string,
    versionId: string,
    visibility: Visibility
  ): Promise<void>;

  /**
   * Soft delete all embeddings for asset
   */
  softDeleteEmbeddings(assetId: string): Promise<void>;

  // ==================== Search ====================

  /**
   * Keyword search on transcript segments
   * MUST filter: visibility = ACTIVE AND version_id = asset.current_version_id
   */
  searchKeyword(query: SearchQuery): Promise<SearchHit[]>;

  /**
   * Semantic (vector) search on embeddings
   * MUST filter: visibility = ACTIVE AND version_id = asset.current_version_id
   */
  searchSemantic(query: SearchQuery, queryEmbedding: number[]): Promise<SearchHit[]>;

  /**
   * Hybrid search combining keyword and semantic
   * MUST filter: visibility = ACTIVE AND version_id = asset.current_version_id
   */
  searchHybrid(
    query: SearchQuery,
    queryEmbedding: number[],
    keywordWeight: number,
    semanticWeight: number
  ): Promise<SearchHit[]>;

  // ==================== DLQ / Triage ====================

  /**
   * Add item to dead letter queue
   */
  addToDLQ(item: DLQItem): Promise<void>;

  /**
   * Get DLQ items for triage
   */
  getDLQItems(limit: number): Promise<DLQItem[]>;

  /**
   * Remove item from DLQ
   */
  removeDLQItem(dlqId: string): Promise<void>;

  // ==================== Cleanup ====================

  /**
   * Delete archived versions older than retention period
   */
  purgeArchivedVersions(retentionDays: number): Promise<number>;

  /**
   * Health check
   */
  healthCheck(): Promise<boolean>;

  /**
   * Close connection
   */
  close(): Promise<void>;
}

/**
 * Transaction interface for atomic operations
 */
export interface Transaction {
  /**
   * Commit the transaction
   */
  commit(): Promise<void>;

  /**
   * Rollback the transaction
   */
  rollback(): Promise<void>;

  /**
   * Execute operation within transaction
   */
  execute<T>(fn: () => Promise<T>): Promise<T>;
}
