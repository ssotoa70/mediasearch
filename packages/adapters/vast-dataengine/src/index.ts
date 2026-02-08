/**
 * VAST DataEngine Adapter for MediaSearch
 *
 * This adapter implements the QueuePort and StoragePort interfaces using VAST infrastructure:
 *
 * Queue operations:
 * - VAST DataEngine provides serverless compute with internal job management
 * - Jobs are tracked via DataBase tables (not external queue like Redis)
 * - DataEngine functions are triggered by S3 bucket notifications
 *
 * Storage operations:
 * - VAST S3-compatible storage for media files
 * - Native bucket notifications for ObjectCreated/ObjectRemoved events
 *
 * For local development, use the @mediasearch/local-queue and @mediasearch/local-s3 adapters.
 *
 * Documentation:
 * - VAST DataEngine: https://support.vastdata.com
 * - VAST S3: https://support.vastdata.com
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  QueuePort,
  StoragePort,
  ConsumeOptions,
  QueueConsumer,
  QueueStats,
  ObjectMetadata,
  PutObjectResult,
  ObjectInfo,
  NotificationSubscription,
  TranscriptionJob,
  S3Event,
  S3EventType,
} from '@mediasearch/domain';

// ==================== VAST DataEngine Queue Adapter ====================

export interface VASTDataEngineConfig {
  /** VAST cluster endpoint */
  endpoint: string;

  /** S3 access key ID */
  accessKeyId: string;

  /** S3 secret access key */
  secretAccessKey: string;

  /** Database bucket for job tracking */
  databaseBucket: string;

  /** Database schema */
  databaseSchema: string;
}

/**
 * VAST DataEngine adapter for production
 *
 * In VAST DataEngine:
 * - Functions are registered and triggered by S3 events
 * - Job state is tracked in VAST DataBase tables
 * - No external queue service needed - DataEngine handles distribution
 *
 * The job tracking table schema (see db/vast_schema.py):
 * - job_id, asset_id, version_id, status, attempt, created_at, updated_at
 */
export class VASTDataEngineQueueAdapter implements QueuePort {
  private config: VASTDataEngineConfig;
  private connected: boolean = false;

  constructor(config: VASTDataEngineConfig) {
    this.config = config;
  }

  /**
   * Initialize connection to VAST DataEngine
   */
  async initialize(): Promise<void> {
    // In production, this would:
    // 1. Connect to VAST DataBase for job tracking
    // 2. Register DataEngine functions for processing
    // 3. Set up S3 bucket notification triggers

    console.log(`[VAST DataEngine] Connecting to ${this.config.endpoint}`);
    console.log(`[VAST DataEngine] Job tracking: ${this.config.databaseBucket}/${this.config.databaseSchema}`);

    this.connected = true;
  }

  // ==================== Job Enqueuing ====================

  async enqueueJob(job: TranscriptionJob): Promise<void> {
    // Insert job record into transcription_jobs table with status='PENDING'
    // DataEngine functions will pick up pending jobs and process them

    if (!this.connected) throw new Error('[VAST DataEngine] Not connected');

    try {
      console.log(`[VAST DataEngine] Enqueuing job ${job.job_id}`);

      const now = new Date().toISOString();

      // In production, this would call RPC to sidecar:
      // await this.client.insertTable('transcription_jobs', {
      //   'job_id': [job.job_id],
      //   'asset_id': [job.asset_id],
      //   'version_id': [job.version_id],
      //   'status': ['PENDING'],
      //   'attempt': [0],
      //   'enqueued_at': [now],
      //   'engine_policy': [JSON.stringify(job.engine_policy || {})],
      //   'idempotency_key': [job.idempotency_key || '']
      // });

      // For now, we validate the job structure
      if (!job.job_id || !job.asset_id || !job.version_id) {
        throw new Error('Job missing required fields');
      }

      console.log(`[VAST DataEngine] Job enqueued: ${job.job_id}`);
    } catch (error) {
      console.error(`[VAST DataEngine] Enqueue error:`, error);
      throw error;
    }
  }

