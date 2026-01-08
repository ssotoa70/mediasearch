/**
 * Ingest Service Implementation
 *
 * Handles S3 events and creates transcription jobs per PRD Section 5.2:
 *
 * ObjectCreated:
 * 1. Validate media format (wav, mp3, aac, flac, mp4, mov, mxf)
 * 2. Check for existing asset (by bucket + object_key)
 * 3. Compute strong version_id from etag + size + mtime
 * 4. Create asset/version with STAGING visibility
 * 5. Enqueue transcription job
 *
 * ObjectRemoved:
 * 1. Find asset by bucket + object_key
 * 2. Mark asset as tombstone
 * 3. Soft-delete all segments and embeddings (visibility = SOFT_DELETED)
 */

import { randomUUID } from 'crypto';
import {
  DatabasePort,
  QueuePort,
  StoragePort,
  MediaAsset,
  AssetVersion,
  TranscriptionJob,
  S3Event,
  S3EventType,
  AssetStatus,
  Visibility,
  ASREngine,
  DEFAULT_ENGINE_POLICY,
  isSupportedMediaFormat,
  computeVersionId,
} from '@mediasearch/domain';
import { Adapters, initializeAdapters, closeAdapters } from './adapters.js';

export interface IngestStats {
  objectsCreated: number;
  objectsRemoved: number;
  jobsEnqueued: number;
  errors: number;
}

export class IngestService {
  private adapters: Adapters;
  private stats: IngestStats = {
    objectsCreated: 0,
    objectsRemoved: 0,
    jobsEnqueued: 0,
    errors: 0,
  };

  constructor(adapters: Adapters) {
    this.adapters = adapters;
  }

  /**
   * Initialize all adapters
   */
  async initialize(): Promise<void> {
    await initializeAdapters(this.adapters);
    console.log('[Ingest] All adapters initialized');
  }

  /**
   * Start listening for S3 bucket notifications
   */
  async startNotificationSubscription(bucket: string): Promise<void> {
    console.log(`[Ingest] Subscribing to notifications for bucket: ${bucket}`);

    await this.adapters.storage.subscribeToNotifications(bucket, async (event: S3Event) => {
      try {
        if (event.event_type === S3EventType.OBJECT_CREATED) {
          await this.handleObjectCreated(
            event.bucket,
            event.object_key,
            event.etag,
            event.size
          );
        } else if (event.event_type === S3EventType.OBJECT_REMOVED) {
          await this.handleObjectRemoved(event.bucket, event.object_key);
        }
      } catch (error) {
        console.error('[Ingest] Error processing S3 event:', error);
        this.stats.errors++;
      }
    });
  }

