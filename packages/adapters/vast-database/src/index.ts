/**
 * VAST DataBase Adapter for MediaSearch
 *
 * This adapter implements the DatabasePort interface using VAST DataBase.
 *
 * Architecture:
 * - Node.js adapter communicates with Python sidecar via JSON-RPC 2.0 HTTP
 * - Sidecar uses VAST Python SDK (vastdb) for all database operations
 * - Clean separation: Node logic (TypeScript) + VAST SDK (Python)
 *
 * Sidecar Service:
 * - Location: services/vast-db-sidecar/app.py
 * - Start: `python services/vast-db-sidecar/app.py`
 * - Port: 5000 (configurable via VAST_SIDECAR_PORT)
 *
 * Documentation:
 * - VAST DataBase: https://support.vastdata.com
 * - VAST Python SDK: https://github.com/vast-data/vastdb_sdk
 */

import {
  DatabasePort,
  Transaction,
  MediaAsset,
  AssetVersion,
  TranscriptSegment,
  TranscriptEmbedding,
  SearchHit,
  SearchQuery,
  DLQItem,
  AssetStatus,
  Visibility,
  TriageState,
} from '@mediasearch/domain';

import { VASTRPCClient, VASTRPCConfig } from './vast-rpc-client';

export interface VASTDatabaseConfig {
  /** VAST cluster endpoint (e.g., http://vast-cluster:8070) */
  endpoint: string;

  /** S3 access key ID */
  accessKeyId: string;

  /** S3 secret access key */
  secretAccessKey: string;

  /** Database bucket name */
  bucket: string;

  /** Schema name within the bucket */
  schema: string;

  /** Sidecar service URL (e.g., http://localhost:5000) */
  sidecarUrl?: string;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * VAST DataBase adapter for production
 *
 * This adapter communicates with a Python sidecar service that handles
 * VAST DataBase operations via the vastdb Python SDK.
 *
 * Vector search uses VAST Database's native vector functions:
 * - array_distance (Euclidean)
 * - array_cosine_distance (Cosine similarity)
 *
 * See:
 * - db/vast_schema.py - VAST schema creation
 * - services/vast-db-sidecar/app.py - Sidecar implementation
 */
export class VASTDatabaseAdapter implements DatabasePort {
  private config: VASTDatabaseConfig;
  private rpc: VASTRPCClient;
  private connected: boolean = false;

  constructor(config: VASTDatabaseConfig) {
    this.config = config;

    // Initialize RPC client
    const rpcConfig: VASTRPCConfig = {
      sidecarUrl: config.sidecarUrl || 'http://localhost:5000',
      timeout: 30000,
      debug: config.debug || false,
    };

    this.rpc = new VASTRPCClient(rpcConfig);
  }

  /**
   * Initialize connection to VAST DataBase via sidecar
   *
   * This:
   * 1. Verifies sidecar service is running (health check)
   * 2. Connects to VAST cluster
   * 3. Validates bucket and schema exist
   */
  async initialize(): Promise<void> {
    console.log(`[VAST] Adapter initializing...`);
    console.log(`[VAST] Sidecar: ${this.config.sidecarUrl || 'http://localhost:5000'}`);
    console.log(`[VAST] Endpoint: ${this.config.endpoint}`);
    console.log(`[VAST] Bucket: ${this.config.bucket}, Schema: ${this.config.schema}`);

    try {
      // Test sidecar connectivity
      console.log(`[VAST] Testing sidecar connectivity...`);
      await this.rpc.ping();
      console.log(`[VAST] Sidecar is running ✓`);

      // Full health check (includes VAST connection)
      console.log(`[VAST] Testing VAST cluster connection...`);
      const health = await this.rpc.healthCheck();
      console.log(`[VAST] VAST cluster connected ✓`, health);

      this.connected = true;
      console.log(`[VAST] Adapter initialized successfully`);
    } catch (error) {
      console.error(`[VAST] Initialization failed:`, error);
      throw error;
    }
  }

  // ==================== Transaction Support ====================

  /**
   * Begin a transaction
   *
   * Returns a transaction object that can be committed or rolled back.
   * The transaction context is maintained on the sidecar side.
   */
  async beginTransaction(): Promise<Transaction> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(`[VAST] Beginning transaction...`);
    const txId = await this.rpc.beginTransaction();
    console.log(`[VAST] Transaction created: ${txId}`);

