/**
 * Adapter factory for orchestrator service
 */

import {
  DatabasePort,
  QueuePort,
  StoragePort,
  ASRPort,
  EmbeddingPort,
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

import { createASRAdapter } from './asr/factory.js';
import { createEmbeddingAdapter } from './embedding/factory.js';

export interface Adapters {
  database: DatabasePort;
  queue: QueuePort;
  storage: StoragePort;
  asr: ASRPort;
  embedding: EmbeddingPort;
}

export async function createAdapters(): Promise<Adapters> {
  const config = loadConfig();

  const asr = createASRAdapter();
  const embedding = createEmbeddingAdapter();

  if (config.backend === 'vast') {
    console.log('[Adapters] Using VAST production adapters');

    return {
      database: createVASTDatabaseAdapter(),
      queue: createVASTDataEngineQueueAdapter(),
      storage: createVASTS3Adapter(),
      asr,
      embedding,
    };
  }

  console.log('[Adapters] Using local development adapters');

  return {
    database: createLocalPostgresAdapter(),
    queue: createLocalQueueAdapter(),
    storage: createLocalS3Adapter(),
    asr,
    embedding,
  };
}

export async function initializeAdapters(adapters: Adapters): Promise<void> {
  const db = adapters.database as LocalPostgresAdapter | VASTDatabaseAdapter;
  const q = adapters.queue as LocalQueueAdapter | VASTDataEngineQueueAdapter;

  await Promise.all([
    'initialize' in db ? db.initialize() : Promise.resolve(),
    'initialize' in q ? q.initialize() : Promise.resolve(),
    adapters.asr.initialize(),
    adapters.embedding.initialize(),
  ]);
}

export async function closeAdapters(adapters: Adapters): Promise<void> {
  await Promise.all([
    adapters.database.close(),
    adapters.queue.close(),
    adapters.storage.close(),
    adapters.asr.close(),
    adapters.embedding.close(),
  ]);
}
