/**
 * Adapter factory for Triage service
 */

import {
  DatabasePort,
  QueuePort,
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
  VASTDatabaseAdapter,
  createVASTDatabaseAdapter,
} from '@mediasearch/vast-database';

import {
  VASTDataEngineQueueAdapter,
  createVASTDataEngineQueueAdapter,
} from '@mediasearch/vast-dataengine';

export interface Adapters {
  database: DatabasePort;
  queue: QueuePort;
}

export async function createAdapters(): Promise<Adapters> {
  const config = loadConfig();

  if (config.backend === 'vast') {
    console.log('[Adapters] Using VAST production adapters');
    return {
      database: createVASTDatabaseAdapter(),
      queue: createVASTDataEngineQueueAdapter(),
    };
  }

  console.log('[Adapters] Using local development adapters');
  return {
    database: createLocalPostgresAdapter(),
    queue: createLocalQueueAdapter(),
  };
}

export async function initializeAdapters(adapters: Adapters): Promise<void> {
  const db = adapters.database as LocalPostgresAdapter | VASTDatabaseAdapter;
  const q = adapters.queue as LocalQueueAdapter | VASTDataEngineQueueAdapter;

  await Promise.all([
    'initialize' in db ? db.initialize() : Promise.resolve(),
    'initialize' in q ? q.initialize() : Promise.resolve(),
  ]);
}

export async function closeAdapters(adapters: Adapters): Promise<void> {
  await Promise.all([
    adapters.database.close(),
    adapters.queue.close(),
  ]);
}