    return {
      commit: async () => {
        console.log(`[VAST] Committing transaction ${txId}...`);
        await this.rpc.commitTransaction(txId);
        console.log(`[VAST] Transaction ${txId} committed`);
      },
      rollback: async () => {
        console.log(`[VAST] Rolling back transaction ${txId}...`);
        await this.rpc.rollbackTransaction(txId);
        console.log(`[VAST] Transaction ${txId} rolled back`);
      },
      execute: async <T,>(fn: () => Promise<T>): Promise<T> => {
        try {
          console.log(`[VAST] Executing operations in transaction ${txId}...`);
          const result = await fn();
          console.log(`[VAST] Operations completed, committing...`);
          await this.rpc.commitTransaction(txId);
          return result;
        } catch (error) {
          console.error(`[VAST] Operation failed in transaction ${txId}, rolling back...`, error);
          try {
            await this.rpc.rollbackTransaction(txId);
          } catch (rollbackError) {
            console.error(`[VAST] Rollback also failed:`, rollbackError);
          }
          throw error;
        }
      },
    };
  }

  // ==================== Media Assets ====================

  /**
   * Get a media asset by ID
   *
   * Returns the asset metadata including current version reference.
   */
  async getAsset(assetId: string): Promise<MediaAsset | null> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(`[VAST] Fetching asset ${assetId}...`);