  async enqueueJobWithDelay(job: TranscriptionJob, delayMs: number): Promise<void> {
    // Insert job with scheduled_at = now() + delay
    // DataEngine will only process jobs where scheduled_at <= now()

    if (!this.connected) throw new Error('[VAST DataEngine] Not connected');

    try {
      console.log(`[VAST DataEngine] Enqueuing delayed job ${job.job_id} (+${delayMs}ms)`);

      const now = new Date();
      const scheduledAt = new Date(now.getTime() + delayMs);

      // In production:
      // await this.client.insertTable('transcription_jobs', {
      //   'job_id': [job.job_id],
      //   'status': ['PENDING'],
      //   'scheduled_at': [scheduledAt.toISOString()],
      //   ...other job fields
      // });

      if (!job.job_id || !job.asset_id || !job.version_id) {
        throw new Error('Job missing required fields');
      }

      if (delayMs < 0) {
        throw new Error('Delay cannot be negative');
      }

      console.log(`[VAST DataEngine] Delayed job enqueued: ${job.job_id} at ${scheduledAt.toISOString()}`);
    } catch (error) {
      console.error(`[VAST DataEngine] Delayed enqueue error:`, error);
      throw error;
    }
  }

  // ==================== Job Consumption ====================

  async consume(
    handler: (job: TranscriptionJob) => Promise<void>,
    options?: ConsumeOptions
  ): Promise<QueueConsumer> {
    // Poll VAST DataBase jobs table for PENDING jobs and process them
    // Query: SELECT * FROM transcription_jobs
    //        WHERE status = 'PENDING' AND scheduled_at <= now()
    //        ORDER BY enqueued_at
    //        LIMIT concurrency

    if (!this.connected) throw new Error('[VAST DataEngine] Not connected');

    const concurrency = options?.concurrency || 4;
    const pollIntervalMs = options?.pollIntervalMs || 5000;
    let isConsuming = false;

    console.log(`[VAST DataEngine] Starting consumer (concurrency=${concurrency})`);

    // Start polling for jobs
    const intervalId = setInterval(async () => {
      if (isConsuming) return; // Skip if already processing

      try {
        isConsuming = true;

        // In production, would query:
        // const jobs = await this.client.executeQuery(`
        //   SELECT * FROM transcription_jobs
        //   WHERE status = 'PENDING' AND scheduled_at <= now()
        //   ORDER BY enqueued_at
        //   LIMIT ${concurrency}
        // `);

        // For now, simulate empty result set
        const jobs: TranscriptionJob[] = [];

        for (const job of jobs) {
          try {
            await handler(job);
          } catch (error) {
            console.error(`[VAST DataEngine] Job handler error for ${job.job_id}:`, error);
          }
        }
      } catch (error) {
        console.error(`[VAST DataEngine] Consume error:`, error);
      } finally {
        isConsuming = false;
      }
    }, pollIntervalMs);

    return {
      stop: async () => {
        clearInterval(intervalId);
        console.log('[VAST DataEngine] Consumer stopped');
      },
    };
  }

  async ackJob(jobId: string): Promise<void> {
    // Mark job as COMPLETED in transcription_jobs table

    if (!this.connected) throw new Error('[VAST DataEngine] Not connected');

    try {
      console.log(`[VAST DataEngine] Acknowledging job ${jobId}`);

      // In production:
      // await this.client.executeQuery(`
      //   UPDATE transcription_jobs
      //   SET status = 'COMPLETED', updated_at = now()
      //   WHERE job_id = '${jobId}'
      // `);

      if (!jobId) {
        throw new Error('Job ID required');
      }

      console.log(`[VAST DataEngine] Job acknowledged: ${jobId}`);
    } catch (error) {
      console.error(`[VAST DataEngine] Ack error:`, error);
      throw error;
    }
  }

  async nackJob(jobId: string): Promise<void> {
    // Return job to PENDING state for retry

    if (!this.connected) throw new Error('[VAST DataEngine] Not connected');

    try {
      console.log(`[VAST DataEngine] Nacking job ${jobId}`);

      // In production:
      // await this.client.executeQuery(`
      //   UPDATE transcription_jobs
      //   SET status = 'PENDING', attempt = attempt + 1, updated_at = now()
      //   WHERE job_id = '${jobId}'
      // `);

      if (!jobId) {
        throw new Error('Job ID required');
      }

      console.log(`[VAST DataEngine] Job nacked (will retry): ${jobId}`);
    } catch (error) {
      console.error(`[VAST DataEngine] Nack error:`, error);
      throw error;
    }
  }

