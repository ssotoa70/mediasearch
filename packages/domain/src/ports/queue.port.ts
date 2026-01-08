import { TranscriptionJob, DLQItem } from '../types/entities.js';

/**
 * Queue port interface
 *
 * Production: Implemented by VAST DataEngine (internal queue via DataBase tables)
 * Local: Implemented by Redis + BullMQ adapter
 *
 * Supports exponential backoff with jitter for retries (PRD Section 16)
 */
export interface QueuePort {
  /**
   * Enqueue a transcription job
   */
  enqueueJob(job: TranscriptionJob): Promise<void>;

  /**
   * Enqueue job with delay (for backoff retries)
   * @param job The job to enqueue
   * @param delayMs Delay in milliseconds before job becomes available
   */
  enqueueJobWithDelay(job: TranscriptionJob, delayMs: number): Promise<void>;

  /**
   * Consume jobs from the queue
   * Returns a processor that will be called for each job
   */
  consume(
    handler: (job: TranscriptionJob) => Promise<void>,
    options?: ConsumeOptions
  ): Promise<QueueConsumer>;

  /**
   * Acknowledge job completion (remove from queue)
   */
  ackJob(jobId: string): Promise<void>;

  /**
   * Negative acknowledge - return job to queue
   */
  nackJob(jobId: string): Promise<void>;

  /**
   * Move job to dead letter queue
   */
  moveToDLQ(job: TranscriptionJob, error: Error): Promise<void>;

  /**
   * Get queue statistics
   */
  getStats(): Promise<QueueStats>;

  /**
   * Health check
   */
  healthCheck(): Promise<boolean>;

  /**
   * Close connection
   */
  close(): Promise<void>;
}

export interface ConsumeOptions {
  /** Maximum number of concurrent jobs */
  concurrency?: number;

  /** Timeout for job processing in ms */
  timeout?: number;
}

export interface QueueConsumer {
  /** Stop consuming */
  stop(): Promise<void>;
}

export interface QueueStats {
  /** Number of jobs waiting */
  waiting: number;

  /** Number of jobs being processed */
  active: number;

  /** Number of completed jobs */
  completed: number;

  /** Number of failed jobs */
  failed: number;

  /** Number of jobs in DLQ */
  deadLetter: number;
}

/**
 * Calculate exponential backoff delay with jitter
 * As required by PRD Section 16: "Retryable failures MUST use exponential backoff"
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 300000 // 5 minutes max
): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter (±25%)
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);

  return Math.floor(cappedDelay + jitter);
}

/**
 * Maximum retry attempts before DLQ
 * As required by PRD Section 16: "Retry exhaustion MUST quarantine the asset"
 */
export const MAX_RETRY_ATTEMPTS = 5;