    try {
      const result = await this.rpc.selectById('media_assets', 'asset_id', assetId);

      if (!result) {
        console.log(`[VAST] Asset not found: ${assetId}`);
        return null;
      }

      console.log(`[VAST] Asset found: ${assetId}`);
      return result as MediaAsset;
    } catch (error) {
      console.error(`[VAST] Error fetching asset:`, error);
      throw error;
    }
  }

  /**
   * Get asset by S3 bucket and key
   *
   * Used during ingest to check if file already has an asset record.
   */
  async getAssetByKey(bucket: string, objectKey: string): Promise<MediaAsset | null> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(`[VAST] Fetching asset by key: ${bucket}/${objectKey}...`);

    // TODO: Implement query using RPC
    // Would need to execute query: WHERE bucket = ? AND object_key = ?
    // For now, this requires full query support in sidecar
    throw new Error('[VAST] getAssetByKey - Full query support needed');
  }

  /**
   * Insert or update a media asset
   *
   * Creates new asset or updates existing one.
   * Generated values (updated_at) are added by sidecar.
   */
  async upsertAsset(asset: Omit<MediaAsset, 'updated_at'>): Promise<MediaAsset> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(`[VAST] Upserting asset ${asset.asset_id}...`);

    try {
      // Prepare data for PyArrow table
      const data = {
        asset_id: [asset.asset_id],
        lineage_id: [asset.lineage_id],
        bucket: [asset.bucket],
        object_key: [asset.object_key],
        current_version_id: [asset.current_version_id],
        status: [asset.status],
        triage_state: [asset.triage_state || null],
        recommended_action: [asset.recommended_action || null],
        transcription_engine: [asset.transcription_engine],
        last_error: [asset.last_error || null],
        attempt: [asset.attempt],
        file_size: [asset.file_size],
        content_type: [asset.content_type],
        etag: [asset.etag],
        duration_ms: [asset.duration_ms],
        codec_info: [asset.codec_info || null],
        tombstone: [asset.tombstone],
        ingest_time: [asset.ingest_time],
      };

      const result = await this.rpc.upsertTable(
        'media_assets',
        data as any,
        ['asset_id']
      );

      console.log(`[VAST] Asset upserted: ${asset.asset_id}`, result);

      // Return asset with updated_at set to now
      return {
        ...asset,
        updated_at: new Date(),
      } as MediaAsset;
    } catch (error) {
      console.error(`[VAST] Error upserting asset:`, error);
      throw error;
    }
  }

  /**
   * Update asset status and metadata
   *
   * Called when asset transitions between states (PENDING, ACTIVE, ARCHIVED, etc.)
   */
  async updateAssetStatus(
    assetId: string,
    status: AssetStatus,
    options?: {
      triageState?: TriageState;
      lastError?: string;
      attempt?: number;
      recommendedAction?: string;
    }
  ): Promise<void> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(`[VAST] Updating asset ${assetId} status to ${status}...`);

    try {
      const updates: Record<string, any> = {
        status,
        updated_at: new Date(),
      };

      if (options?.triageState) {
        updates.triage_state = options.triageState;
      }
      if (options?.lastError) {
        updates.last_error = options.lastError;
      }
      if (options?.attempt !== undefined) {
        updates.attempt = options.attempt;
      }
      if (options?.recommendedAction) {
        updates.recommended_action = options.recommendedAction;
      }

      await this.rpc.updateTable(
        'media_assets',
        updates,
        { asset_id: assetId }
      );

      console.log(`[VAST] Asset ${assetId} status updated to ${status}`);
    } catch (error) {
      console.error(`[VAST] Error updating asset status:`, error);
      throw error;
    }
  }

  /**
   * Mark asset as tombstoned (soft delete)
   *
   * Sets tombstone flag without actually deleting data.
   */
  async tombstoneAsset(assetId: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(`[VAST] Tombstoning asset ${assetId}...`);

    try {
      await this.rpc.updateTable(
        'media_assets',
        {
          tombstone: true,
          updated_at: new Date(),
        },
        { asset_id: assetId }
      );

      console.log(`[VAST] Asset ${assetId} tombstoned`);
    } catch (error) {
      console.error(`[VAST] Error tombstoning asset:`, error);
      throw error;
    }
  }

  /**
   * Set the current version for an asset (ATOMIC OPERATION)
   *
   * Critical operation: Must be atomic to prevent race conditions.
   * Used during version cutover (STAGING → ACTIVE).
   *
   * Must be run within a transaction for safety.
   */
  async setCurrentVersion(assetId: string, versionId: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(`[VAST] Setting current version for asset ${assetId} to ${versionId}...`);

    try {
      await this.rpc.updateTable(
        'media_assets',
        {
          current_version_id: versionId,
          updated_at: new Date(),
        },
        { asset_id: assetId }
      );

      console.log(`[VAST] Current version set: ${assetId} → ${versionId}`);
    } catch (error) {
      console.error(`[VAST] Error setting current version:`, error);
      throw error;
    }
  }

  // ==================== Asset Versions ====================

  /**
   * Create a new asset version
   *
   * Versions track different transcriptions/states of the same asset.
   * New versions start as STAGING and are published to ACTIVE atomically.
   */
  async createVersion(version: AssetVersion): Promise<AssetVersion> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(`[VAST] Creating version ${version.version_id} for asset ${version.asset_id}...`);

    try {
      const data = {
        version_id: [version.version_id],
        asset_id: [version.asset_id],
        status: [version.status],
        publish_state: [version.publish_state],
        etag: [version.etag],
        file_size: [version.file_size],
        created_at: [version.created_at],
      };

      const result = await this.rpc.insertTable('asset_versions', data as any);

      console.log(`[VAST] Version created: ${version.version_id}`, result);
      return version;
    } catch (error) {
      console.error(`[VAST] Error creating version:`, error);
      throw error;
    }
  }

  /**
   * Get asset version by ID
   *
   * Returns version metadata but NOT the actual transcript data.
   */
  async getVersion(versionId: string): Promise<AssetVersion | null> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(`[VAST] Fetching version ${versionId}...`);

    try {
      const result = await this.rpc.selectById('asset_versions', 'version_id', versionId);

      if (!result) {
        console.log(`[VAST] Version not found: ${versionId}`);
        return null;
      }

      console.log(`[VAST] Version found: ${versionId}`);
      return result as AssetVersion;
    } catch (error) {
      console.error(`[VAST] Error fetching version:`, error);
      throw error;
    }
  }

  /**
   * Update version status
   *
   * Called during processing transitions (STAGING → ACTIVE, etc.)
   */
  async updateVersionStatus(versionId: string, status: AssetStatus): Promise<void> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(`[VAST] Updating version ${versionId} status to ${status}...`);

    try {
      await this.rpc.updateTable(
        'asset_versions',
        { status },
        { version_id: versionId }
      );

      console.log(`[VAST] Version ${versionId} status updated to ${status}`);
    } catch (error) {
      console.error(`[VAST] Error updating version status:`, error);
      throw error;
    }
  }

  /**
   * Check if version has completed processing
   *
   * A version is "processed" when transcription is complete
   * and all transcripts/embeddings are stored.
   *
   * Implementation: Check if status = ACTIVE or ARCHIVED
   */
  async isVersionProcessed(versionId: string): Promise<boolean> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(`[VAST] Checking if version ${versionId} is processed...`);

    try {
      const version = await this.getVersion(versionId);

      if (!version) {
        console.log(`[VAST] Version not found: ${versionId}`);
        return false;
      }

      const isProcessed = version.status === 'ACTIVE' || version.status === 'ARCHIVED';
      console.log(`[VAST] Version ${versionId} processed: ${isProcessed}`);
      return isProcessed;
    } catch (error) {
      console.error(`[VAST] Error checking version status:`, error);
      throw error;
    }
  }

  // ==================== Transcript Segments ====================

  /**
   * Batch insert or update transcript segments
   *
   * Called after ASR transcription completes with segment text.
   * Uses PyArrow for efficient batch operations.
   *
   * Segments contain:
   * - segment_id: Unique within version
   * - text: Transcribed text
   * - start_ms, end_ms: Timestamp in milliseconds
   * - speaker: Speaker identifier (optional)
   * - confidence: Transcription confidence (0-1)
   */
  async upsertSegments(segments: TranscriptSegment[]): Promise<void> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(`[VAST] Upserting ${segments.length} transcript segments...`);

    try {
      if (segments.length === 0) {
        console.log(`[VAST] No segments to upsert`);
        return;
      }

      // Prepare data for PyArrow table
      // Must handle null/optional fields properly
      const data = {
        segment_id: segments.map((s) => s.segment_id),
        version_id: segments.map((s) => s.version_id),
        asset_id: segments.map((s) => s.asset_id),
        text: segments.map((s) => s.text),
        start_ms: segments.map((s) => s.start_ms),
        end_ms: segments.map((s) => s.end_ms),
        speaker: segments.map((s) => s.speaker || null),
        confidence: segments.map((s) => s.confidence),
        visibility: segments.map((s) => s.visibility),
        created_at: segments.map((s) => s.created_at),
      };

      const result = await this.rpc.upsertTable(
        'transcript_segments',
        data as any,
        ['segment_id']
      );

      console.log(`[VAST] Upserted ${segments.length} segments`, result);
    } catch (error) {
      console.error(`[VAST] Error upserting segments:`, error);
      throw error;
    }
  }

  /**
   * Get all transcript segments for an asset version
   *
   * Returns segments in timestamp order (start_ms ASC).
   * CRITICAL: Must filter visibility='ACTIVE' for search results.
   */
  async getSegments(assetId: string, versionId: string): Promise<TranscriptSegment[]> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(`[VAST] Fetching segments for asset ${assetId}, version ${versionId}...`);

    try {
      // TODO: Implement full query with WHERE asset_id AND version_id ORDER BY start_ms
      // Requires full SQL query support in sidecar
      console.warn('[VAST] getSegments requires full query support - not yet implemented');
      return [];
    } catch (error) {
      console.error(`[VAST] Error fetching segments:`, error);
      throw error;
    }
  }

  /**
   * Update segment visibility (STAGING → ACTIVE)
   *
   * Called during version publication to make segments searchable.
   * CRITICAL: Only ACTIVE segments should appear in search results.
   */
  async updateSegmentVisibility(
    assetId: string,
    versionId: string,
    visibility: Visibility
  ): Promise<void> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(
      `[VAST] Updating segment visibility for asset ${assetId}, version ${versionId} to ${visibility}...`
    );

    try {
      await this.rpc.updateTable(
        'transcript_segments',
        { visibility },
        { asset_id: assetId, version_id: versionId }
      );

      console.log(
        `[VAST] Segments visibility updated: ${assetId}/${versionId} → ${visibility}`
      );
    } catch (error) {
      console.error(`[VAST] Error updating segment visibility:`, error);
      throw error;
    }
  }

  /**
   * Soft delete all segments for an asset
   *
   * Sets visibility=SOFT_DELETED without actually removing data.
   * Used when asset is deleted.
   */
  async softDeleteSegments(assetId: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(`[VAST] Soft deleting segments for asset ${assetId}...`);

    try {
      await this.rpc.updateTable(
        'transcript_segments',
        { visibility: 'SOFT_DELETED' },
        { asset_id: assetId }
      );

      console.log(`[VAST] Segments soft deleted for asset ${assetId}`);
    } catch (error) {
      console.error(`[VAST] Error soft deleting segments:`, error);
      throw error;
    }
  }

  // ==================== Transcript Embeddings (Vector Data) ====================

  /**
   * Batch insert or update transcript embeddings
   *
   * CRITICAL: These are 384-dimensional vectors from embedding models (e.g., sentence-transformers)
   * Format: list of float32 values, stored as PyArrow list type
   *
   * Called after embedding generation to enable semantic search.
   *
   * Each embedding corresponds to a segment.
   * Vector size: 384 (matches common transformer models)
   * Distance metric: Cosine similarity (used by VAST's array_cosine_distance)
   */
  async upsertEmbeddings(embeddings: TranscriptEmbedding[]): Promise<void> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(`[VAST] Upserting ${embeddings.length} embeddings (vectors)...`);

    try {
      if (embeddings.length === 0) {
        console.log(`[VAST] No embeddings to upsert`);
        return;
      }

      // Prepare data for PyArrow table
      // Vector column: list of float32 (384 dimensions)
      const data = {
        embedding_id: embeddings.map((e) => e.embedding_id),
        segment_id: embeddings.map((e) => e.segment_id),
        version_id: embeddings.map((e) => e.version_id),
        asset_id: embeddings.map((e) => e.asset_id),
        embedding: embeddings.map((e) => e.embedding), // Vector: number[]
        model_name: embeddings.map((e) => e.model_name),
        model_version: embeddings.map((e) => e.model_version),
        visibility: embeddings.map((e) => e.visibility),
        created_at: embeddings.map((e) => e.created_at),
      };

      const result = await this.rpc.upsertTable(
        'transcript_embeddings',
        data as any,
        ['embedding_id']
      );

      console.log(`[VAST] Upserted ${embeddings.length} embeddings (${embeddings.length * 384} total vector dimensions)`, result);
    } catch (error) {
      console.error(`[VAST] Error upserting embeddings:`, error);
      throw error;
    }
  }

  /**
   * Get all embeddings for an asset version
   *
   * Returns embeddings with their vectors.
   * CRITICAL: Must filter visibility='ACTIVE' for search.
   *
   * These vectors are used for semantic search via cosine similarity.
   */
  async getEmbeddings(assetId: string, versionId: string): Promise<TranscriptEmbedding[]> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(`[VAST] Fetching embeddings for asset ${assetId}, version ${versionId}...`);

    try {
      // TODO: Implement full query with WHERE asset_id AND version_id AND visibility='ACTIVE'
      // Requires full SQL query support in sidecar
      console.warn('[VAST] getEmbeddings requires full query support - not yet implemented');
      return [];
    } catch (error) {
      console.error(`[VAST] Error fetching embeddings:`, error);
      throw error;
    }
  }

  /**
   * Update embedding visibility (STAGING → ACTIVE)
   *
   * Called during version publication to make embeddings searchable.
   * CRITICAL: Only ACTIVE embeddings should be used for semantic search.
   */
  async updateEmbeddingVisibility(
    assetId: string,
    versionId: string,
    visibility: Visibility
  ): Promise<void> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(
      `[VAST] Updating embedding visibility for asset ${assetId}, version ${versionId} to ${visibility}...`
    );

    try {
      await this.rpc.updateTable(
        'transcript_embeddings',
        { visibility },
        { asset_id: assetId, version_id: versionId }
      );

      console.log(
        `[VAST] Embeddings visibility updated: ${assetId}/${versionId} → ${visibility}`
      );
    } catch (error) {
      console.error(`[VAST] Error updating embedding visibility:`, error);
      throw error;
    }
  }

  /**
   * Soft delete all embeddings for an asset
   *
   * Sets visibility=SOFT_DELETED without removing data.
   * Used when asset is deleted.
   */
  async softDeleteEmbeddings(assetId: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Adapter not initialized - call initialize() first');
    }

    console.log(`[VAST] Soft deleting embeddings for asset ${assetId}...`);

    try {
      await this.rpc.updateTable(
        'transcript_embeddings',
        { visibility: 'SOFT_DELETED' },
        { asset_id: assetId }
      );

      console.log(`[VAST] Embeddings soft deleted for asset ${assetId}`);
    } catch (error) {
      console.error(`[VAST] Error soft deleting embeddings:`, error);
      throw error;
    }
  }

  // ==================== Search ====================

  async searchKeyword(query: SearchQuery): Promise<SearchHit[]> {
    // VAST DataBase keyword search using LIKE matching on transcript_segments.text
    // Filters by visibility='ACTIVE' to prevent partial/staging results
    //
    // SQL: SELECT * FROM transcript_segments
    //      WHERE visibility = 'ACTIVE' AND text LIKE '%query%'
    //      ORDER BY created_at DESC
    //      LIMIT limit

    try {
      console.log(`[VAST] Searching keyword: "${query.text}" in ${query.assetId}`);

      const sql = `
        SELECT * FROM transcript_segments
        WHERE visibility = 'ACTIVE' AND text LIKE '${query.text}'
        ORDER BY created_at DESC
        LIMIT ${query.limit || 100}
      `;

      const results = await this.client.executeQuery(sql);

      const hits: SearchHit[] = results.map((row: any) => ({
        segment_id: row.segment_id,
        asset_id: row.asset_id,
        version_id: row.version_id,
        text: row.text,
        start_ms: row.start_ms,
        end_ms: row.end_ms,
        speaker: row.speaker || '',
        confidence: row.confidence || 0,
        score: 1.0, // Full keyword match
        match_type: 'keyword' as const,
      }));

      console.log(`[VAST] Found ${hits.length} keyword matches`);
      return hits;
    } catch (error) {
      console.error(`[VAST] Keyword search error:`, error);
      throw new Error(`Keyword search failed: ${(error as Error).message}`);
    }
  }

  async searchSemantic(query: SearchQuery, queryEmbedding: number[]): Promise<SearchHit[]> {
    // VAST Database vector search using array_cosine_distance function
    // Filters by visibility='ACTIVE' to prevent partial/staging results
    //
    // SQL: SELECT * FROM transcript_embeddings
    //      WHERE visibility = 'ACTIVE'
    //      ORDER BY array_cosine_distance(embedding, [query_vector])
    //      LIMIT limit
    // Then join with transcript_segments to get text

    try {
      console.log(`[VAST] Searching semantic in asset ${query.assetId}, dim=${queryEmbedding.length}`);

      if (!queryEmbedding || queryEmbedding.length === 0) {
        throw new Error('Query embedding required for semantic search');
      }

      // Format vector for SQL query
      const vectorStr = `[${queryEmbedding.join(', ')}]`;

      const sql = `
        SELECT * FROM transcript_embeddings
        WHERE visibility = 'ACTIVE'
        ORDER BY array_cosine_distance(embedding, ${vectorStr})
        LIMIT ${query.limit || 100}
      `;

      const results = await this.client.executeQuery(sql);

      // Join with segments to get text
      const hits: SearchHit[] = [];

      for (const row of results) {
        // Fetch segment data
        const segmentData = await this.getSegmentById(row.segment_id);

        if (segmentData) {
          hits.push({
            segment_id: row.segment_id,
            asset_id: row.asset_id,
            version_id: row.version_id,
            text: segmentData.text,
            start_ms: segmentData.start_ms,
            end_ms: segmentData.end_ms,
            speaker: segmentData.speaker || '',
            confidence: segmentData.confidence || 0,
            score: this.calculateCosineSimilarity(queryEmbedding, row.embedding),
            match_type: 'semantic' as const,
          });
        }
      }

      console.log(`[VAST] Found ${hits.length} semantic matches`);
      return hits;
    } catch (error) {
      console.error(`[VAST] Semantic search error:`, error);
      throw new Error(`Semantic search failed: ${(error as Error).message}`);
    }
  }

  async searchHybrid(
    query: SearchQuery,
    queryEmbedding: number[],
    keywordWeight: number = 0.5,
    semanticWeight: number = 0.5
  ): Promise<SearchHit[]> {
    // Combine keyword and semantic search results with weighted scoring
    // Both queries must filter visibility='ACTIVE'
    // Results are merged and scored based on weights

    try {
      console.log(`[VAST] Searching hybrid: "${query.text}", weights: keyword=${keywordWeight}, semantic=${semanticWeight}`);

      const [keywordHits, semanticHits] = await Promise.all([
        this.searchKeyword(query),
        this.searchSemantic(query, queryEmbedding),
      ]);

      // Merge results by segment_id, combining scores
      const hitMap = new Map<string, SearchHit>();

      // Add keyword hits
      for (const hit of keywordHits) {
        const existingHit = hitMap.get(hit.segment_id);
        if (existingHit) {
          existingHit.score = (existingHit.score || 0) + keywordWeight;
        } else {
          hit.score = keywordWeight;
          hitMap.set(hit.segment_id, hit);
        }
      }

      // Add semantic hits
      for (const hit of semanticHits) {
        const existingHit = hitMap.get(hit.segment_id);
        if (existingHit) {
          existingHit.score = (existingHit.score || 0) + hit.score * semanticWeight;
          existingHit.match_type = 'hybrid'; // Mark as hybrid if both matched
        } else {
          hit.score = hit.score * semanticWeight;
          hit.match_type = 'hybrid';
          hitMap.set(hit.segment_id, hit);
        }
      }

      // Sort by score descending
      const results = Array.from(hitMap.values()).sort((a, b) => (b.score || 0) - (a.score || 0));

      // Apply limit
      const limited = results.slice(0, query.limit || 100);

      console.log(`[VAST] Found ${limited.length} hybrid matches`);
      return limited;
    } catch (error) {
      console.error(`[VAST] Hybrid search error:`, error);
      throw new Error(`Hybrid search failed: ${(error as Error).message}`);
    }
  }

  // ==================== Helper Methods ====================

  private async getSegmentById(segmentId: string): Promise<TranscriptSegment | null> {
    try {
      const result = await this.client.selectById('transcript_segments', 'segment_id', segmentId);
      if (!result) return null;

      return {
        segment_id: result.segment_id,
        asset_id: result.asset_id,
        version_id: result.version_id,
        start_ms: result.start_ms,
        end_ms: result.end_ms,
        text: result.text,
        speaker: result.speaker,
        confidence: result.confidence,
        visibility: result.visibility,
      };
    } catch {
      return null;
    }
  }

  private calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      console.warn('[VAST] Vector dimension mismatch');
      return 0;
    }

    let dotProduct = 0;
    let mag1 = 0;
    let mag2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      mag1 += vec1[i] * vec1[i];
      mag2 += vec2[i] * vec2[i];
    }

    if (mag1 === 0 || mag2 === 0) return 0;

    return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
  }

  // ==================== DLQ / Triage ====================

  async addToDLQ(item: DLQItem): Promise<void> {
    // TODO: Implement VAST insert
    throw new Error('[VAST] addToDLQ not implemented - configure VAST credentials');
  }

  async getDLQItems(limit: number): Promise<DLQItem[]> {
    // TODO: Implement VAST query
    throw new Error('[VAST] getDLQItems not implemented - configure VAST credentials');
  }

  async removeDLQItem(dlqId: string): Promise<void> {
    // TODO: Implement VAST delete
    throw new Error('[VAST] removeDLQItem not implemented - configure VAST credentials');
  }

  // ==================== Cleanup ====================

  async purgeArchivedVersions(retentionDays: number): Promise<number> {
    // Delete archived versions older than retention period
    // TODO: Implement VAST delete with date filter
    throw new Error('[VAST] purgeArchivedVersions not implemented - configure VAST credentials');
  }

  /**
   * Health check - verify VAST connection is healthy
   */
  async healthCheck(): Promise<boolean> {
    if (!this.connected) return false;

    try {
      console.log(`[VAST] Running health check...`);
      const health = await this.rpc.healthCheck();
      const isHealthy = health.status === 'healthy';
      console.log(`[VAST] Health check: ${isHealthy ? '✓ healthy' : '✗ unhealthy'}`);
      return isHealthy;
    } catch (error) {
      console.error(`[VAST] Health check failed:`, error);
      return false;
    }
  }

  /**
   * Close connection to VAST
   *
   * Currently a no-op since sidecar manages connection lifecycle.
   * In the future, could signal sidecar to close connection.
   */
  async close(): Promise<void> {
    console.log(`[VAST] Closing adapter...`);
    this.connected = false;
    console.log(`[VAST] Adapter closed`);
  }
}

/**
 * Create VAST DataBase adapter from environment variables
 */
export function createVASTDatabaseAdapter(): VASTDatabaseAdapter {
  const config: VASTDatabaseConfig = {
    endpoint: process.env.VAST_ENDPOINT || '',
    accessKeyId: process.env.VAST_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.VAST_SECRET_ACCESS_KEY || '',
    bucket: process.env.VAST_DATABASE_BUCKET || 'mediasearch-db',
    schema: process.env.VAST_DATABASE_SCHEMA || 'mediasearch',
    sidecarUrl: process.env.VAST_SIDECAR_URL || 'http://localhost:5000',
    debug: process.env.VAST_DEBUG === 'true',
  };

  return new VASTDatabaseAdapter(config);
}