  /**
   * Handle ObjectCreated event
   */
  async handleObjectCreated(
    bucket: string,
    objectKey: string,
    etag?: string,
    size?: number
  ): Promise<void> {
    console.log(`[Ingest] ObjectCreated: ${bucket}/${objectKey}`);

    // 1. Validate media format
    if (!isSupportedMediaFormat(objectKey)) {
      console.log(`[Ingest] Skipping non-media file: ${objectKey}`);
      return;
    }

    // 2. Get object metadata if not provided
    let metadata;
    if (!etag || size === undefined) {
      metadata = await this.adapters.storage.getObjectMetadata(bucket, objectKey);
      etag = metadata.etag;
      size = metadata.size;
    } else {
      metadata = await this.adapters.storage.getObjectMetadata(bucket, objectKey);
    }

    // 3. Compute strong version ID
    const versionId = computeVersionId(etag, size, metadata.lastModified);

    // 4. Check for existing asset
    let asset = await this.adapters.database.getAssetByKey(bucket, objectKey);

    const tx = await this.adapters.database.beginTransaction();

    try {
      await tx.execute(async () => {
        if (asset) {
          // Asset exists - check if this is a new version
          const existingVersion = await this.adapters.database.getVersion(versionId);
          if (existingVersion) {
            // Already processed this exact version (idempotent)
            console.log(`[Ingest] Version ${versionId} already exists - skipping`);
            return;
          }

          console.log(`[Ingest] New version for existing asset: ${asset.asset_id}`);
        } else {
          // New asset
          const assetId = randomUUID();
          const lineageId = randomUUID();

          asset = {
            asset_id: assetId,
            lineage_id: lineageId,
            bucket,
            object_key: objectKey,
            current_version_id: null, // Will be set after transcription completes
            status: AssetStatus.INGESTED,
            triage_state: null,
            recommended_action: null,
            transcription_engine: this.selectEngine(),
            last_error: null,
            attempt: 0,
            ingest_time: new Date(),
            updated_at: new Date(),
            file_size: size,
            content_type: metadata.contentType,
            etag,
            tombstone: false,
            codec_info: null,
            duration_ms: null,
          };

          asset = await this.adapters.database.upsertAsset(asset);
          console.log(`[Ingest] Created new asset: ${asset.asset_id}`);
        }

        // 5. Create new version with STAGING visibility
        const version: AssetVersion = {
          version_id: versionId,
          asset_id: asset.asset_id,
          status: AssetStatus.INGESTED,
          publish_state: Visibility.STAGING,
          created_at: new Date(),
          etag,
          file_size: size,
        };

        await this.adapters.database.createVersion(version);
        console.log(`[Ingest] Created version: ${versionId}`);

        // 6. Enqueue transcription job
        const job: TranscriptionJob = {
          job_id: randomUUID(),
          asset_id: asset.asset_id,
          version_id: versionId,
          engine_policy: {
            ...DEFAULT_ENGINE_POLICY,
            engine: asset.transcription_engine,
          },
          attempt: 0,
          idempotency_key: `${asset.asset_id}:${versionId}:0`,
          enqueued_at: new Date(),
          scheduled_at: new Date(),
        };

        await this.adapters.queue.enqueueJob(job);
        console.log(`[Ingest] Enqueued job: ${job.job_id}`);

        this.stats.objectsCreated++;
        this.stats.jobsEnqueued++;
      });
    } catch (error) {
      console.error(`[Ingest] Transaction failed:`, error);
      throw error;
    }
  }

  /**
   * Handle ObjectRemoved event
   */
  async handleObjectRemoved(bucket: string, objectKey: string): Promise<void> {
    console.log(`[Ingest] ObjectRemoved: ${bucket}/${objectKey}`);

    // 1. Find asset by bucket + object_key
    const asset = await this.adapters.database.getAssetByKey(bucket, objectKey);

    if (!asset) {
      console.log(`[Ingest] No asset found for ${bucket}/${objectKey} - ignoring`);
      return;
    }

    // 2. Mark asset as tombstone
    await this.adapters.database.tombstoneAsset(asset.asset_id);
    console.log(`[Ingest] Marked asset ${asset.asset_id} as tombstone`);

    // 3. Soft-delete all segments
    await this.adapters.database.softDeleteSegments(asset.asset_id);
    console.log(`[Ingest] Soft-deleted segments for asset ${asset.asset_id}`);

    // 4. Soft-delete all embeddings
    await this.adapters.database.softDeleteEmbeddings(asset.asset_id);
    console.log(`[Ingest] Soft-deleted embeddings for asset ${asset.asset_id}`);

    this.stats.objectsRemoved++;
  }

  /**
   * Select ASR engine based on configuration
   */
  private selectEngine(): ASREngine {
    const engineEnv = process.env.ASR_ENGINE?.toUpperCase();

    switch (engineEnv) {
      case 'NVIDIA_NIMS':
        return ASREngine.NVIDIA_NIMS;
      case 'WHISPER':
        return ASREngine.WHISPER;
      case 'BYO':
        return ASREngine.BYO;
      case 'STUB':
        return ASREngine.STUB;
      default:
        // Default to STUB for local dev, NVIDIA_NIMS for production
        return process.env.BACKEND === 'vast'
          ? ASREngine.NVIDIA_NIMS
          : ASREngine.STUB;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const results = await Promise.all([
        this.adapters.database.healthCheck(),
        this.adapters.queue.healthCheck(),
        this.adapters.storage.healthCheck(),
      ]);

      return results.every((r) => r);
    } catch {
      return false;
    }
  }

  /**
   * Get service statistics
   */
  getStats(): IngestStats {
    return { ...this.stats };
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    await closeAdapters(this.adapters);
    console.log('[Ingest] All connections closed');
  }
}
