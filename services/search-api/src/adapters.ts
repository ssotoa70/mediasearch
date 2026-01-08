/**
 * Adapter factory for Search API service
 */

import {
  DatabasePort,
  EmbeddingPort,
  loadConfig,
} from '@mediasearch/domain';

import {
  LocalPostgresAdapter,
  createLocalPostgresAdapter,
} from '@mediasearch/local-postgres';

import {
  VASTDatabaseAdapter,
  createVASTDatabaseAdapter,
} from '@mediasearch/vast-database';

import { createEmbeddingAdapter } from './embedding.js';

export interface Adapters {
  database: DatabasePort;
  embedding: EmbeddingPort;
}

export async function createAdapters(): Promise<Adapters> {
  const config = loadConfig();
  const embedding = createEmbeddingAdapter();

  if (config.backend === 'vast') {
    console.log('[Adapters] Using VAST production adapters');
    return {
      database: createVASTDatabaseAdapter(),
      embedding,
    };
  }

  console.log('[Adapters] Using local development adapters');
  return {
    database: createLocalPostgresAdapter(),
    embedding,
  };
}

export async function initializeAdapters(adapters: Adapters): Promise<void> {
  const db = adapters.database as LocalPostgresAdapter | VASTDatabaseAdapter;

  await Promise.all([
    'initialize' in db ? db.initialize() : Promise.resolve(),
    adapters.embedding.initialize(),
  ]);
}

export async function closeAdapters(adapters: Adapters): Promise<void> {
  await Promise.all([
    adapters.database.close(),
    adapters.embedding.close(),
  ]);
}
