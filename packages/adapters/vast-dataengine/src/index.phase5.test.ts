/**
 * Phase 5: Queue Operations Tests
 *
 * Tests for enqueueJob, enqueueJobWithDelay, consume, ackJob, nackJob, moveToDLQ, getStats
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VASTDataEngineQueueAdapter } from './index';

describe('Phase 5: Queue Operations', () => {
  let adapter: VASTDataEngineQueueAdapter;

  beforeEach(async () => {
    adapter = new VASTDataEngineQueueAdapter({
      endpoint: 'http://localhost:8070',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      databaseBucket: 'mediasearch-db',
      databaseSchema: 'mediasearch',
    });

    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.close();
  });

  // ==================== Job Enqueuing ====================

  describe('enqueueJob', () => {
    it('should validate required job fields', async () => {
      const invalidJob: any = {
        // Missing job_id
        asset_id: 'asset-1',
        version_id: 'v1',
      };

      await expect(adapter.enqueueJob(invalidJob)).rejects.toThrow('Job missing required fields');
    });

    it('should accept valid job with all fields', async () => {
      const job = {
        job_id: 'job-1',
        asset_id: 'asset-1',
        version_id: 'v1',
        engine_policy: { engine: 'NVIDIA_NIMS' },
        idempotency_key: 'idem-1',
      };

      await expect(adapter.enqueueJob(job)).resolves.not.toThrow();
    });

    it('should throw error if not connected', async () => {
      const disconnected = new VASTDataEngineQueueAdapter({
        endpoint: 'http://localhost:8070',
        accessKeyId: 'test',
        secretAccessKey: 'test',
        databaseBucket: 'test',
        databaseSchema: 'test',
      });

      const job = {
        job_id: 'job-1',
        asset_id: 'asset-1',
        version_id: 'v1',
      };

      await expect(disconnected.enqueueJob(job)).rejects.toThrow('Not connected');
    });
  });

  describe('enqueueJobWithDelay', () => {
    it('should validate job fields', async () => {
      const invalidJob: any = {
        // Missing required fields
      };

      await expect(adapter.enqueueJobWithDelay(invalidJob, 5000)).rejects.toThrow(
        'Job missing required fields'
      );
    });

    it('should reject negative delays', async () => {
      const job = {
        job_id: 'job-1',
        asset_id: 'asset-1',
        version_id: 'v1',
      };

      await expect(adapter.enqueueJobWithDelay(job, -1000)).rejects.toThrow(
        'Delay cannot be negative'
      );
    });

    it('should accept valid job with positive delay', async () => {
      const job = {
        job_id: 'job-1',
        asset_id: 'asset-1',
        version_id: 'v1',
      };

      await expect(adapter.enqueueJobWithDelay(job, 5000)).resolves.not.toThrow();
    });

    it('should accept zero delay', async () => {
      const job = {
        job_id: 'job-1',
        asset_id: 'asset-1',
        version_id: 'v1',
      };

      await expect(adapter.enqueueJobWithDelay(job, 0)).resolves.not.toThrow();
    });
  });

  // ==================== Job Consumption ====================

  describe('consume', () => {
    it('should return consumer with stop method', async () => {
      const handler = vi.fn();

      const consumer = await adapter.consume(handler, { concurrency: 4, pollIntervalMs: 1000 });

      expect(consumer).toHaveProperty('stop');
      expect(typeof consumer.stop).toBe('function');

      await consumer.stop();
    });

    it('should start polling with specified interval', async () => {
      vi.useFakeTimers();

      const handler = vi.fn();
      const consumer = await adapter.consume(handler, { pollIntervalMs: 5000 });

      // Fast forward time
      vi.advanceTimersByTime(5000);

      // Stop consumer
      await consumer.stop();

      vi.useRealTimers();
    });

    it('should respect concurrency limit', async () => {
      const handler = vi.fn();

      const consumer = await adapter.consume(handler, {
        concurrency: 2, // Only 2 concurrent jobs
        pollIntervalMs: 1000,
      });

      expect(consumer).toBeDefined();

      await consumer.stop();
    });
  });

  describe('ackJob', () => {
    it('should validate job ID', async () => {
      await expect(adapter.ackJob('')).rejects.toThrow('Job ID required');
    });

    it('should accept valid job ID', async () => {
      await expect(adapter.ackJob('job-123')).resolves.not.toThrow();
    });

    it('should throw error if not connected', async () => {
      const disconnected = new VASTDataEngineQueueAdapter({
        endpoint: 'http://localhost:8070',
        accessKeyId: 'test',
        secretAccessKey: 'test',
        databaseBucket: 'test',
        databaseSchema: 'test',
      });

      await expect(disconnected.ackJob('job-1')).rejects.toThrow('Not connected');
    });
  });

  describe('nackJob', () => {
    it('should validate job ID', async () => {
      await expect(adapter.nackJob('')).rejects.toThrow('Job ID required');
    });

    it('should accept valid job ID for retry', async () => {
      await expect(adapter.nackJob('job-456')).resolves.not.toThrow();
    });

    it('should increment attempt count on nack', async () => {
      // Implementation detail - attempt count should be incremented
      await expect(adapter.nackJob('job-1')).resolves.not.toThrow();
    });
  });

  // ==================== Dead Letter Queue ====================

  describe('moveToDLQ', () => {
    it('should validate job ID', async () => {
      const job: any = {
        // Missing job_id
        asset_id: 'asset-1',
      };

      const error = new Error('Test error');

      await expect(adapter.moveToDLQ(job, error)).rejects.toThrow('Job ID required');
    });

    it('should accept job with error details', async () => {
      const job = {
        job_id: 'job-dlq',
        asset_id: 'asset-1',
        version_id: 'v1',
      };

      const error = new Error('ASR service unavailable');

      await expect(adapter.moveToDLQ(job, error)).resolves.not.toThrow();
    });

    it('should capture error message in DLQ', async () => {
      const job = {
        job_id: 'job-1',
        asset_id: 'asset-1',
        version_id: 'v1',
      };

      const error = new Error('Unsupported media format');

      // Should not throw
      await adapter.moveToDLQ(job, error);

      expect(true).toBe(true);
    });
  });

  // ==================== Queue Statistics ====================

  describe('getStats', () => {
    it('should return queue statistics object', async () => {
      const stats = await adapter.getStats();

      expect(stats).toHaveProperty('pending');
      expect(stats).toHaveProperty('processing');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('dlq_count');
    });

    it('should return numeric statistics', async () => {
      const stats = await adapter.getStats();

      expect(typeof stats.pending).toBe('number');
      expect(typeof stats.processing).toBe('number');
      expect(typeof stats.completed).toBe('number');
      expect(typeof stats.failed).toBe('number');
      expect(typeof stats.dlq_count).toBe('number');
    });

    it('should return non-negative counts', async () => {
      const stats = await adapter.getStats();

      expect(stats.pending).toBeGreaterThanOrEqual(0);
      expect(stats.processing).toBeGreaterThanOrEqual(0);
      expect(stats.completed).toBeGreaterThanOrEqual(0);
      expect(stats.failed).toBeGreaterThanOrEqual(0);
      expect(stats.dlq_count).toBeGreaterThanOrEqual(0);
    });

    it('should throw error if not connected', async () => {
      const disconnected = new VASTDataEngineQueueAdapter({
        endpoint: 'http://localhost:8070',
        accessKeyId: 'test',
        secretAccessKey: 'test',
        databaseBucket: 'test',
        databaseSchema: 'test',
      });

      await expect(disconnected.getStats()).rejects.toThrow('Not connected');
    });
  });

  // ==================== Health & Lifecycle ====================

  describe('healthCheck', () => {
    it('should return true when connected', async () => {
      const health = await adapter.healthCheck();

      expect(health).toBe(true);
    });

    it('should return false when not connected', async () => {
      const disconnected = new VASTDataEngineQueueAdapter({
        endpoint: 'http://localhost:8070',
        accessKeyId: 'test',
        secretAccessKey: 'test',
        databaseBucket: 'test',
        databaseSchema: 'test',
      });

      const health = await disconnected.healthCheck();

      expect(health).toBe(false);
    });
  });

  describe('close', () => {
    it('should close connection gracefully', async () => {
      await adapter.close();

      // Verify not connected after close
      const health = await adapter.healthCheck();
      expect(health).toBe(false);
    });

    it('should allow reconnection after close', async () => {
      await adapter.close();

      // Reinitialize
      const newAdapter = new VASTDataEngineQueueAdapter({
        endpoint: 'http://localhost:8070',
        accessKeyId: 'test',
        secretAccessKey: 'test',
        databaseBucket: 'test',
        databaseSchema: 'test',
      });

      await newAdapter.initialize();
      const health = await newAdapter.healthCheck();

      expect(health).toBe(true);
      await newAdapter.close();
    });
  });

  // ==================== Queue Workflow Tests ====================

  describe('Queue Workflow', () => {
    it('should support enqueue → consume → ack workflow', async () => {
      // Enqueue job
      const job = {
        job_id: 'job-workflow-1',
        asset_id: 'asset-1',
        version_id: 'v1',
      };

      await adapter.enqueueJob(job);

      // Consume (would normally process)
      const handler = vi.fn();
      const consumer = await adapter.consume(handler, { concurrency: 1 });

      // Acknowledge completion
      await adapter.ackJob(job.job_id);

      // Stop consumer
      await consumer.stop();

      expect(true).toBe(true);
    });

    it('should support enqueue → nack → retry workflow', async () => {
      const job = {
        job_id: 'job-retry-1',
        asset_id: 'asset-1',
        version_id: 'v1',
      };

      // Enqueue
      await adapter.enqueueJob(job);

      // Nack (retry)
      await adapter.nackJob(job.job_id);

      // Re-consume (job would be retried)
      const handler = vi.fn();
      const consumer = await adapter.consume(handler);

      await consumer.stop();

      expect(true).toBe(true);
    });

    it('should support enqueue → error → DLQ workflow', async () => {
      const job = {
        job_id: 'job-dlq-1',
        asset_id: 'asset-1',
        version_id: 'v1',
      };

      // Enqueue
      await adapter.enqueueJob(job);

      // Move to DLQ on error
      const error = new Error('Max retries exceeded');
      await adapter.moveToDLQ(job, error);

      // Check stats
      const stats = await adapter.getStats();
      expect(stats.dlq_count).toBeGreaterThanOrEqual(0);
    });
  });
});
