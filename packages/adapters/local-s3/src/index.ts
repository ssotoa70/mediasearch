/**
 * Local S3 Adapter using MinIO
 *
 * This adapter implements the StoragePort interface for local development.
 * In production, VAST S3-compatible storage is used.
 *
 * Features:
 * - S3-compatible object operations (get, put, delete, list)
 * - Presigned URL generation
 * - Bucket notification simulation via polling
 *
 * Note: MinIO supports native bucket notifications, but for simplicity
 * this adapter uses polling to simulate events in local development.
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
  StoragePort,
  ObjectMetadata,
  PutObjectResult,
  ObjectInfo,
  NotificationSubscription,
  S3Event,
  S3EventType,
} from '@mediasearch/domain';

export interface LocalS3Config {
  /** MinIO endpoint URL (e.g., http://localhost:9000) */
  endpoint: string;

  /** Access key ID */
  accessKeyId: string;

  /** Secret access key */
  secretAccessKey: string;

  /** AWS region (can be any value for MinIO) */
  region?: string;

  /** Use path-style URLs (required for MinIO) */
  forcePathStyle?: boolean;

  /** Polling interval for notification simulation (ms) */
  pollIntervalMs?: number;
}

/**
 * Local S3 adapter using MinIO for development
 */
export class LocalS3Adapter implements StoragePort {
  private config: LocalS3Config;
  private client: S3Client;
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private knownObjects: Map<string, Set<string>> = new Map();

  constructor(config: LocalS3Config) {
    this.config = {
      region: 'us-east-1',
      forcePathStyle: true,
      pollIntervalMs: 5000,
      ...config,
    };

    this.client = new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      forcePathStyle: this.config.forcePathStyle,
    });
  }

  // ==================== Object Operations ====================

  async getObject(bucket: string, key: string): Promise<Buffer> {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`Object ${key} has no body`);
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  }

  async getObjectMetadata(bucket: string, key: string): Promise<ObjectMetadata> {
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
    const command = new DeleteObjectCommand({ Bucket: bucket, Key: key });
    await this.client.send(command);
  }

  async listObjects(bucket: string, prefix?: string): Promise<ObjectInfo[]> {
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
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  // ==================== Bucket Operations ====================

  async ensureBucket(bucket: string): Promise<void> {
    try {
      const headCommand = new HeadBucketCommand({ Bucket: bucket });
      await this.client.send(headCommand);
    } catch (error: unknown) {
      if ((error as { name?: string }).name === 'NotFound') {
        const createCommand = new CreateBucketCommand({ Bucket: bucket });
        await this.client.send(createCommand);
        console.log(`[LocalS3] Created bucket: ${bucket}`);
      } else {
        throw error;
      }
    }
  }

  // ==================== Bucket Notifications ====================

  /**
   * Subscribe to bucket notifications via polling
   *
   * Note: This is a simplified implementation for local development.
   * In production with VAST S3, native bucket notifications would be used.
   * MinIO also supports native notifications but requires additional setup.
   */
  async subscribeToNotifications(
    bucket: string,
    handler: (event: S3Event) => Promise<void>
  ): Promise<NotificationSubscription> {
    // Initialize known objects for this bucket
    const existingObjects = await this.listObjects(bucket);
    const knownKeys = new Set(existingObjects.map((o) => o.key));
    this.knownObjects.set(bucket, knownKeys);

    console.log(
      `[LocalS3] Subscribed to notifications for bucket ${bucket} (${knownKeys.size} existing objects)`
    );

    // Start polling for changes
    const intervalId = setInterval(async () => {
      try {
        await this.checkForChanges(bucket, handler);
      } catch (error) {
        console.error(`[LocalS3] Error polling bucket ${bucket}:`, error);
      }
    }, this.config.pollIntervalMs);

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

        console.log(`[LocalS3] Object created: ${bucket}/${obj.key}`);
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

        console.log(`[LocalS3] Object removed: ${bucket}/${key}`);
        await handler(event);
      }
    }

    // Update known objects
    this.knownObjects.set(bucket, currentKeys);
  }

  // ==================== Health & Cleanup ====================

  async healthCheck(): Promise<boolean> {
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
      console.log(`[LocalS3] Stopped polling for bucket ${bucket}`);
    }
    this.pollingIntervals.clear();
    this.knownObjects.clear();

    // S3Client doesn't have explicit close - it uses connection pooling
    this.client.destroy();
    console.log('[LocalS3] Closed S3 client');
  }
}

/**
 * Create local S3 adapter from environment variables
 */
export function createLocalS3Adapter(): LocalS3Adapter {
  const config: LocalS3Config = {
    endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
    accessKeyId: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    region: process.env.MINIO_REGION || 'us-east-1',
    forcePathStyle: true,
    pollIntervalMs: parseInt(process.env.S3_POLL_INTERVAL_MS || '5000', 10),
  };

  return new LocalS3Adapter(config);
}
