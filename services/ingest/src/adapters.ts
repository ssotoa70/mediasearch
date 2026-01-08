/**
 * Adapter factory for ingest service
 *
 * Creates the appropriate adapters based on BACKEND configuration:
 * - BACKEND=vast: Uses VAST DataBase + VAST DataEngine + VAST S3
 * - BACKEND=local: Uses PostgreSQL + Redis/BullMQ + MinIO
 */

import {
  DatabasePort,
  QueuePort,
  StoragePort,
  loadConfig,
} from '@mediasearch/domain';

import {
  LocalPostgresAdapter,
  createLocalPostgresAdapter,
} from '@mediasearch/local-postgres';

import {
  LocalQueueAdapter,
  createLocalQueueAdapter,
} from '@mediasearch/local-queue';

import {
  LocalS3Adapter,
  createLocalS3Adapter,
} from '@mediasearch/local-s3';

import {
  VASTDatabaseAdapter,
  createVASTDatabaseAdapter,
} from '@mediasearch/vast-database';

import {
  VASTDataEngineQueueAdapter,
  VASTS3Adapter,
  createVASTDataEngineQueueAdapter,
  createVASTS3Adapter,
} from '@mediasearch/vast-dataengine';

export interface Adapters {
  database: DatabasePort;
  queue: QueuePort;
  storage: StoragePort;
}

/**
 * Create adapters based on BACKEND environment variable
 *
 * BACKEND=vast: Production mode with VAST infrastructure
 * BACKEND=local: Development mode with local emulators
 */
export async function createAdapters(): Promise<Adapters> {
  const config = loadConfig();

  if (config.backend === 'vast') {
    console.log('[Adapters] Using VAST production adapters');

    const database = createVASTDatabaseAdapter();
    const queue = createVASTDataEngineQueueAdapter();
    const storage = createVASTS3Adapter();

    return { database, queue, storage };
  }

  // Default to local development adapters
  console.log('[Adapters] Using local development adapters');

  const database = createLocalPostgresAdapter();
  const queue = createLocalQueueAdapter();
  const storage = createLocalS3Adapter();

  return { database, queue, storage };
}

/**
 * Initialize all adapters
 */
export async function initializeAdapters(adapters: Adapters): Promise<void> {
  // Type assertions needed because adapters may have different init signatures
  const db = adapters.database as LocalPostgresAdapter | VASTDatabaseAdapter;
  const q = adapters.queue as LocalQueueAdapter | VASTDataEngineQueueAdapter;
  const s = adapters.storage as LocalS3Adapter | VASTS3Adapter;

  // Initialize in parallel
  await Promise.all([
    'initialize' in db ? db.initialize() : Promise.resolve(),
    'initialize' in q ? q.initialize() : Promise.resolve(),
    // Storage doesn't need explicit init for LocalS3
  ]);
}

/**
 * Close all adapters
 */
export async function closeAdapters(adapters: Adapters): Promise<void> {
  await Promise.all([
    adapters.database.close(),
    adapters.queue.close(),
    adapters.storage.close(),
  ]);
}
