/**
 * Orchestrator Service Implementation
 *
 * Processes transcription jobs through the pipeline:
 *
 * 1. Fetch media from S3
 * 2. Transcribe with ASR engine
 * 3. Segment transcription (sentence-level or fixed-window fallback)
 * 4. Generate embeddings for each segment
 * 5. Store segments and embeddings with STAGING visibility
 * 6. Publish version (atomic flip from STAGING to ACTIVE)
 *
 * Error handling (PRD Section 16):
 * - Retryable errors use exponential backoff with jitter
 * - Non-retryable errors immediately move to DLQ
 * - After MAX_RETRY_ATTEMPTS, job goes to DLQ with triage_state
 */

import { randomUUID } from 'crypto';
import {
  DatabasePort,
  QueuePort,
  StoragePort,
  ASRPort,
  EmbeddingPort,
  TranscriptionJob,
  TranscriptSegment,
  TranscriptEmbedding,
  AssetStatus,
  Visibility,
  TriageState,
  ChunkingStrategy,
  ASRResult,
  QueueConsumer,
  calculateBackoffDelay,
  MAX_RETRY_ATTEMPTS,
  createFixedWindowSegments,
} from '@mediasearch/domain';
import { Adapters, initializeAdapters, closeAdapters } from './adapters.js';

export interface OrchestratorStats {
  jobsProcessed: number;
  jobsSucceeded: number;
  jobsFailed: number;
  jobsRetried: number;
  jobsDLQ: number;
}

export class OrchestratorService {
  private adapters: Adapters;
  private consumer: QueueConsumer | null = null;
  private paused: boolean = false;
  private stats: OrchestratorStats = {
    jobsProcessed: 0,
    jobsSucceeded: 0,
    jobsFailed: 0,
    jobsRetried: 0,
    jobsDLQ: 0,
  };

  constructor(adapters: Adapters) {
    this.adapters = adapters;
  }

  async initialize(): Promise<void> {
    await initializeAdapters(this.adapters);
    console.log('[Orchestrator] Adapters initialized');
  }

  async startProcessing(): Promise<void> {
    const concurrency = parseInt(process.env.JOB_CONCURRENCY || '4', 10);
    const timeout = parseInt(process.env.JOB_TIMEOUT_MS || '600000', 10);

    console.log(`[Orchestrator] Starting job processing (concurrency=${concurrency})`);

    this.consumer = await this.adapters.queue.consume(
      async (job) => this.processJob(job),
      { concurrency, timeout }
    );
  }

  async pause(): Promise<void> {
    this.paused = true;
    console.log('[Orchestrator] Processing paused');
  }

