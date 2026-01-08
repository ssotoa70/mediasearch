/**
 * MediaSearch Ingest Service
 *
 * Handles S3 bucket notification events (ObjectCreated/ObjectRemoved)
 * and creates transcription jobs for media assets.
 *
 * Flow (PRD Section 5.2):
 * 1. Receive S3 event (ObjectCreated or ObjectRemoved)
 * 2. Validate media format
 * 3. Create/update asset in database with STAGING visibility
 * 4. Enqueue transcription job
 *
 * For deletions:
 * 1. Mark asset as tombstone
 * 2. Soft-delete all segments and embeddings
 */

import Fastify from 'fastify';
import { IngestService } from './service.js';
import { createAdapters } from './adapters.js';

const PORT = parseInt(process.env.INGEST_PORT || '3000', 10);
const HOST = process.env.INGEST_HOST || '0.0.0.0';

async function main() {
  console.log('[Ingest] Starting MediaSearch Ingest Service...');

  // Create adapters based on BACKEND config
  const adapters = await createAdapters();
  const ingestService = new IngestService(adapters);

  // Initialize all adapters
  await ingestService.initialize();

  // Create Fastify server for health checks and manual trigger
  const server = Fastify({ logger: true });

  // Health check endpoint
  server.get('/health', async () => {
    const healthy = await ingestService.healthCheck();
    if (!healthy) {
      throw { statusCode: 503, message: 'Service unhealthy' };
    }
    return { status: 'healthy' };
  });

  // Ready check (for Kubernetes)
  server.get('/ready', async () => {
    return { status: 'ready' };
  });

  // Manual S3 event trigger (for testing)
  server.post<{
    Body: {
      event_type: 'ObjectCreated' | 'ObjectRemoved';
      bucket: string;
      object_key: string;
      etag?: string;
      size?: number;
    };
  }>('/events/s3', async (request, reply) => {
    const { event_type, bucket, object_key, etag, size } = request.body;

    try {
      if (event_type === 'ObjectCreated') {
        await ingestService.handleObjectCreated(bucket, object_key, etag, size);
      } else if (event_type === 'ObjectRemoved') {
        await ingestService.handleObjectRemoved(bucket, object_key);
      }

      return { success: true };
    } catch (error) {
      request.log.error(error, 'Failed to process S3 event');
      reply.code(500);
      return { success: false, error: String(error) };
    }
  });

  // Stats endpoint
  server.get('/stats', async () => {
    return ingestService.getStats();
  });

  // Start S3 notification subscription
  const mediaBucket = process.env.MEDIA_BUCKET || 'media';
  await ingestService.startNotificationSubscription(mediaBucket);

  // Start HTTP server
  await server.listen({ port: PORT, host: HOST });
  console.log(`[Ingest] Server listening on ${HOST}:${PORT}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[Ingest] Shutting down...');
    await server.close();
    await ingestService.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error('[Ingest] Fatal error:', error);
  process.exit(1);
});
