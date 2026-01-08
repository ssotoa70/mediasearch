/**
 * Configuration for MediaSearch
 *
 * BACKEND environment variable controls which adapters are used:
 * - BACKEND=vast (production): VAST DataBase + DataEngine
 * - BACKEND=local (development): PostgreSQL + Redis + MinIO
 */

export type Backend = 'vast' | 'local';

export interface Config {
  /** Backend type */
  backend: Backend;

  /** Database configuration */
  database: DatabaseConfig;

  /** Queue configuration */
  queue: QueueConfig;

  /** Storage configuration */
  storage: StorageConfig;

  /** ASR configuration */
  asr: ASRConfig;

  /** Embedding configuration */
  embedding: EmbeddingConfig;

  /** Processing configuration */
  processing: ProcessingConfig;

  /** Search configuration */
  search: SearchConfig;
}

export interface DatabaseConfig {
  // VAST DataBase settings
  vast?: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string; // Database bucket name
    schema: string; // Schema name
  };

  // Local PostgreSQL settings
  local?: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
}

export interface QueueConfig {
  // VAST DataEngine (uses DataBase tables for queue)
  vast?: {
    // Queue is managed via DataBase tables
  };

  // Local Redis settings
  local?: {
    host: string;
    port: number;
    password?: string;
  };

  /** Job processing settings */
  maxRetryAttempts: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
  jobTimeoutMs: number;
  concurrency: number;
}

export interface StorageConfig {
  // VAST S3 settings
  vast?: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
  };

  // Local MinIO settings
  local?: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    useSSL: boolean;
  };

  /** Media bucket name */
  mediaBucket: string;
}

export interface ASRConfig {
  /** Default engine */
  defaultEngine: 'nvidia_nims' | 'whisper' | 'byo' | 'stub';

  /** NVIDIA NIMs configuration */
  nvidiaNims?: {
    endpoint: string;
    apiKey?: string;
  };

  /** Whisper configuration */
  whisper?: {
    endpoint: string;
    model: string;
  };

  /** Enable GPU by default */
  preferGPU: boolean;

  /** Enable diarization by default */
  diarizationEnabled: boolean;

  /** Compute threshold for chunking fallback (seconds) */
  computeThresholdSeconds: number;
}

export interface EmbeddingConfig {
  /** Embedding model name */
  model: string;

  /** Vector dimension */
  dimension: number;

  /** Embedding service endpoint (if using remote service) */
  endpoint?: string;

  /** API key for embedding service */
  apiKey?: string;

  /** Use local stub for development */
  useStub: boolean;
}

export interface ProcessingConfig {
  /** Archive retention period in days */
  archiveRetentionDays: number;

  /** DLQ processing interval in ms */
  dlqProcessingIntervalMs: number;

  /** Enable semantic search (embeddings) */
  semanticSearchEnabled: boolean;

  /** Enable hybrid search */
  hybridSearchEnabled: boolean;
}

export interface SearchConfig {
  /** Default result limit */
  defaultLimit: number;

  /** Maximum result limit */
  maxLimit: number;

  /** Hybrid search keyword weight (0-1) */
  hybridKeywordWeight: number;

  /** Hybrid search semantic weight (0-1) */
  hybridSemanticWeight: number;
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
  const backend = (process.env.BACKEND || 'local') as Backend;

  return {
    backend,

    database: {
      vast: backend === 'vast' ? {
        endpoint: requireEnv('VAST_ENDPOINT'),
        accessKeyId: requireEnv('VAST_ACCESS_KEY_ID'),
        secretAccessKey: requireEnv('VAST_SECRET_ACCESS_KEY'),
        bucket: requireEnv('VAST_DATABASE_BUCKET'),
        schema: process.env.VAST_DATABASE_SCHEMA || 'mediasearch',
      } : undefined,
      local: backend === 'local' ? {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432'),
        database: process.env.POSTGRES_DB || 'mediasearch',
        user: process.env.POSTGRES_USER || 'mediasearch',
        password: process.env.POSTGRES_PASSWORD || 'mediasearch',
      } : undefined,
    },

    queue: {
      vast: backend === 'vast' ? {} : undefined,
      local: backend === 'local' ? {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
      } : undefined,
      maxRetryAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS || '5'),
      baseRetryDelayMs: parseInt(process.env.BASE_RETRY_DELAY_MS || '1000'),
      maxRetryDelayMs: parseInt(process.env.MAX_RETRY_DELAY_MS || '300000'),
      jobTimeoutMs: parseInt(process.env.JOB_TIMEOUT_MS || '600000'),
      concurrency: parseInt(process.env.JOB_CONCURRENCY || '4'),
    },

    storage: {
      vast: backend === 'vast' ? {
        endpoint: requireEnv('VAST_S3_ENDPOINT'),
        accessKeyId: requireEnv('VAST_ACCESS_KEY_ID'),
        secretAccessKey: requireEnv('VAST_SECRET_ACCESS_KEY'),
        region: process.env.VAST_REGION || 'us-east-1',
      } : undefined,
      local: backend === 'local' ? {
        endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
        accessKeyId: process.env.MINIO_ACCESS_KEY || 'minioadmin',
        secretAccessKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
        region: 'us-east-1',
        useSSL: process.env.MINIO_USE_SSL === 'true',
      } : undefined,
      mediaBucket: process.env.MEDIA_BUCKET || 'media',
    },

    asr: {
      defaultEngine: (process.env.ASR_ENGINE || 'stub') as ASRConfig['defaultEngine'],
      nvidiaNims: process.env.NVIDIA_NIMS_ENDPOINT ? {
        endpoint: process.env.NVIDIA_NIMS_ENDPOINT,
        apiKey: process.env.NVIDIA_NIMS_API_KEY,
      } : undefined,
      whisper: process.env.WHISPER_ENDPOINT ? {
        endpoint: process.env.WHISPER_ENDPOINT,
        model: process.env.WHISPER_MODEL || 'base',
      } : undefined,
      preferGPU: process.env.ASR_PREFER_GPU !== 'false',
      diarizationEnabled: process.env.ASR_DIARIZATION !== 'false',
      computeThresholdSeconds: parseInt(process.env.ASR_COMPUTE_THRESHOLD_SECONDS || '300'),
    },

    embedding: {
      model: process.env.EMBEDDING_MODEL || 'stub',
      dimension: parseInt(process.env.EMBEDDING_DIMENSION || '384'),
      endpoint: process.env.EMBEDDING_ENDPOINT,
      apiKey: process.env.EMBEDDING_API_KEY,
      useStub: process.env.EMBEDDING_USE_STUB !== 'false',
    },

    processing: {
      archiveRetentionDays: parseInt(process.env.ARCHIVE_RETENTION_DAYS || '30'),
      dlqProcessingIntervalMs: parseInt(process.env.DLQ_PROCESSING_INTERVAL_MS || '60000'),
      semanticSearchEnabled: process.env.SEMANTIC_SEARCH_ENABLED !== 'false',
      hybridSearchEnabled: process.env.HYBRID_SEARCH_ENABLED === 'true',
    },

    search: {
      defaultLimit: parseInt(process.env.SEARCH_DEFAULT_LIMIT || '20'),
      maxLimit: parseInt(process.env.SEARCH_MAX_LIMIT || '100'),
      hybridKeywordWeight: parseFloat(process.env.HYBRID_KEYWORD_WEIGHT || '0.5'),
      hybridSemanticWeight: parseFloat(process.env.HYBRID_SEMANTIC_WEIGHT || '0.5'),
    },
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

/**
 * Default configuration for local development
 */
export const DEFAULT_LOCAL_CONFIG: Config = loadConfig();
