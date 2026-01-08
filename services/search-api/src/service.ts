/**
 * Search Service Implementation
 *
 * Provides keyword, semantic, and hybrid search capabilities.
 *
 * CRITICAL REQUIREMENT (PRD Section 17):
 * All searches MUST filter visibility='ACTIVE' AND match current_version_id.
 * Staging or archived data MUST NEVER appear in search results.
 */

import {
  DatabasePort,
  EmbeddingPort,
  SearchHit,
  SearchQuery,
} from '@mediasearch/domain';
import { Adapters, initializeAdapters, closeAdapters } from './adapters.js';

export interface SearchRequest {
  query: string;
  type: 'keyword' | 'semantic' | 'hybrid';
  bucket?: string;
  speaker?: string;
  limit: number;
  offset: number;
}

export interface SearchStats {
  keywordSearches: number;
  semanticSearches: number;
  hybridSearches: number;
  averageLatencyMs: number;
}

export class SearchService {
  private adapters: Adapters;
  private stats: SearchStats = {
    keywordSearches: 0,
    semanticSearches: 0,
    hybridSearches: 0,
    averageLatencyMs: 0,
  };
  private totalLatency: number = 0;
  private totalSearches: number = 0;

  constructor(adapters: Adapters) {
    this.adapters = adapters;
  }

  async initialize(): Promise<void> {
    await initializeAdapters(this.adapters);
    console.log('[Search] Service initialized');
  }

  async search(request: SearchRequest): Promise<SearchHit[]> {
    const startTime = Date.now();

    const searchQuery: SearchQuery = {
      query: request.query,
      bucket: request.bucket,
      speaker: request.speaker,
      limit: request.limit,
      offset: request.offset,
    };

    let results: SearchHit[];

    switch (request.type) {
      case 'keyword':
        results = await this.keywordSearch(searchQuery);
        this.stats.keywordSearches++;
        break;

      case 'semantic':
        results = await this.semanticSearch(searchQuery);
        this.stats.semanticSearches++;
        break;

      case 'hybrid':
        results = await this.hybridSearch(searchQuery);
        this.stats.hybridSearches++;
        break;

      default:
        results = await this.keywordSearch(searchQuery);
        this.stats.keywordSearches++;
    }

    // Update latency stats
    const latency = Date.now() - startTime;
    this.totalLatency += latency;
    this.totalSearches++;
    this.stats.averageLatencyMs = Math.round(this.totalLatency / this.totalSearches);

    console.log(`[Search] ${request.type} search for "${request.query}" returned ${results.length} results in ${latency}ms`);

    return results;
  }

  /**
   * Keyword search using database full-text search
   */
  private async keywordSearch(query: SearchQuery): Promise<SearchHit[]> {
    // The database adapter MUST enforce visibility='ACTIVE' and current_version_id
    return this.adapters.database.searchKeyword(query);
  }

  /**
   * Semantic search using vector similarity
   */
  private async semanticSearch(query: SearchQuery): Promise<SearchHit[]> {
    // Generate embedding for the query
    const queryEmbedding = await this.adapters.embedding.embed(query.query);

    // The database adapter MUST enforce visibility='ACTIVE' and current_version_id
    return this.adapters.database.searchSemantic(query, queryEmbedding);
  }

  /**
   * Hybrid search combining keyword and semantic results
   */
  private async hybridSearch(query: SearchQuery): Promise<SearchHit[]> {
    const keywordWeight = parseFloat(process.env.HYBRID_KEYWORD_WEIGHT || '0.5');
    const semanticWeight = parseFloat(process.env.HYBRID_SEMANTIC_WEIGHT || '0.5');

    // Generate embedding for the query
    const queryEmbedding = await this.adapters.embedding.embed(query.query);

    // The database adapter MUST enforce visibility='ACTIVE' and current_version_id
    return this.adapters.database.searchHybrid(
      query,
      queryEmbedding,
      keywordWeight,
      semanticWeight
    );
  }

  async healthCheck(): Promise<boolean> {
    try {
      const results = await Promise.all([
        this.adapters.database.healthCheck(),
        this.adapters.embedding.healthCheck(),
      ]);
      return results.every((r) => r);
    } catch {
      return false;
    }
  }

  getStats(): SearchStats {
    return { ...this.stats };
  }

  async close(): Promise<void> {
    await closeAdapters(this.adapters);
    console.log('[Search] Service closed');
  }
}
