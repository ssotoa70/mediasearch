import { S3Event, S3EventType } from '../types/index.js';

/**
 * Storage port interface for S3-compatible object storage
 *
 * Production: Implemented by VAST S3-compatible storage
 * Local: Implemented by MinIO adapter
 *
 * Handles bucket notifications as per PRD Section 5.2
 */
export interface StoragePort {
  /**
   * Get object from storage
   */
  getObject(bucket: string, key: string): Promise<Buffer>;

  /**
   * Get object metadata
   */
  getObjectMetadata(bucket: string, key: string): Promise<ObjectMetadata>;

  /**
   * Check if object exists
   */
  objectExists(bucket: string, key: string): Promise<boolean>;

  /**
   * Put object to storage
   */
  putObject(
    bucket: string,
    key: string,
    data: Buffer,
    contentType: string
  ): Promise<PutObjectResult>;

  /**
   * Delete object from storage
   */
  deleteObject(bucket: string, key: string): Promise<void>;

  /**
   * List objects in bucket
   */
  listObjects(bucket: string, prefix?: string): Promise<ObjectInfo[]>;

  /**
   * Generate presigned URL for object
   */
  getPresignedUrl(bucket: string, key: string, expiresIn: number): Promise<string>;

  /**
   * Subscribe to bucket notifications
   * As required by PRD Section 5.2: "respond to ObjectCreated/ObjectRemoved"
   */
  subscribeToNotifications(
    bucket: string,
    handler: (event: S3Event) => Promise<void>
  ): Promise<NotificationSubscription>;

  /**
   * Create bucket if not exists
   */
  ensureBucket(bucket: string): Promise<void>;

  /**
   * Health check
   */
  healthCheck(): Promise<boolean>;

  /**
   * Close connection
   */
  close(): Promise<void>;
}

export interface ObjectMetadata {
  /** ETag/hash */
  etag: string;

  /** File size in bytes */
  size: number;

  /** Content type */
  contentType: string;

  /** Last modified time */
  lastModified: Date;

  /** Custom metadata */
  metadata: Record<string, string>;
}

export interface PutObjectResult {
  /** ETag of uploaded object */
  etag: string;

  /** Version ID if versioning enabled */
  versionId?: string;
}

export interface ObjectInfo {
  /** Object key */
  key: string;

  /** File size */
  size: number;

  /** Last modified */
  lastModified: Date;

  /** ETag */
  etag: string;
}

export interface NotificationSubscription {
  /** Unsubscribe from notifications */
  unsubscribe(): Promise<void>;
}

/**
 * Compute strong version ID from object metadata
 * As suggested in PRD SequenceDiagram-Update-Delete: "compute strong version_id (e.g., hash/etag + size + mtime)"
 */
export function computeVersionId(
  etag: string,
  size: number,
  mtime: Date
): string {
  // Combine etag, size, and mtime into a deterministic version ID
  const data = `${etag}:${size}:${mtime.getTime()}`;
  // Simple hash - in production you might use a proper hash function
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `v_${Math.abs(hash).toString(36)}_${Date.now().toString(36)}`;
}

/**
 * Supported media formats as per PRD Section 5.1
 */
export const SUPPORTED_AUDIO_FORMATS = ['wav', 'mp3', 'aac', 'flac'];
export const SUPPORTED_VIDEO_FORMATS = ['mp4', 'mov', 'mxf'];
export const SUPPORTED_FORMATS = [...SUPPORTED_AUDIO_FORMATS, ...SUPPORTED_VIDEO_FORMATS];

/**
 * Check if file is a supported media format
 */
export function isSupportedMediaFormat(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? SUPPORTED_FORMATS.includes(ext) : false;
}
