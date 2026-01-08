import pg from 'pg';
import pgvector from 'pgvector/pg';
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

const { Pool, Client } = pg;

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * PostgreSQL + pgvector adapter for local development
 *
 * This adapter implements the DatabasePort interface using PostgreSQL
 * with the pgvector extension for vector similarity search.
 *
 * For production, use the VAST DataBase adapter instead.
 */
export class PostgresDatabaseAdapter implements DatabasePort {
  private pool: pg.Pool;

  constructor(config: PostgresConfig) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  async initialize(): Promise<void> {
    // Register pgvector type
    const client = await this.pool.connect();
    try {
      await pgvector.registerType(client);
    } finally {
      client.release();
    }
  }

  // ==================== Transaction Support ====================

  async beginTransaction(): Promise<Transaction> {
    const client = await this.pool.connect();
    await client.query('BEGIN');

    return {
      async commit() {
        try {
          await client.query('COMMIT');
        } finally {
          client.release();
        }
      },
      async rollback() {
        try {
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      },
      async execute<T>(fn: () => Promise<T>): Promise<T> {
        try {
          const result = await fn();
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
    };
  }

  // ==================== Media Assets ====================

  async getAsset(assetId: string): Promise<MediaAsset | null> {
    const result = await this.pool.query(
      'SELECT * FROM media_assets WHERE asset_id = $1',
      [assetId]
    );
    return result.rows[0] ? this.mapAsset(result.rows[0]) : null;
  }

  async getAssetByKey(bucket: string, objectKey: string): Promise<MediaAsset | null> {
    const result = await this.pool.query(
      'SELECT * FROM media_assets WHERE bucket = $1 AND object_key = $2',
      [bucket, objectKey]
    );
    return result.rows[0] ? this.mapAsset(result.rows[0]) : null;
  }

  async upsertAsset(asset: Omit<MediaAsset, 'updated_at'>): Promise<MediaAsset> {
    const result = await this.pool.query(
      `INSERT INTO media_assets (
        asset_id, lineage_id, bucket, object_key, current_version_id,
        status, triage_state, recommended_action, transcription_engine,
        last_error, attempt, file_size, content_type, etag, duration_ms,
        codec_info, tombstone, ingest_time
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (bucket, object_key) DO UPDATE SET
        current_version_id = EXCLUDED.current_version_id,
        status = EXCLUDED.status,
        triage_state = EXCLUDED.triage_state,
        recommended_action = EXCLUDED.recommended_action,
        transcription_engine = EXCLUDED.transcription_engine,
        last_error = EXCLUDED.last_error,
        attempt = EXCLUDED.attempt,
        file_size = EXCLUDED.file_size,
        content_type = EXCLUDED.content_type,
        etag = EXCLUDED.etag,
        duration_ms = EXCLUDED.duration_ms,
        codec_info = EXCLUDED.codec_info,
        tombstone = EXCLUDED.tombstone
      RETURNING *`,
      [
        asset.asset_id,
        asset.lineage_id,
        asset.bucket,
        asset.object_key,
        asset.current_version_id,
        asset.status,
        asset.triage_state,
        asset.recommended_action,
        asset.transcription_engine,
        asset.last_error,
        asset.attempt,
        asset.file_size,
        asset.content_type,
        asset.etag,
        asset.duration_ms,
        asset.codec_info,
        asset.tombstone,
        asset.ingest_time,
      ]
    );
    return this.mapAsset(result.rows[0]);
  }

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
    const updates: string[] = ['status = $2'];
    const values: unknown[] = [assetId, status];
    let paramIndex = 3;

    if (options?.triageState !== undefined) {
      updates.push(`triage_state = $${paramIndex++}`);
      values.push(options.triageState);
    }
    if (options?.lastError !== undefined) {
      updates.push(`last_error = $${paramIndex++}`);
      values.push(options.lastError);
    }
    if (options?.attempt !== undefined) {
      updates.push(`attempt = $${paramIndex++}`);
      values.push(options.attempt);
    }
    if (options?.recommendedAction !== undefined) {
      updates.push(`recommended_action = $${paramIndex++}`);
      values.push(options.recommendedAction);
    }

    await this.pool.query(
      `UPDATE media_assets SET ${updates.join(', ')} WHERE asset_id = $1`,
      values
    );
  }

  async tombstoneAsset(assetId: string): Promise<void> {
    await this.pool.query(
      `UPDATE media_assets
       SET tombstone = true, status = 'DELETED', current_version_id = NULL
       WHERE asset_id = $1`,
      [assetId]
    );
  }

  async setCurrentVersion(assetId: string, versionId: string): Promise<void> {
    await this.pool.query(
      'UPDATE media_assets SET current_version_id = $2 WHERE asset_id = $1',
      [assetId, versionId]
    );
  }

  // ==================== Asset Versions ====================

  async createVersion(version: AssetVersion): Promise<AssetVersion> {
    const result = await this.pool.query(
      `INSERT INTO asset_versions (version_id, asset_id, status, publish_state, etag, file_size, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        version.version_id,
        version.asset_id,
        version.status,
        version.publish_state,
        version.etag,
        version.file_size,
        version.created_at,
      ]
    );
    return this.mapVersion(result.rows[0]);
  }

  async getVersion(versionId: string): Promise<AssetVersion | null> {
    const result = await this.pool.query(
      'SELECT * FROM asset_versions WHERE version_id = $1',
      [versionId]
    );
    return result.rows[0] ? this.mapVersion(result.rows[0]) : null;
  }

  async updateVersionStatus(versionId: string, status: AssetStatus): Promise<void> {
    await this.pool.query(
      'UPDATE asset_versions SET status = $2 WHERE version_id = $1',
      [versionId, status]
    );
  }

  async isVersionProcessed(versionId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM asset_versions
       WHERE version_id = $1 AND status IN ('INDEXED', 'TRANSCRIBED', 'PUBLISHED')`,
      [versionId]
    );
    return result.rows.length > 0;
  }

  // ==================== Transcript Segments ====================

  async upsertSegments(segments: TranscriptSegment[]): Promise<void> {
    if (segments.length === 0) return;

    const values = segments.flatMap((s) => [
      s.segment_id,
      s.asset_id,
      s.version_id,
      s.start_ms,
      s.end_ms,
      s.text,
      s.speaker,
      s.confidence,
      s.visibility,
      s.chunking_strategy,
      s.created_at,
    ]);

    const placeholders = segments
      .map((_, i) => {
        const base = i * 11;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`;
      })
      .join(', ');

    await this.pool.query(
      `INSERT INTO transcript_segments
       (segment_id, asset_id, version_id, start_ms, end_ms, text, speaker, confidence, visibility, chunking_strategy, created_at)
       VALUES ${placeholders}
       ON CONFLICT (asset_id, version_id, segment_id) DO UPDATE SET
         text = EXCLUDED.text,
         speaker = EXCLUDED.speaker,
         confidence = EXCLUDED.confidence,
         visibility = EXCLUDED.visibility`,
      values
    );
  }

  async getSegments(assetId: string, versionId: string): Promise<TranscriptSegment[]> {
    const result = await this.pool.query(
      'SELECT * FROM transcript_segments WHERE asset_id = $1 AND version_id = $2 ORDER BY start_ms',
      [assetId, versionId]
    );
    return result.rows.map(this.mapSegment);
  }

  async updateSegmentVisibility(
    assetId: string,
    versionId: string,
    visibility: Visibility
  ): Promise<void> {
    await this.pool.query(
      'UPDATE transcript_segments SET visibility = $3 WHERE asset_id = $1 AND version_id = $2',
      [assetId, versionId, visibility]
    );
  }

  async softDeleteSegments(assetId: string): Promise<void> {
    await this.pool.query(
      "UPDATE transcript_segments SET visibility = 'SOFT_DELETED' WHERE asset_id = $1",
      [assetId]
    );
  }

  // ==================== Transcript Embeddings ====================

  async upsertEmbeddings(embeddings: TranscriptEmbedding[]): Promise<void> {
    if (embeddings.length === 0) return;

    // Insert embeddings one by one due to vector type complexity
    for (const e of embeddings) {
      await this.pool.query(
        `INSERT INTO transcript_embeddings
         (embedding_id, asset_id, version_id, segment_id, embedding, model, dimension, visibility, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (asset_id, version_id, segment_id) DO UPDATE SET
           embedding = EXCLUDED.embedding,
           model = EXCLUDED.model,
           visibility = EXCLUDED.visibility`,
        [
          e.embedding_id,
          e.asset_id,
          e.version_id,
          e.segment_id,
          pgvector.toSql(e.embedding),
          e.model,
          e.dimension,
          e.visibility,
          e.created_at,
        ]
      );
    }
  }

  async getEmbeddings(assetId: string, versionId: string): Promise<TranscriptEmbedding[]> {
    const result = await this.pool.query(
      'SELECT * FROM transcript_embeddings WHERE asset_id = $1 AND version_id = $2',
      [assetId, versionId]
    );
    return result.rows.map(this.mapEmbedding);
  }

  async updateEmbeddingVisibility(
    assetId: string,
    versionId: string,
    visibility: Visibility
  ): Promise<void> {
    await this.pool.query(
      'UPDATE transcript_embeddings SET visibility = $3 WHERE asset_id = $1 AND version_id = $2',
      [assetId, versionId, visibility]
    );
  }

  async softDeleteEmbeddings(assetId: string): Promise<void> {
    await this.pool.query(
      "UPDATE transcript_embeddings SET visibility = 'SOFT_DELETED' WHERE asset_id = $1",
      [assetId]
    );
  }

  // ==================== Search ====================

  async searchKeyword(query: SearchQuery): Promise<SearchHit[]> {
    const result = await this.pool.query(
      `SELECT * FROM search_keyword($1, $2, $3, $4, $5)`,
      [query.query, query.limit, query.offset, query.bucket || null, query.speaker || null]
    );
    return result.rows.map(this.mapSearchHit);
  }

  async searchSemantic(query: SearchQuery, queryEmbedding: number[]): Promise<SearchHit[]> {
    const result = await this.pool.query(
      `SELECT * FROM search_semantic($1, $2, $3, $4, $5)`,
      [
        pgvector.toSql(queryEmbedding),
        query.limit,
        query.offset,
        query.bucket || null,
        query.speaker || null,
      ]
    );
    return result.rows.map(this.mapSearchHit);
  }

  async searchHybrid(
    query: SearchQuery,
    queryEmbedding: number[],
    keywordWeight: number,
    semanticWeight: number
  ): Promise<SearchHit[]> {
    // Hybrid search: combine keyword and semantic results
    const [keywordResults, semanticResults] = await Promise.all([
      this.searchKeyword({ ...query, limit: query.limit * 2 }),
      this.searchSemantic({ ...query, limit: query.limit * 2 }, queryEmbedding),
    ]);

    // Merge and re-rank
    const scoreMap = new Map<string, { hit: SearchHit; score: number }>();

    for (const hit of keywordResults) {
      const key = `${hit.asset_id}:${hit.start_ms}`;
      scoreMap.set(key, { hit, score: hit.score * keywordWeight });
    }

    for (const hit of semanticResults) {
      const key = `${hit.asset_id}:${hit.start_ms}`;
      const existing = scoreMap.get(key);
      if (existing) {
        existing.score += hit.score * semanticWeight;
      } else {
        scoreMap.set(key, { hit, score: hit.score * semanticWeight });
      }
    }

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(query.offset, query.offset + query.limit)
      .map(({ hit, score }) => ({ ...hit, score }));
  }

  // ==================== DLQ / Triage ====================

  async addToDLQ(item: DLQItem): Promise<void> {
    await this.pool.query(
      `INSERT INTO dlq_items (dlq_id, job_id, asset_id, version_id, error_code, error_message, error_retryable, job_data, logs, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        item.dlq_id,
        item.job.job_id,
        item.asset_id,
        item.version_id,
        item.error.code,
        item.error.message,
        item.error.retryable,
        JSON.stringify(item.job),
        item.logs,
        item.created_at,
      ]
    );
  }

  async getDLQItems(limit: number): Promise<DLQItem[]> {
    const result = await this.pool.query(
      'SELECT * FROM dlq_items ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return result.rows.map(this.mapDLQItem);
  }

  async removeDLQItem(dlqId: string): Promise<void> {
    await this.pool.query('DELETE FROM dlq_items WHERE dlq_id = $1', [dlqId]);
  }

  // ==================== Cleanup ====================

  async purgeArchivedVersions(retentionDays: number): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM asset_versions
       WHERE status = 'ARCHIVED'
         AND created_at < NOW() - INTERVAL '1 day' * $1
       RETURNING version_id`,
      [retentionDays]
    );
    return result.rowCount || 0;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // ==================== Mappers ====================

  private mapAsset(row: Record<string, unknown>): MediaAsset {
    return {
      asset_id: row.asset_id as string,
      lineage_id: row.lineage_id as string,
      bucket: row.bucket as string,
      object_key: row.object_key as string,
      current_version_id: row.current_version_id as string | null,
      status: row.status as AssetStatus,
      triage_state: row.triage_state as TriageState | null,
      recommended_action: row.recommended_action as string | null,
      transcription_engine: row.transcription_engine as MediaAsset['transcription_engine'],
      last_error: row.last_error as string | null,
      attempt: row.attempt as number,
      file_size: Number(row.file_size),
      content_type: row.content_type as string,
      etag: row.etag as string,
      duration_ms: row.duration_ms ? Number(row.duration_ms) : null,
      codec_info: row.codec_info as string | null,
      tombstone: row.tombstone as boolean,
      ingest_time: new Date(row.ingest_time as string),
      updated_at: new Date(row.updated_at as string),
    };
  }

  private mapVersion(row: Record<string, unknown>): AssetVersion {
    return {
      version_id: row.version_id as string,
      asset_id: row.asset_id as string,
      status: row.status as AssetStatus,
      publish_state: row.publish_state as Visibility,
      etag: row.etag as string,
      file_size: Number(row.file_size),
      created_at: new Date(row.created_at as string),
    };
  }

  private mapSegment(row: Record<string, unknown>): TranscriptSegment {
    return {
      segment_id: row.segment_id as string,
      asset_id: row.asset_id as string,
      version_id: row.version_id as string,
      start_ms: Number(row.start_ms),
      end_ms: Number(row.end_ms),
      text: row.text as string,
      speaker: row.speaker as string | null,
      confidence: row.confidence as number,
      visibility: row.visibility as Visibility,
      chunking_strategy: row.chunking_strategy as TranscriptSegment['chunking_strategy'],
      created_at: new Date(row.created_at as string),
    };
  }

  private mapEmbedding(row: Record<string, unknown>): TranscriptEmbedding {
    return {
      embedding_id: row.embedding_id as string,
      asset_id: row.asset_id as string,
      version_id: row.version_id as string,
      segment_id: row.segment_id as string,
      embedding: pgvector.fromSql(row.embedding as string),
      model: row.model as string,
      dimension: row.dimension as number,
      visibility: row.visibility as Visibility,
      created_at: new Date(row.created_at as string),
    };
  }

  private mapSearchHit(row: Record<string, unknown>): SearchHit {
    return {
      asset_id: row.asset_id as string,
      start_ms: Number(row.start_ms),
      end_ms: Number(row.end_ms),
      snippet: row.snippet as string,
      score: row.score as number,
      speaker: row.speaker as string | null,
      asset: {
        bucket: row.bucket as string,
        object_key: row.object_key as string,
      },
    };
  }

  private mapDLQItem(row: Record<string, unknown>): DLQItem {
    return {
      dlq_id: row.dlq_id as string,
      job: JSON.parse(row.job_data as string),
      asset_id: row.asset_id as string,
      version_id: row.version_id as string,
      error: {
        code: row.error_code as string,
        message: row.error_message as string,
        retryable: row.error_retryable as boolean,
      },
      logs: row.logs as string[],
      created_at: new Date(row.created_at as string),
    };
  }
}

export * from './migrate.js';
