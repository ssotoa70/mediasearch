/**
 * Embedding adapter for Search API
 * Used to generate query embeddings for semantic search
 */

import {
  EmbeddingPort,
  DEFAULT_EMBEDDING_DIMENSION,
  normalizeVector,
} from '@mediasearch/domain';

export function createEmbeddingAdapter(): EmbeddingPort {
  const useStub = process.env.EMBEDDING_USE_STUB === 'true';
  const model = process.env.EMBEDDING_MODEL || 'stub';

  if (useStub || model === 'stub') {
    return new StubEmbeddingAdapter();
  }

  return new RemoteEmbeddingAdapter();
}

class StubEmbeddingAdapter implements EmbeddingPort {
  private dimension: number;

  constructor() {
    this.dimension = parseInt(process.env.EMBEDDING_DIMENSION || '384', 10);
  }

  async initialize(): Promise<void> {
    console.log(`[Embedding/Stub] Initialized (dimension=${this.dimension})`);
  }

  getModel(): string {
    return 'stub';
  }

  getDimension(): number {
    return this.dimension;
  }

  async embed(text: string): Promise<number[]> {
    return this.generateVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.generateVector(text));
  }

  private generateVector(text: string): number[] {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    const vector: number[] = [];
    let seed = Math.abs(hash);

    for (let i = 0; i < this.dimension; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      vector.push((seed / 0x7fffffff) * 2 - 1);
    }

    return normalizeVector(vector);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {}
}

class RemoteEmbeddingAdapter implements EmbeddingPort {
  private endpoint: string;
  private model: string;
  private dimension: number;

  constructor() {
    this.endpoint = process.env.EMBEDDING_ENDPOINT || '';
    this.model = process.env.EMBEDDING_MODEL || 'all-MiniLM-L6-v2';
    this.dimension = parseInt(process.env.EMBEDDING_DIMENSION || '384', 10);
  }

  async initialize(): Promise<void> {
    console.log(`[Embedding/Remote] Initialized (model=${this.model})`);
  }

  getModel(): string {
    return this.model;
  }

  getDimension(): number {
    return this.dimension;
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.endpoint) {
      throw new Error('EMBEDDING_ENDPOINT not configured');
    }
    throw new Error('Not implemented');
  }

  async healthCheck(): Promise<boolean> {
    return !!this.endpoint;
  }

  async close(): Promise<void> {}
}
