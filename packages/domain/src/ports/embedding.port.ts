/**
 * Embedding port interface for generating vector embeddings
 *
 * Production: Various embedding services (sentence-transformers, OpenAI, etc.)
 * Local: Stub adapter that generates random vectors for development
 *
 * Required for semantic and hybrid search (PRD Section 10.2, 10.3)
 */
export interface EmbeddingPort {
  /**
   * Initialize the embedding service connection
   */
  initialize(): Promise<void>;

  /**
   * Get the embedding model name
   */
  getModel(): string;

  /**
   * Get the vector dimension
   */
  getDimension(): number;

  /**
   * Generate embedding for single text
   */
  embed(text: string): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts (batch)
   */
  embedBatch(texts: string[]): Promise<number[][]>;

  /**
   * Health check
   */
  healthCheck(): Promise<boolean>;

  /**
   * Close connection
   */
  close(): Promise<void>;
}

/**
 * Default embedding dimension for VAST Database vectors
 * Matches common sentence transformer models
 */
export const DEFAULT_EMBEDDING_DIMENSION = 384;

/**
 * Maximum batch size for embedding requests
 */
export const MAX_BATCH_SIZE = 100;

/**
 * Normalize vector to unit length (for cosine similarity)
 */
export function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (magnitude === 0) return vector;
  return vector.map((v) => v / magnitude);
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same dimension');
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) return 0;

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Calculate Euclidean distance between two vectors
 * Used by VAST Database array_distance function
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same dimension');
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}
