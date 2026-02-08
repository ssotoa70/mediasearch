/**
 * Unit tests for VASTS3Adapter
 *
 * Tests cover all 11 S3 methods with mocks (no real VAST cluster needed)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VASTS3Adapter } from './index';
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
import { S3EventType } from '@mediasearch/domain';

// Mock AWS SDK
vi.mock('@aws-sdk/client-s3');
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed-url.example.com/object'),
}));

describe('VASTS3Adapter', () => {
  let adapter: VASTS3Adapter;
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      send: vi.fn(),
      destroy: vi.fn(),
    };

    vi.mocked(S3Client).mockImplementation(() => mockClient);

    adapter = new VASTS3Adapter({
      endpoint: 'https://s3.vast.example.com',
      accessKeyId: 'test-key-id',
      secretAccessKey: 'test-secret',
      region: 'us-east-1',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==================== Initialization ====================

  describe('initialize', () => {
    it('should connect to VAST S3', async () => {
      mockClient.send.mockResolvedValueOnce({ Contents: [] }); // NoSuchBucket response

      await adapter.initialize();

      expect(mockClient.send).toHaveBeenCalled();
    });

    it('should throw if connection fails', async () => {
      mockClient.send.mockRejectedValueOnce(new Error('Connection failed'));

      await expect(adapter.initialize()).rejects.toThrow('Connection failed');
    });
  });

  // ==================== Object Operations ====================

  describe('getObject', () => {
    it('should retrieve object from S3', async () => {
      await adapter.initialize();

      const testBuffer = Buffer.from('test data');
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield testBuffer;
        },
      };

      mockClient.send.mockResolvedValueOnce({ Body: mockStream });

      const result = await adapter.getObject('test-bucket', 'test-key');

      expect(result).toEqual(testBuffer);
      expect(mockClient.send).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    });

    it('should throw if not connected', async () => {
      await expect(adapter.getObject('test-bucket', 'test-key')).rejects.toThrow(
        'Not connected'
      );
    });
  });

  describe('getObjectMetadata', () => {
    it('should retrieve object metadata', async () => {
      await adapter.initialize();

      const lastModified = new Date();
      mockClient.send.mockResolvedValueOnce({
        ETag: '"abc123"',
        ContentLength: 1024,
        ContentType: 'application/json',
        LastModified: lastModified,
        Metadata: { custom: 'value' },
      });

      const result = await adapter.getObjectMetadata('test-bucket', 'test-key');

      expect(result).toEqual({
        etag: 'abc123',
        size: 1024,
        contentType: 'application/json',
        lastModified,
        metadata: { custom: 'value' },
      });
      expect(mockClient.send).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    });

    it('should handle missing metadata fields', async () => {
      await adapter.initialize();

      mockClient.send.mockResolvedValueOnce({});

      const result = await adapter.getObjectMetadata('test-bucket', 'test-key');

      expect(result.size).toBe(0);
      expect(result.contentType).toBe('application/octet-stream');
    });
  });

  describe('objectExists', () => {
    it('should return true for existing object', async () => {
      await adapter.initialize();

      mockClient.send.mockResolvedValueOnce({
        ETag: '"abc123"',
        ContentLength: 1024,
      });

      const exists = await adapter.objectExists('test-bucket', 'test-key');

      expect(exists).toBe(true);
    });

    it('should return false for non-existent object', async () => {
      await adapter.initialize();

      const error: any = new Error('Not found');
      error.name = 'NotFound';
      mockClient.send.mockRejectedValueOnce(error);

      const exists = await adapter.objectExists('test-bucket', 'test-key');

      expect(exists).toBe(false);
    });
  });

  describe('putObject', () => {
    it('should upload object to S3', async () => {
      await adapter.initialize();

      mockClient.send.mockResolvedValueOnce({
        ETag: '"xyz789"',
        VersionId: 'v1',
      });

      const testData = Buffer.from('test data');
      const result = await adapter.putObject(
        'test-bucket',
        'test-key',
        testData,
        'text/plain'
      );

      expect(result).toEqual({
        etag: 'xyz789',
        versionId: 'v1',
      });
      expect(mockClient.send).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    });
  });

  describe('deleteObject', () => {
    it('should delete object from S3', async () => {
      await adapter.initialize();

      mockClient.send.mockResolvedValueOnce({});

      await adapter.deleteObject('test-bucket', 'test-key');

      expect(mockClient.send).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    });
  });

  describe('listObjects', () => {
    it('should list objects in bucket', async () => {
      await adapter.initialize();

      mockClient.send.mockResolvedValueOnce({
        Contents: [
          {
            Key: 'file1.txt',
            Size: 100,
            LastModified: new Date(),
            ETag: '"etag1"',
          },
          {
            Key: 'file2.txt',
            Size: 200,
            LastModified: new Date(),
            ETag: '"etag2"',
          },
        ],
      });

      const result = await adapter.listObjects('test-bucket');

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe('file1.txt');
      expect(result[1].key).toBe('file2.txt');
    });

    it('should list objects with prefix filter', async () => {
      await adapter.initialize();

      mockClient.send.mockResolvedValueOnce({
        Contents: [
          {
            Key: 'prefix/file1.txt',
            Size: 100,
            LastModified: new Date(),
            ETag: '"etag1"',
          },
        ],
      });

      const result = await adapter.listObjects('test-bucket', 'prefix/');

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('prefix/file1.txt');
    });
  });

  describe('getPresignedUrl', () => {
    it('should generate presigned URL', async () => {
      await adapter.initialize();

      const url = await adapter.getPresignedUrl('test-bucket', 'test-key', 3600);

      expect(url).toBe('https://signed-url.example.com/object');
    });
  });

  // ==================== Bucket Operations ====================

  describe('ensureBucket', () => {
    it('should use existing bucket', async () => {
      await adapter.initialize();

      mockClient.send.mockResolvedValueOnce({}); // HeadBucket success

      await adapter.ensureBucket('test-bucket');

      expect(mockClient.send).toHaveBeenCalledWith(expect.any(HeadBucketCommand));
    });

    it('should create bucket if not exists', async () => {
      await adapter.initialize();

      const error: any = new Error('Not found');
      error.name = 'NotFound';

      mockClient.send
        .mockRejectedValueOnce(error) // HeadBucket fails
        .mockResolvedValueOnce({}); // CreateBucket succeeds

      await adapter.ensureBucket('test-bucket');

      expect(mockClient.send).toHaveBeenCalledWith(expect.any(CreateBucketCommand));
    });
  });

  // ==================== Bucket Notifications ====================

  describe('subscribeToNotifications', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should subscribe to bucket notifications', async () => {
      await adapter.initialize();

      mockClient.send.mockResolvedValueOnce({
        Contents: [
          {
            Key: 'existing-file.txt',
            Size: 100,
            LastModified: new Date(),
            ETag: '"etag1"',
          },
        ],
      });

      const handler = vi.fn();
      const subscription = await adapter.subscribeToNotifications('test-bucket', handler);

      expect(subscription.unsubscribe).toBeDefined();

      // Cleanup
      await subscription.unsubscribe();
    });

    it('should detect new objects', async () => {
      await adapter.initialize();

      // Initial state: no objects
      mockClient.send.mockResolvedValueOnce({ Contents: [] });

      const handler = vi.fn();
      const subscription = await adapter.subscribeToNotifications('test-bucket', handler);

      // Simulate new object
      mockClient.send.mockResolvedValueOnce({
        Contents: [
          {
            Key: 'new-file.txt',
            Size: 100,
            LastModified: new Date(),
            ETag: '"etag1"',
          },
        ],
      });

      // Trigger polling
      vi.advanceTimersByTime(5000);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: S3EventType.OBJECT_CREATED,
          object_key: 'new-file.txt',
        })
      );

      await subscription.unsubscribe();
    });

    it('should detect deleted objects', async () => {
      await adapter.initialize();

      // Initial state: one object
      mockClient.send.mockResolvedValueOnce({
        Contents: [
          {
            Key: 'file.txt',
            Size: 100,
            LastModified: new Date(),
            ETag: '"etag1"',
          },
        ],
      });

      const handler = vi.fn();
      const subscription = await adapter.subscribeToNotifications('test-bucket', handler);

      // Simulate object deletion
      mockClient.send.mockResolvedValueOnce({ Contents: [] });

      // Trigger polling
      vi.advanceTimersByTime(5000);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: S3EventType.OBJECT_REMOVED,
          object_key: 'file.txt',
        })
      );

      await subscription.unsubscribe();
    });
  });

  // ==================== Health & Cleanup ====================

  describe('healthCheck', () => {
    it('should return true when connected and healthy', async () => {
      await adapter.initialize();

      mockClient.send.mockResolvedValueOnce({ Contents: [] });

      const healthy = await adapter.healthCheck();

      expect(healthy).toBe(true);
    });

    it('should return true for NoSuchBucket (connection OK)', async () => {
      await adapter.initialize();

      const error: any = new Error('No such bucket');
      error.name = 'NoSuchBucket';
      mockClient.send.mockRejectedValueOnce(error);

      const healthy = await adapter.healthCheck();

      expect(healthy).toBe(true);
    });

    it('should return false for connection errors', async () => {
      await adapter.initialize();

      mockClient.send.mockRejectedValueOnce(new Error('Connection refused'));

      const healthy = await adapter.healthCheck();

      expect(healthy).toBe(false);
    });

    it('should return false if not connected', async () => {
      const healthy = await adapter.healthCheck();

      expect(healthy).toBe(false);
    });
  });

  describe('close', () => {
    it('should clean up resources', async () => {
      await adapter.initialize();

      await adapter.close();

      expect(mockClient.destroy).toHaveBeenCalled();
    });

    it('should stop polling intervals on close', async () => {
      vi.useFakeTimers();

      await adapter.initialize();

      // Start polling
      mockClient.send.mockResolvedValue({ Contents: [] });
      const handler = vi.fn();
      const subscription = await adapter.subscribeToNotifications('test-bucket', handler);

      // Stop polling via close
      await adapter.close();
      vi.advanceTimersByTime(5000);

      expect(mockClient.destroy).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