  async resume(): Promise<void> {
    this.paused = false;
    console.log('[Orchestrator] Processing resumed');
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.stop();
      this.consumer = null;
    }
    await closeAdapters(this.adapters);
    console.log('[Orchestrator] Stopped');
  }

  /**
   * Process a single transcription job
   */
  private async processJob(job: TranscriptionJob): Promise<void> {
    if (this.paused) {
      // Requeue job if paused
      await this.adapters.queue.nackJob(job.job_id);
      return;
    }

    console.log(`[Orchestrator] Processing job ${job.job_id} (attempt ${job.attempt + 1})`);
    this.stats.jobsProcessed++;

    try {
      // Check idempotency - has this version already been processed?
      const isProcessed = await this.adapters.database.isVersionProcessed(job.version_id);
      if (isProcessed) {
        console.log(`[Orchestrator] Version ${job.version_id} already processed - skipping`);
        await this.adapters.queue.ackJob(job.job_id);
        return;
      }

      // Update asset status to TRANSCRIBING
      await this.adapters.database.updateAssetStatus(job.asset_id, AssetStatus.TRANSCRIBING);

      // 1. Get asset metadata
      const asset = await this.adapters.database.getAsset(job.asset_id);
      if (!asset) {
        throw new Error(`Asset ${job.asset_id} not found`);
      }

      // 2. Fetch media from S3
      console.log(`[Orchestrator] Fetching media from ${asset.bucket}/${asset.object_key}`);
      const mediaBuffer = await this.adapters.storage.getObject(asset.bucket, asset.object_key);

      // 3. Transcribe with ASR engine
      console.log(`[Orchestrator] Transcribing with engine ${job.engine_policy.engine}`);
      const asrResult = await this.adapters.asr.transcribe(mediaBuffer, {
        diarization: job.engine_policy.diarization_enabled,
        executionMode: job.engine_policy.execution_mode,
        contentType: asset.content_type,
        durationHint: asset.duration_ms || undefined,
      });

      if (!asrResult.success) {
        throw new Error(`ASR failed: ${asrResult.error?.message}`);
      }

      // 4. Apply chunking strategy
      let segments = asrResult.segments;
      let chunkingStrategy = ChunkingStrategy.SENTENCE;

      // Check if we need to fall back to fixed-window chunking
      const durationSeconds = (asrResult.duration_ms || 0) / 1000;
      if (durationSeconds > job.engine_policy.compute_threshold_seconds) {
        console.log(`[Orchestrator] Using fixed-window chunking (duration ${durationSeconds}s)`);
        segments = createFixedWindowSegments(segments);
        chunkingStrategy = ChunkingStrategy.FIXED_WINDOW;
      }

      if (job.engine_policy.force_chunking_strategy) {
        chunkingStrategy = job.engine_policy.force_chunking_strategy;
        if (chunkingStrategy === ChunkingStrategy.FIXED_WINDOW) {
          segments = createFixedWindowSegments(asrResult.segments);
        }
      }

      // 5. Create transcript segments
      const transcriptSegments: TranscriptSegment[] = segments.map((seg, idx) => ({
        segment_id: `${job.version_id}_seg_${idx}`,
        asset_id: job.asset_id,
        version_id: job.version_id,
        start_ms: seg.start_ms,
        end_ms: seg.end_ms,
        text: seg.text,
        speaker: seg.speaker,
        confidence: seg.confidence,
        visibility: Visibility.STAGING, // Start in staging
        chunking_strategy: chunkingStrategy,
        created_at: new Date(),
      }));

      console.log(`[Orchestrator] Created ${transcriptSegments.length} segments`);

      // 6. Store segments
      await this.adapters.database.upsertSegments(transcriptSegments);

      // 7. Generate embeddings (if enabled)
      const semanticEnabled = process.env.SEMANTIC_SEARCH_ENABLED !== 'false';
      let embeddings: TranscriptEmbedding[] = [];

      if (semanticEnabled) {
        console.log(`[Orchestrator] Generating embeddings for ${transcriptSegments.length} segments`);

        const texts = transcriptSegments.map((s) => s.text);
        const vectors = await this.adapters.embedding.embedBatch(texts);

        embeddings = transcriptSegments.map((seg, idx) => ({
          embedding_id: `${seg.segment_id}_emb`,
          asset_id: job.asset_id,
          version_id: job.version_id,
          segment_id: seg.segment_id,
          embedding: vectors[idx],
          model: this.adapters.embedding.getModel(),
          dimension: vectors[idx].length,
          visibility: Visibility.STAGING, // Start in staging
          created_at: new Date(),
        }));

        await this.adapters.database.upsertEmbeddings(embeddings);
        console.log(`[Orchestrator] Stored ${embeddings.length} embeddings`);
      }

      // 8. Update version status
      await this.adapters.database.updateVersionStatus(job.version_id, AssetStatus.TRANSCRIBED);

      // 9. Publish version - atomic cutover
      await this.publishVersion(job.asset_id, job.version_id);

      // 10. Mark job complete
      await this.adapters.queue.ackJob(job.job_id);
      this.stats.jobsSucceeded++;

      console.log(`[Orchestrator] Job ${job.job_id} completed successfully`);
    } catch (error) {
      await this.handleJobError(job, error as Error);
    }
  }

  /**
   * Publish a version - flip from STAGING to ACTIVE
   * This is the atomic cutover operation described in PRD
   */
  private async publishVersion(assetId: string, versionId: string): Promise<void> {
    console.log(`[Orchestrator] Publishing version ${versionId}`);

    const tx = await this.adapters.database.beginTransaction();

    try {
      await tx.execute(async () => {
        // 1. Get current version (if any)
        const asset = await this.adapters.database.getAsset(assetId);
        const previousVersionId = asset?.current_version_id;

        // 2. Archive previous version's data
        if (previousVersionId) {
          console.log(`[Orchestrator] Archiving previous version ${previousVersionId}`);
          await this.adapters.database.updateSegmentVisibility(
            assetId,
            previousVersionId,
            Visibility.ARCHIVED
          );
          await this.adapters.database.updateEmbeddingVisibility(
            assetId,
            previousVersionId,
            Visibility.ARCHIVED
          );
        }

        // 3. Promote new version to ACTIVE
        await this.adapters.database.updateSegmentVisibility(
          assetId,
          versionId,
          Visibility.ACTIVE
        );
        await this.adapters.database.updateEmbeddingVisibility(
          assetId,
          versionId,
          Visibility.ACTIVE
        );

        // 4. Atomic pointer flip
        await this.adapters.database.setCurrentVersion(assetId, versionId);

        // 5. Update asset status
        await this.adapters.database.updateAssetStatus(assetId, AssetStatus.INDEXED);
      });

      console.log(`[Orchestrator] Version ${versionId} published successfully`);
    } catch (error) {
      console.error(`[Orchestrator] Failed to publish version:`, error);
      throw error;
    }
  }

  /**
   * Handle job processing error
   */
  private async handleJobError(job: TranscriptionJob, error: Error): Promise<void> {
    console.error(`[Orchestrator] Job ${job.job_id} failed:`, error.message);
    this.stats.jobsFailed++;

    // Check if error is retryable
    const isRetryable = this.isRetryableError(error);
    const newAttempt = job.attempt + 1;

    if (!isRetryable || newAttempt >= MAX_RETRY_ATTEMPTS) {
      // Move to DLQ
      console.log(`[Orchestrator] Moving job ${job.job_id} to DLQ (attempt ${newAttempt})`);

      const triageState = this.determineTriageState(error);
      const recommendedAction = this.getRecommendedAction(triageState);

      await this.adapters.database.updateAssetStatus(job.asset_id, AssetStatus.QUARANTINED, {
        triageState,
        lastError: error.message,
        attempt: newAttempt,
        recommendedAction,
      });

      await this.adapters.queue.moveToDLQ(job, error);
      this.stats.jobsDLQ++;
    } else {
      // Retry with exponential backoff
      const delay = calculateBackoffDelay(newAttempt);
      console.log(`[Orchestrator] Retrying job ${job.job_id} in ${delay}ms (attempt ${newAttempt})`);

      const retryJob: TranscriptionJob = {
        ...job,
        job_id: randomUUID(), // New job ID for retry
        attempt: newAttempt,
        idempotency_key: `${job.asset_id}:${job.version_id}:${newAttempt}`,
        scheduled_at: new Date(Date.now() + delay),
      };

      await this.adapters.database.updateAssetStatus(job.asset_id, AssetStatus.PENDING_RETRY, {
        lastError: error.message,
        attempt: newAttempt,
      });

      await this.adapters.queue.enqueueJobWithDelay(retryJob, delay);
      await this.adapters.queue.ackJob(job.job_id);
      this.stats.jobsRetried++;
    }
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();

    // Non-retryable: codec issues, format errors, corrupt media
    if (
      message.includes('codec') ||
      message.includes('corrupt') ||
      message.includes('invalid format') ||
      message.includes('unsupported')
    ) {
      return false;
    }

    // Retryable: network issues, timeouts, resource exhaustion
    if (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('rate limit') ||
      message.includes('busy') ||
      message.includes('unavailable')
    ) {
      return true;
    }

    // Default to retryable
    return true;
  }

  /**
   * Determine triage state based on error
   */
  private determineTriageState(error: Error): TriageState {
    const message = error.message.toLowerCase();

    if (
      message.includes('codec') ||
      message.includes('corrupt') ||
      message.includes('invalid format')
    ) {
      return TriageState.NEEDS_MEDIA_FIX;
    }

    if (
      message.includes('engine') ||
      message.includes('model') ||
      message.includes('transcription')
    ) {
      return TriageState.NEEDS_ENGINE_TUNING;
    }

    return TriageState.QUARANTINED;
  }

  /**
   * Get recommended action for triage state
   */
  private getRecommendedAction(state: TriageState): string {
    switch (state) {
      case TriageState.NEEDS_MEDIA_FIX:
        return 'Re-encode media file with supported codec or fix corruption';
      case TriageState.NEEDS_ENGINE_TUNING:
        return 'Review ASR engine configuration or try alternative engine';
      case TriageState.QUARANTINED:
        return 'Manual investigation required';
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const results = await Promise.all([
        this.adapters.database.healthCheck(),
        this.adapters.queue.healthCheck(),
      ]);
      return results.every((r) => r);
    } catch {
      return false;
    }
  }

  getStats(): OrchestratorStats {
    return { ...this.stats };
  }
}
