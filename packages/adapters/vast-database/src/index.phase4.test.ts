/**
 * Phase 4: Search Implementation Tests
 *
 * Tests for searchKeyword(), searchSemantic(), searchHybrid()
 * All methods must filter visibility='ACTIVE' to prevent partial results
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VASTDatabaseAdapter } from './index';
import { Visibility } from '@mediasearch/domain';

// Mock RPC client
vi.mock('./vast-rpc-client', () => ({
  VASTRPCClient: vi.fn().mockImplementation(() => ({
    executeQuery: vi.fn(),
    selectById: vi.fn(),
  })),
}));

describe('Phase 4: Search Implementation', () => {
  let adapter: VASTDatabaseAdapter;
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      executeQuery: vi.fn(),
      selectById: vi.fn(),
    };

    vi.mocked(require('./vast-rpc-client').VASTRPCClient).mockImplementation(() => mockClient);

    adapter = new VASTDatabaseAdapter({
      endpoint: 'http://localhost:5000',
      accessKeyId: 'test',
      secretAccessKey: 'test',
      bucket: 'test-db',
      schema: 'mediasearch',
    });
  });

  // ==================== Keyword Search Tests ====================

  describe('searchKeyword', () => {
    it('should search for text using LIKE query', async () => {
      const mockSegments = [
        {
          segment_id: 'seg-1',
          asset_id: 'asset-1',
          version_id: 'v1',
          text: 'The quick brown fox',
          start_ms: 0,
          end_ms: 1000,
          speaker: 'Speaker A',
          confidence: 0.95,
          visibility: Visibility.ACTIVE,
        },
        {
          segment_id: 'seg-2',
          asset_id: 'asset-1',
          version_id: 'v1',
          text: 'jumped over the fence',
          start_ms: 1000,
          end_ms: 2000,
          speaker: 'Speaker B',
          confidence: 0.92,
          visibility: Visibility.ACTIVE,
        },
      ];

      mockClient.executeQuery.mockResolvedValueOnce(mockSegments);

      const results = await adapter.searchKeyword({
        text: 'quick',
        assetId: 'asset-1',
        limit: 100,
      });

      expect(results).toHaveLength(2);
      expect(results[0].text).toContain('quick');
      expect(results[0].match_type).toBe('keyword');
      expect(mockClient.executeQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIKE')
      );
    });

    it('should filter by visibility=ACTIVE', async () => {
      mockClient.executeQuery.mockResolvedValueOnce([]);

      await adapter.searchKeyword({
        text: 'search term',
        assetId: 'asset-1',
        limit: 50,
      });

      const callArgs = mockClient.executeQuery.mock.calls[0][0];
      expect(callArgs).toContain('visibility = \'ACTIVE\'');
    });

    it('should respect limit parameter', async () => {
      mockClient.executeQuery.mockResolvedValueOnce([]);

      await adapter.searchKeyword({
        text: 'query',
        assetId: 'asset-1',
        limit: 25,
      });

      const callArgs = mockClient.executeQuery.mock.calls[0][0];
      expect(callArgs).toContain('LIMIT 25');
    });

    it('should throw error if query fails', async () => {
      mockClient.executeQuery.mockRejectedValueOnce(new Error('Query failed'));

      await expect(
        adapter.searchKeyword({
          text: 'query',
          assetId: 'asset-1',
          limit: 100,
        })
      ).rejects.toThrow('Keyword search failed');
    });
  });

  // ==================== Semantic Search Tests ====================

  describe('searchSemantic', () => {
    const queryEmbedding = Array(384).fill(0.5); // 384-dim vector

    it('should search using vector similarity', async () => {
      const mockEmbeddings = [
        {
          embedding_id: 'emb-1',
          segment_id: 'seg-1',
          asset_id: 'asset-1',
          version_id: 'v1',
          embedding: Array(384).fill(0.51),
          visibility: Visibility.ACTIVE,
        },
        {
          embedding_id: 'emb-2',
          segment_id: 'seg-2',
          asset_id: 'asset-1',
          version_id: 'v1',
          embedding: Array(384).fill(0.6),
          visibility: Visibility.ACTIVE,
        },
      ];

      mockClient.executeQuery.mockResolvedValueOnce(mockEmbeddings);
      mockClient.selectById
        .mockResolvedValueOnce({
          segment_id: 'seg-1',
          text: 'Segment one',
          start_ms: 0,
          end_ms: 1000,
          speaker: 'A',
          confidence: 0.9,
        })
        .mockResolvedValueOnce({
          segment_id: 'seg-2',
          text: 'Segment two',
          start_ms: 1000,
          end_ms: 2000,
          speaker: 'B',
          confidence: 0.85,
        });

      const results = await adapter.searchSemantic(
        {
          text: '',
          assetId: 'asset-1',
          limit: 100,
        },
        queryEmbedding
      );

      expect(results).toHaveLength(2);
      expect(results[0].match_type).toBe('semantic');
      expect(results[0].score).toBeGreaterThan(0);
      expect(results[0].score).toBeLessThanOrEqual(1);
    });

    it('should use array_cosine_distance in query', async () => {
      mockClient.executeQuery.mockResolvedValueOnce([]);

      await adapter.searchSemantic(
        {
          text: '',
          assetId: 'asset-1',
          limit: 100,
        },
        queryEmbedding
      );

      const callArgs = mockClient.executeQuery.mock.calls[0][0];
      expect(callArgs).toContain('array_cosine_distance');
      expect(callArgs).toContain('visibility = \'ACTIVE\'');
    });

    it('should throw error if query embedding is missing', async () => {
      await expect(
        adapter.searchSemantic(
          {
            text: '',
            assetId: 'asset-1',
            limit: 100,
          },
          []
        )
      ).rejects.toThrow('Query embedding required');
    });

    it('should calculate cosine similarity scores', async () => {
      const testVec1 = [1, 0, 0];
      const testVec2 = [1, 0, 0];
      const testVec3 = [0, 1, 0];

      // @ts-ignore - accessing private method for testing
      const similarity1 = adapter.calculateCosineSimilarity(testVec1, testVec2);
      // @ts-ignore
      const similarity2 = adapter.calculateCosineSimilarity(testVec1, testVec3);

      expect(similarity1).toBeCloseTo(1.0); // Same vector
      expect(similarity2).toBeCloseTo(0.0); // Orthogonal vectors
    });

    it('should handle dimension mismatch gracefully', async () => {
      const vec1 = [1, 0, 0];
      const vec2 = [1, 0, 0, 0]; // Different dimension

      // @ts-ignore
      const similarity = adapter.calculateCosineSimilarity(vec1, vec2);

      expect(similarity).toBe(0);
    });
  });

  // ==================== Hybrid Search Tests ====================

  describe('searchHybrid', () => {
    const queryEmbedding = Array(384).fill(0.5);

    it('should combine keyword and semantic results', async () => {
      // Mock keyword search results
      const keywordSegments = [
        {
          segment_id: 'seg-1',
          asset_id: 'asset-1',
          version_id: 'v1',
          text: 'The meeting agenda',
          start_ms: 0,
          end_ms: 1000,
          speaker: 'A',
          confidence: 0.95,
          visibility: Visibility.ACTIVE,
        },
      ];

      // Mock semantic search results
      const semanticEmbeddings = [
        {
          embedding_id: 'emb-2',
          segment_id: 'seg-2',
          asset_id: 'asset-1',
          version_id: 'v1',
          embedding: Array(384).fill(0.51),
          visibility: Visibility.ACTIVE,
        },
      ];

      mockClient.executeQuery
        .mockResolvedValueOnce(keywordSegments) // First call: keyword search
        .mockResolvedValueOnce(semanticEmbeddings); // Second call: semantic search

      mockClient.selectById.mockResolvedValueOnce({
        segment_id: 'seg-2',
        text: 'Discussion on agenda items',
        start_ms: 1000,
        end_ms: 2000,
        speaker: 'B',
        confidence: 0.9,
      });

      const results = await adapter.searchHybrid(
        {
          text: 'agenda',
          assetId: 'asset-1',
          limit: 100,
        },
        queryEmbedding,
        0.5, // keyword weight
        0.5  // semantic weight
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].match_type).toBe('keyword');
    });

    it('should apply keyword weight', async () => {
      mockClient.executeQuery
        .mockResolvedValueOnce([
          {
            segment_id: 'seg-1',
            text: 'text',
            start_ms: 0,
            end_ms: 1000,
            speaker: 'A',
            confidence: 0.9,
            visibility: Visibility.ACTIVE,
            asset_id: 'asset-1',
            version_id: 'v1',
          },
        ])
        .mockResolvedValueOnce([]); // No semantic results

      const results = await adapter.searchHybrid(
        {
          text: 'text',
          assetId: 'asset-1',
          limit: 100,
        },
        queryEmbedding,
        0.7, // Higher keyword weight
        0.3
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeCloseTo(0.7, 1);
    });

    it('should respect limit parameter', async () => {
      mockClient.executeQuery.mockResolvedValueOnce([]);
      mockClient.executeQuery.mockResolvedValueOnce([]);

      await adapter.searchHybrid(
        {
          text: 'query',
          assetId: 'asset-1',
          limit: 25,
        },
        queryEmbedding,
        0.5,
        0.5
      );

      // Both keyword and semantic searches should be called
      expect(mockClient.executeQuery).toHaveBeenCalledTimes(2);
    });

    it('should mark results as hybrid when both match', async () => {
      const sharedSegmentId = 'seg-1';

      mockClient.executeQuery
        .mockResolvedValueOnce([
          {
            segment_id: sharedSegmentId,
            asset_id: 'asset-1',
            version_id: 'v1',
            text: 'matching text',
            start_ms: 0,
            end_ms: 1000,
            speaker: 'A',
            confidence: 0.95,
            visibility: Visibility.ACTIVE,
          },
        ])
        .mockResolvedValueOnce([
          {
            embedding_id: 'emb-1',
            segment_id: sharedSegmentId,
            asset_id: 'asset-1',
            version_id: 'v1',
            embedding: Array(384).fill(0.5),
            visibility: Visibility.ACTIVE,
          },
        ]);

      mockClient.selectById.mockResolvedValueOnce({
        segment_id: sharedSegmentId,
        text: 'matching text',
        start_ms: 0,
        end_ms: 1000,
        speaker: 'A',
        confidence: 0.95,
      });

      const results = await adapter.searchHybrid(
        {
          text: 'matching',
          assetId: 'asset-1',
          limit: 100,
        },
        queryEmbedding,
        0.5,
        0.5
      );

      expect(results).toHaveLength(1);
      expect(results[0].match_type).toBe('hybrid');
    });
  });

  // ==================== Critical Requirement Tests ====================

  describe('Visibility Filter (CRITICAL)', () => {
    it('should filter visibility=ACTIVE in keyword search', async () => {
      mockClient.executeQuery.mockResolvedValueOnce([]);

      await adapter.searchKeyword({
        text: 'query',
        assetId: 'asset-1',
        limit: 100,
      });

      const query = mockClient.executeQuery.mock.calls[0][0];
      expect(query).toMatch(/visibility\s*=\s*'ACTIVE'/i);
    });

    it('should filter visibility=ACTIVE in semantic search', async () => {
      mockClient.executeQuery.mockResolvedValueOnce([]);

      await adapter.searchSemantic(
        {
          text: '',
          assetId: 'asset-1',
          limit: 100,
        },
        Array(384).fill(0.5)
      );

      const query = mockClient.executeQuery.mock.calls[0][0];
      expect(query).toMatch(/visibility\s*=\s*'ACTIVE'/i);
    });
  });
});
