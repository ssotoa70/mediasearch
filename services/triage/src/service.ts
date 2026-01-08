/**
 * Triage Service Implementation
 *
 * Manages quarantined assets and DLQ items per PRD Section 16.
 */

import { randomUUID } from 'crypto';
import {
  DatabasePort,
  QueuePort,
  MediaAsset,
  DLQItem,
  TranscriptionJob,
  AssetStatus,
  TriageState,
  ASREngine,
  DEFAULT_ENGINE_POLICY,
} from '@mediasearch/domain';
import { Adapters, initializeAdapters, closeAdapters } from './adapters.js';

export interface TriageStats {
  quarantinedAssets: number;
  dlqItems: number;
  retriedCount: number;
  skippedCount: number;
}

export interface QuarantinedAsset {
  asset_id: string;
  bucket: string;
  object_key: string;
  triage_state: TriageState | null;
  recommended_action: string | null;
  last_error: string | null;
  attempt: number;
  ingest_time: Date;
}

export class TriageService {
  private adapters: Adapters;
  private stats: TriageStats = {
    quarantinedAssets: 0,
    dlqItems: 0,
    retriedCount: 0,
    skippedCount: 0,
  };

  constructor(adapters: Adapters) {
    this.adapters = adapters;
  }

  async initialize(): Promise<void> {
    await initializeAdapters(this.adapters);
    console.log('[Triage] Service initialized');
  }

  /**
   * List quarantined assets
   */
  async listQuarantined(limit: number, state?: string): Promise<QuarantinedAsset[]> {
    // Query assets with status = QUARANTINED
    const dlqItems = await this.adapters.database.getDLQItems(limit);

    // Get unique asset IDs
    const assetIds = [...new Set(dlqItems.map((item) => item.asset_id))];

    const assets: QuarantinedAsset[] = [];
    for (const assetId of assetIds) {
      const asset = await this.adapters.database.getAsset(assetId);
      if (asset && asset.status === AssetStatus.QUARANTINED) {
        if (!state || asset.triage_state === state) {
          assets.push({
            asset_id: asset.asset_id,
            bucket: asset.bucket,
            object_key: asset.object_key,
            triage_state: asset.triage_state,
            recommended_action: asset.recommended_action,
            last_error: asset.last_error,
            attempt: asset.attempt,
            ingest_time: asset.ingest_time,
          });
        }
      }
    }

    this.stats.quarantinedAssets = assets.length;
    return assets.slice(0, limit);
  }

  /**
   * List DLQ items
   */
  async listDLQ(limit: number): Promise<DLQItem[]> {
    const items = await this.adapters.database.getDLQItems(limit);
    this.stats.dlqItems = items.length;
    return items;
  }

  /**
   * Retry a quarantined asset
   */
  async retryAsset(assetId: string, engineOverride?: string): Promise<void> {
    const asset = await this.adapters.database.getAsset(assetId);
    if (!asset) {
      throw new Error(`Asset ${assetId} not found`);
    }

    if (asset.status !== AssetStatus.QUARANTINED) {
      throw new Error(`Asset ${assetId} is not quarantined (status: ${asset.status})`);
    }

    // Determine engine to use
    let engine = asset.transcription_engine;
    if (engineOverride) {
      engine = engineOverride.toUpperCase() as ASREngine;
    }

    // Get the version that failed
    const versionId = asset.current_version_id;
    if (!versionId) {
      throw new Error(`Asset ${assetId} has no version to retry`);
    }

    // Create new transcription job
    const job: TranscriptionJob = {
      job_id: randomUUID(),
      asset_id: assetId,
      version_id: versionId,
      engine_policy: {
        ...DEFAULT_ENGINE_POLICY,
        engine,
      },
      attempt: 0, // Reset attempt counter
      idempotency_key: `${assetId}:${versionId}:retry:${Date.now()}`,
      enqueued_at: new Date(),
      scheduled_at: new Date(),
    };

    // Update asset status
    await this.adapters.database.updateAssetStatus(assetId, AssetStatus.PENDING_RETRY, {
      triageState: null,
      lastError: null,
      attempt: 0,
    });

    // Enqueue job
    await this.adapters.queue.enqueueJob(job);

    this.stats.retriedCount++;
    console.log(`[Triage] Retrying asset ${assetId} with engine ${engine}`);
  }

  /**
   * Skip a quarantined asset (mark as permanently failed)
   */
  async skipAsset(assetId: string, reason?: string): Promise<void> {
    const asset = await this.adapters.database.getAsset(assetId);
    if (!asset) {
      throw new Error(`Asset ${assetId} not found`);
    }

    // Mark as permanently failed (tombstone but not deleted)
    await this.adapters.database.updateAssetStatus(assetId, AssetStatus.FAILED, {
      lastError: reason || 'Skipped by operator',
      triageState: null,
    });

    // Remove from DLQ
    const dlqItems = await this.adapters.database.getDLQItems(1000);
    for (const item of dlqItems) {
      if (item.asset_id === assetId) {
        await this.adapters.database.removeDLQItem(item.dlq_id);
      }
    }

    this.stats.skippedCount++;
    console.log(`[Triage] Skipped asset ${assetId}: ${reason || 'No reason provided'}`);
  }

  /**
   * Remove a DLQ item
   */
  async removeDLQItem(dlqId: string): Promise<void> {
    await this.adapters.database.removeDLQItem(dlqId);
    console.log(`[Triage] Removed DLQ item ${dlqId}`);
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

  getStats(): TriageStats {
    return { ...this.stats };
  }

  async close(): Promise<void> {
    await closeAdapters(this.adapters);
    console.log('[Triage] Service closed');
  }
}