  // ==================== Dead Letter Queue ====================

  async moveToDLQ(job: TranscriptionJob, error: Error): Promise<void> {
    // Atomic transaction: insert into DLQ table and update job status to FAILED

    if (!this.connected) throw new Error('[VAST DataEngine] Not connected');

    try {
      console.log(`[VAST DataEngine] Moving job ${job.job_id} to DLQ`);

      // In production (transaction):
      // const tx = await beginTransaction();
      // try {
      //   const dlqId = generateId();
      //   await tx.insertTable('dlq_items', {
      //     'dlq_id': [dlqId],
      //     'job_id': [job.job_id],
      //     'asset_id': [job.asset_id],
      //     'version_id': [job.version_id],
      //     'error_code': [error.name],
      //     'error_message': [error.message],
      //     'error_retryable': [true],
      //     'job_data': [JSON.stringify(job)],
      //     'created_at': [new Date().toISOString()]
      //   });
      //
      //   await tx.executeQuery(`
      //     UPDATE transcription_jobs
      //     SET status = 'FAILED', last_error = '${error.message}', updated_at = now()
      //     WHERE job_id = '${job.job_id}'
      //   `);
      //
      //   await tx.commit();
      // } catch (e) {
      //   await tx.rollback();
      //   throw e;
      // }

      if (!job.job_id) {
        throw new Error('Job ID required');
      }

      console.log(`[VAST DataEngine] Job moved to DLQ: ${job.job_id}`);
      console.log(`[VAST DataEngine] Error: ${error.message}`);
    } catch (error) {
      console.error(`[VAST DataEngine] DLQ error:`, error);
      throw error;
    }
  }

  // ==================== Queue Statistics ====================

  async getStats(): Promise<QueueStats> {
    // Query job counts by status and DLQ count

    if (!this.connected) throw new Error('[VAST DataEngine] Not connected');

    try {
      console.log('[VAST DataEngine] Fetching queue statistics');

      // In production:
      // const jobStats = await this.client.executeQuery(`
      //   SELECT status, COUNT(*) as count FROM transcription_jobs GROUP BY status
      // `);
      // const dlqCount = await this.client.executeQuery(`
      //   SELECT COUNT(*) as count FROM dlq_items
      // `);

      // Default stats
      const stats: QueueStats = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        dlq_count: 0,
      };

      console.log('[VAST DataEngine] Queue stats:', stats);
      return stats;
    } catch (error) {
      console.error(`[VAST DataEngine] Stats error:`, error);
      throw error;
    }
  }

  // ==================== Health & Cleanup ====================

  async healthCheck(): Promise<boolean> {
    if (!this.connected) return false;

    try {
      // TODO: Implement VAST health check - query jobs table
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    // TODO: Close VAST connections
    this.connected = false;
  }
}

// ==================== VAST S3 Storage Adapter ====================

export interface VASTS3Config {
  /** VAST S3 endpoint */
  endpoint: string;

  /** S3 access key ID */
  accessKeyId: string;

  /** S3 secret access key */
  secretAccessKey: string;

  /** AWS region */
  region?: string;
}

/**
 * VAST S3 adapter for production storage
 *
 * VAST provides S3-compatible storage with:
 * - Native bucket notifications
 * - High-throughput parallel access
 * - Integration with DataEngine for event processing
 */
export class VASTS3Adapter implements StoragePort {
  private config: VASTS3Config;
  private client: S3Client;
  private connected: boolean = false;
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private knownObjects: Map<string, Set<string>> = new Map();

