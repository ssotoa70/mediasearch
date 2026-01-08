/**
 * Embedding Adapter Factory
 *
 * Creates the appropriate embedding adapter based on configuration.
 * Used for semantic search (PRD Section 10.2)
 */

import {
  EmbeddingPort,
  DEFAULT_EMBEDDING_DIMENSION,
  normalizeVector,
} from '@mediasearch/domain';

/**
 * Create embedding adapter based on environment configuration
 */
export function createEmbeddingAdapter(): EmbeddingPort {
  const useStub = process.env.EMBEDDING_USE_STUB === 'true';
  const model = process.env.EMBEDDING_MODEL || 'stub';

  if (useStub || model === 'stub') {
    return new StubEmbeddingAdapter();
  }

  // For production, use remote embedding service
  return new RemoteEmbeddingAdapter();
}

/**
 * Stub embedding adapter for local development
 * Generates deterministic pseudo-random vectors based on text hash
 */
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

  getModelName(): string {
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

  /**
   * Generate a deterministic pseudo-random vector based on text
   * This ensures the same text always produces the same embedding
   */
  private generateVector(text: string): number[] {
    // Simple hash function for deterministic seeding
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    // Generate vector using seeded random
    const vector: number[] = [];
    let seed = Math.abs(hash);

    for (let i = 0; i < this.dimension; i++) {
      // Simple LCG random number generator
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      // Scale to [-1, 1]
      vector.push((seed / 0x7fffffff) * 2 - 1);
    }

    // Normalize to unit vector for cosine similarity
    return normalizeVector(vector);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    console.log('[Embedding/Stub] Closed');
  }
}

/**
 * Remote embedding adapter for production
 * Calls external embedding service API
 */
class RemoteEmbeddingAdapter implements EmbeddingPort {
  private endpoint: string;
  private apiKey: string;
  private model: string;
  private dimension: number;

  constructor() {
    this.endpoint = process.env.EMBEDDING_ENDPOINT || '';
    this.apiKey = process.env.EMBEDDING_API_KEY || '';
    this.model = process.env.EMBEDDING_MODEL || 'all-MiniLM-L6-v2';
    this.dimension = parseInt(process.env.EMBEDDING_DIMENSION || '384', 10);
  }

  async initialize(): Promise<void> {
    console.log(`[Embedding/Remote] Connecting to ${this.endpoint} (model=${this.model})`);
    // TODO: Validate connection
  }

  getModel(): string {
    return this.model;
  }

  getModelName(): string {
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
      throw new Error('[Embedding/Remote] EMBEDDING_ENDPOINT not configured');
    }

    // TODO: Implement actual API call
    // Example for sentence-transformers API:
    // const response = await fetch(`${this.endpoint}/embed`, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'Authorization': `Bearer ${this.apiKey}`,
    //   },
    //   body: JSON.stringify({ texts, model: this.model }),
    // });
    // const data = await response.json();
    // return data.embeddings;

    throw new Error('[Embedding/Remote] Not implemented - configure EMBEDDING_ENDPOINT');
  }

  async healthCheck(): Promise<boolean> {
    if (!this.endpoint) return false;
    // TODO: Health check
    return true;
  }

  async close(): Promise<void> {
    console.log('[Embedding/Remote] Closed');
  }
}
