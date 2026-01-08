/**
 * Local Queue Adapter using Redis + BullMQ
 *
 * This adapter implements the QueuePort interface for local development.
 * In production, VAST DataEngine provides internal queue via DataBase tables.
 *
 * Features:
 * - Job enqueuing with optional delay (for backoff retries)
 * - Concurrent job processing
 * - Dead letter queue support
 * - Job acknowledgment/negative acknowledgment
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import {
  QueuePort,
  ConsumeOptions,
  QueueConsumer,
  QueueStats,
  TranscriptionJob,
} from '@mediasearch/domain';

const QUEUE_NAME = 'mediasearch:transcription';
const DLQ_NAME = 'mediasearch:dlq';

export interface LocalQueueConfig {
  /** Redis host */
  host: string;

  /** Redis port */
  port: number;

  /** Redis password (optional) */
  password?: string;

  /** Redis database number */
  db?: number;

  /** Default job timeout in ms */
  defaultTimeout?: number;

  /** Default concurrency */
  defaultConcurrency?: number;
}

/**
 * Local Queue adapter using Redis/BullMQ for development
 */
export class LocalQueueAdapter implements QueuePort {
  private config: LocalQueueConfig;
  private connection: Redis | null = null;
  private queue: Queue | null = null;
  private dlqQueue: Queue | null = null;
  private worker: Worker | null = null;
  private queueEvents: QueueEvents | null = null;

  constructor(config: LocalQueueConfig) {
    this.config = {
      defaultTimeout: 600000, // 10 minutes
      defaultConcurrency: 4,
      ...config,
    };
  }

  /**
   * Initialize Redis connection and queues
   */
  async initialize(): Promise<void> {
    this.connection = new Redis({
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
      db: this.config.db,
      maxRetriesPerRequest: null, // Required for BullMQ
    });

    const connectionOpts = {
      connection: this.connection,
    };

    this.queue = new Queue(QUEUE_NAME, connectionOpts);
    this.dlqQueue = new Queue(DLQ_NAME, connectionOpts);
    this.queueEvents = new QueueEvents(QUEUE_NAME, connectionOpts);

    console.log(`[LocalQueue] Connected to Redis at ${this.config.host}:${this.config.port}`);
  }

  // ==================== Job Enqueuing ====================

  async enqueueJob(job: TranscriptionJob): Promise<void> {
    if (!this.queue) {
      throw new Error('[LocalQueue] Queue not initialized');
    }

    await this.queue.add(job.job_id, job, {
      jobId: job.job_id,
      removeOnComplete: false,
      removeOnFail: false,
    });

    console.log(`[LocalQueue] Enqueued job ${job.job_id} for asset ${job.asset_id}`);
  }

  async enqueueJobWithDelay(job: TranscriptionJob, delayMs: number): Promise<void> {
    if (!this.queue) {
      throw new Error('[LocalQueue] Queue not initialized');
    }

    await this.queue.add(job.job_id, job, {
      jobId: job.job_id,
      delay: delayMs,
      removeOnComplete: false,
      removeOnFail: false,
    });

    console.log(
      `[LocalQueue] Enqueued job ${job.job_id} with ${delayMs}ms delay (attempt ${job.attempt})`
    );
  }

  // ==================== Job Consumption ====================

  async consume(
    handler: (job: TranscriptionJob) => Promise<void>,
    options?: ConsumeOptions
  ): Promise<QueueConsumer> {
    if (!this.connection) {
      throw new Error('[LocalQueue] Connection not initialized');
    }

    const concurrency = options?.concurrency ?? this.config.defaultConcurrency;
    const timeout = options?.timeout ?? this.config.defaultTimeout;

    this.worker = new Worker(
      QUEUE_NAME,
      async (bullJob: Job<TranscriptionJob>) => {
        const job = bullJob.data;
        console.log(`[LocalQueue] Processing job ${job.job_id}`);

        try {
          await handler(job);
          console.log(`[LocalQueue] Job ${job.job_id} completed`);
        } catch (error) {
          console.error(`[LocalQueue] Job ${job.job_id} failed:`, error);
          throw error;
        }
      },
      {
        connection: this.connection,
        concurrency,
        lockDuration: timeout,
      }
    );

    this.worker.on('error', (err) => {
      console.error('[LocalQueue] Worker error:', err);
    });

    console.log(`[LocalQueue] Started consuming with concurrency=${concurrency}`);

    return {
      stop: async () => {
        if (this.worker) {
          await this.worker.close();
          this.worker = null;
        }
      },
    };
  }

  // ==================== Job Acknowledgment ====================

  async ackJob(jobId: string): Promise<void> {
    if (!this.queue) {
      throw new Error('[LocalQueue] Queue not initialized');
    }

    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.remove();
    }
  }

  async nackJob(jobId: string): Promise<void> {
    if (!this.queue) {
      throw new Error('[LocalQueue] Queue not initialized');
    }

    const job = await this.queue.getJob(jobId);
    if (job) {
      // Move job back to waiting state
      await job.moveToFailed(new Error('NACK - job returned to queue'), 'NACK');
      await job.retry();
    }
  }

  // ==================== Dead Letter Queue ====================

  async moveToDLQ(job: TranscriptionJob, error: Error): Promise<void> {
    if (!this.dlqQueue || !this.queue) {
      throw new Error('[LocalQueue] Queues not initialized');
    }

    // Add to DLQ with error info
    await this.dlqQueue.add(
      job.job_id,
      {
        ...job,
        error_message: error.message,
        error_stack: error.stack,
        moved_to_dlq_at: new Date().toISOString(),
      },
      {
        jobId: `dlq_${job.job_id}`,
      }
    );

    // Remove from main queue
    const bullJob = await this.queue.getJob(job.job_id);
    if (bullJob) {
      await bullJob.remove();
    }

    console.log(`[LocalQueue] Moved job ${job.job_id} to DLQ: ${error.message}`);
  }

  // ==================== Queue Statistics ====================

  async getStats(): Promise<QueueStats> {
    if (!this.queue || !this.dlqQueue) {
      throw new Error('[LocalQueue] Queues not initialized');
    }

    const [waiting, active, completed, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
    ]);

    const dlqWaiting = await this.dlqQueue.getWaitingCount();

    return {
      waiting,
      active,
      completed,
      failed,
      deadLetter: dlqWaiting,
    };
  }

  // ==================== Health & Cleanup ====================

  async healthCheck(): Promise<boolean> {
    if (!this.connection) return false;

    try {
      const result = await this.connection.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }

    if (this.queueEvents) {
      await this.queueEvents.close();
      this.queueEvents = null;
    }

    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }

    if (this.dlqQueue) {
      await this.dlqQueue.close();
      this.dlqQueue = null;
    }

    if (this.connection) {
      await this.connection.quit();
      this.connection = null;
    }

    console.log('[LocalQueue] Closed all connections');
  }
}

/**
 * Create local queue adapter from environment variables
 */
export function createLocalQueueAdapter(): LocalQueueAdapter {
  const config: LocalQueueConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    defaultTimeout: parseInt(process.env.JOB_TIMEOUT_MS || '600000', 10),
    defaultConcurrency: parseInt(process.env.JOB_CONCURRENCY || '4', 10),
  };

  return new LocalQueueAdapter(config);
}