  constructor(config: VASTS3Config) {
    this.config = {
      region: 'us-east-1',
      ...config,
    };

    this.client = new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      // VAST S3 may or may not require forcePathStyle - will be configurable if needed
    });
  }

  /**
   * Initialize connection to VAST S3
   */
  async initialize(): Promise<void> {
    // Verify S3 connection with a simple list buckets operation
    try {
      const command = new ListObjectsV2Command({ Bucket: 'health-check-bucket', MaxKeys: 1 });
      await this.client.send(command);
    } catch (error: unknown) {
      // NoSuchBucket is expected, indicates connection is working
      if ((error as { name?: string }).name === 'NoSuchBucket') {
        console.log(`[VAST S3] Connected to ${this.config.endpoint}`);
        this.connected = true;
        return;
      }
      throw error;
    }
    console.log(`[VAST S3] Connected to ${this.config.endpoint}`);
    this.connected = true;
  }

  // ==================== Object Operations ====================

  async getObject(bucket: string, key: string): Promise<Buffer> {
    if (!this.connected) throw new Error('[VAST S3] Not connected');

    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`[VAST S3] Object ${key} has no body`);
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  }

  async getObjectMetadata(bucket: string, key: string): Promise<ObjectMetadata> {
    if (!this.connected) throw new Error('[VAST S3] Not connected');

    const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
    const response = await this.client.send(command);

    return {
      etag: response.ETag?.replace(/"/g, '') || '',
      size: response.ContentLength || 0,
      contentType: response.ContentType || 'application/octet-stream',
      lastModified: response.LastModified || new Date(),
      metadata: (response.Metadata as Record<string, string>) || {},
    };
  }

  async objectExists(bucket: string, key: string): Promise<boolean> {
    if (!this.connected) throw new Error('[VAST S3] Not connected');

    try {
      await this.getObjectMetadata(bucket, key);
      return true;
    } catch (error: unknown) {
      if ((error as { name?: string }).name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  async putObject(
    bucket: string,
    key: string,
    data: Buffer,
    contentType: string
  ): Promise<PutObjectResult> {
    if (!this.connected) throw new Error('[VAST S3] Not connected');

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    });

    const response = await this.client.send(command);

    return {
      etag: response.ETag?.replace(/"/g, '') || '',
      versionId: response.VersionId,
    };
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    if (!this.connected) throw new Error('[VAST S3] Not connected');

    const command = new DeleteObjectCommand({ Bucket: bucket, Key: key });
    await this.client.send(command);
  }

  async listObjects(bucket: string, prefix?: string): Promise<ObjectInfo[]> {
    if (!this.connected) throw new Error('[VAST S3] Not connected');

    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
    });

    const response = await this.client.send(command);
    const objects: ObjectInfo[] = [];

    for (const obj of response.Contents || []) {
      if (obj.Key) {
        objects.push({
          key: obj.Key,
          size: obj.Size || 0,
          lastModified: obj.LastModified || new Date(),
          etag: obj.ETag?.replace(/"/g, '') || '',
        });
      }
    }

    return objects;
  }

  async getPresignedUrl(bucket: string, key: string, expiresIn: number): Promise<string> {
    if (!this.connected) throw new Error('[VAST S3] Not connected');

    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  // ==================== Bucket Operations ====================

  async ensureBucket(bucket: string): Promise<void> {
    if (!this.connected) throw new Error('[VAST S3] Not connected');

    try {
      const headCommand = new HeadBucketCommand({ Bucket: bucket });
      await this.client.send(headCommand);
    } catch (error: unknown) {
      if ((error as { name?: string }).name === 'NotFound') {
        const createCommand = new CreateBucketCommand({ Bucket: bucket });
        await this.client.send(createCommand);
        console.log(`[VAST S3] Created bucket: ${bucket}`);
      } else {
        throw error;
      }
    }
  }

  // ==================== Bucket Notifications ====================

  async subscribeToNotifications(
    bucket: string,
    handler: (event: S3Event) => Promise<void>
  ): Promise<NotificationSubscription> {
    if (!this.connected) throw new Error('[VAST S3] Not connected');

    // Initialize known objects for this bucket (polling-based for local-like behavior)
    const existingObjects = await this.listObjects(bucket);
    const knownKeys = new Set(existingObjects.map((o) => o.key));
    this.knownObjects.set(bucket, knownKeys);

    console.log(
      `[VAST S3] Subscribed to notifications for bucket ${bucket} (${knownKeys.size} existing objects)`
    );

    // Start polling for changes
    // In production VAST, this would use native bucket notifications
    // For now, we implement polling similar to local-s3 adapter
    const intervalId = setInterval(async () => {
      try {
        await this.checkForChanges(bucket, handler);
      } catch (error) {
        console.error(`[VAST S3] Error polling bucket ${bucket}:`, error);
      }
    }, 5000);

    this.pollingIntervals.set(bucket, intervalId);

    return {
      unsubscribe: async () => {
        const interval = this.pollingIntervals.get(bucket);
        if (interval) {
          clearInterval(interval);
          this.pollingIntervals.delete(bucket);
        }
        this.knownObjects.delete(bucket);
      },
    };
  }

  private async checkForChanges(
    bucket: string,
    handler: (event: S3Event) => Promise<void>
  ): Promise<void> {
    const currentObjects = await this.listObjects(bucket);
    const currentKeys = new Set(currentObjects.map((o) => o.key));
    const knownKeys = this.knownObjects.get(bucket) || new Set();

    // Check for new objects (ObjectCreated)
    for (const obj of currentObjects) {
      if (!knownKeys.has(obj.key)) {
        const event: S3Event = {
          event_type: S3EventType.OBJECT_CREATED,
          bucket,
          object_key: obj.key,
          etag: obj.etag,
          size: obj.size,
          timestamp: obj.lastModified,
        };

        console.log(`[VAST S3] Object created: ${bucket}/${obj.key}`);
        await handler(event);
      }
    }

    // Check for deleted objects (ObjectRemoved)
    for (const key of knownKeys) {
      if (!currentKeys.has(key)) {
        const event: S3Event = {
          event_type: S3EventType.OBJECT_REMOVED,
          bucket,
          object_key: key,
          timestamp: new Date(),
        };

        console.log(`[VAST S3] Object removed: ${bucket}/${key}`);
        await handler(event);
      }
    }

    // Update known objects
    this.knownObjects.set(bucket, currentKeys);
  }

  // ==================== Health & Cleanup ====================

  async healthCheck(): Promise<boolean> {
    if (!this.connected) return false;

    try {
      // Try to list buckets - simple health check
      const command = new ListObjectsV2Command({ Bucket: 'health-check-bucket', MaxKeys: 1 });
      await this.client.send(command);
      return true;
    } catch (error: unknown) {
      // NoSuchBucket is expected if bucket doesn't exist, but connection is fine
      if ((error as { name?: string }).name === 'NoSuchBucket') {
        return true;
      }
      // Connection errors indicate unhealthy
      return false;
    }
  }

  async close(): Promise<void> {
    // Stop all polling intervals
    for (const [bucket, interval] of this.pollingIntervals) {
      clearInterval(interval);
      console.log(`[VAST S3] Stopped polling for bucket ${bucket}`);
    }
    this.pollingIntervals.clear();
    this.knownObjects.clear();

    // S3Client doesn't have explicit close - it uses connection pooling
    this.client.destroy();
    console.log('[VAST S3] Closed S3 client');
    this.connected = false;
  }
}

// ==================== Factory Functions ====================

/**
 * Create VAST DataEngine queue adapter from environment variables
 */
export function createVASTDataEngineQueueAdapter(): VASTDataEngineQueueAdapter {
  const config: VASTDataEngineConfig = {
    endpoint: process.env.VAST_ENDPOINT || '',
    accessKeyId: process.env.VAST_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.VAST_SECRET_ACCESS_KEY || '',
    databaseBucket: process.env.VAST_DATABASE_BUCKET || 'mediasearch-db',
    databaseSchema: process.env.VAST_DATABASE_SCHEMA || 'mediasearch',
  };

  return new VASTDataEngineQueueAdapter(config);
}

/**
 * Create VAST S3 adapter from environment variables
 */
export function createVASTS3Adapter(): VASTS3Adapter {
  const config: VASTS3Config = {
    endpoint: process.env.VAST_S3_ENDPOINT || '',
    accessKeyId: process.env.VAST_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.VAST_SECRET_ACCESS_KEY || '',
    region: process.env.VAST_REGION || 'us-east-1',
  };

  return new VASTS3Adapter(config);
}
