/**
 * MediaSearch Search API Service
 *
 * Provides keyword, semantic, and hybrid search endpoints.
 * All searches MUST filter visibility='ACTIVE' and current_version_id (PRD Section 17).
 *
 * Endpoints:
 * - GET /search?q=query&type=keyword|semantic|hybrid
 * - GET /health
 * - GET /stats
 */

import Fastify from 'fastify';
import { SearchService } from './service.js';
import { createAdapters } from './adapters.js';

const PORT = parseInt(process.env.SEARCH_API_PORT || '3001', 10);
const HOST = process.env.SEARCH_API_HOST || '0.0.0.0';

async function main() {
  console.log('[SearchAPI] Starting MediaSearch Search API Service...');

  const adapters = await createAdapters();
  const searchService = new SearchService(adapters);

  await searchService.initialize();

  const server = Fastify({ logger: true });

  // Health check
  server.get('/health', async () => {
    const healthy = await searchService.healthCheck();
    if (!healthy) {
      throw { statusCode: 503, message: 'Service unhealthy' };
    }
    return { status: 'healthy' };
  });

  // Ready check
  server.get('/ready', async () => {
    return { status: 'ready' };
  });

  // Search endpoint
  server.get<{
    Querystring: {
      q: string;
      type?: 'keyword' | 'semantic' | 'hybrid';
      bucket?: string;
      speaker?: string;
      limit?: string;
      offset?: string;
    };
  }>('/search', async (request, reply) => {
    const {
      q,
      type = 'keyword',
      bucket,
      speaker,
      limit = '20',
      offset = '0',
    } = request.query;

    if (!q || q.trim().length === 0) {
      reply.code(400);
      return { error: 'Query parameter "q" is required' };
    }

    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
    const offsetNum = parseInt(offset, 10) || 0;

    try {
      const results = await searchService.search({
        query: q.trim(),
        type: type as 'keyword' | 'semantic' | 'hybrid',
        bucket,
        speaker,
        limit: limitNum,
        offset: offsetNum,
      });

      return {
        query: q,
        type,
        total: results.length,
        results,
      };
    } catch (error) {
      request.log.error(error, 'Search failed');
      reply.code(500);
      return { error: 'Search failed' };
    }
  });

  // Stats endpoint
  server.get('/stats', async () => {
    return searchService.getStats();
  });

  await server.listen({ port: PORT, host: HOST });
  console.log(`[SearchAPI] Server listening on ${HOST}:${PORT}`);

  const shutdown = async () => {
    console.log('[SearchAPI] Shutting down...');
    await server.close();
    await searchService.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error('[SearchAPI] Fatal error:', error);
  process.exit(1);
});
