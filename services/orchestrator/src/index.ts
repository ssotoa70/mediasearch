/**
 * MediaSearch Orchestrator Service
 *
 * Consumes transcription jobs from the queue and orchestrates:
 * 1. Download media from S3
 * 2. Call ASR engine for transcription
 * 3. Apply segmentation strategy
 * 4. Generate embeddings
 * 5. Store segments and embeddings
 * 6. Publish version (flip visibility to ACTIVE)
 *
 * Failure handling (PRD Section 16):
 * - Retryable errors: exponential backoff up to MAX_ATTEMPTS
 * - Non-retryable errors: immediate DLQ with triage_state
 * - DLQ items have recommended_action for operators
 */

import Fastify from 'fastify';
import { OrchestratorService } from './service.js';
import { createAdapters } from './adapters.js';

const PORT = parseInt(process.env.ORCHESTRATOR_PORT || '3003', 10);
const HOST = process.env.ORCHESTRATOR_HOST || '0.0.0.0';

async function main() {
  console.log('[Orchestrator] Starting MediaSearch Orchestrator Service...');

  // Create adapters based on BACKEND config
  const adapters = await createAdapters();
  const orchestrator = new OrchestratorService(adapters);

  // Initialize
  await orchestrator.initialize();

  // Create Fastify server for health checks
  const server = Fastify({ logger: true });

  server.get('/health', async () => {
    const healthy = await orchestrator.healthCheck();
    if (!healthy) {
      throw { statusCode: 503, message: 'Service unhealthy' };
    }
    return { status: 'healthy' };
  });

  server.get('/ready', async () => {
    return { status: 'ready' };
  });

  server.get('/stats', async () => {
    return orchestrator.getStats();
  });

  // Pause/resume processing
  server.post('/pause', async () => {
    await orchestrator.pause();
    return { status: 'paused' };
  });

  server.post('/resume', async () => {
    await orchestrator.resume();
    return { status: 'resumed' };
  });

  // Start consuming jobs
  await orchestrator.startProcessing();

  // Start HTTP server
  await server.listen({ port: PORT, host: HOST });
  console.log(`[Orchestrator] Server listening on ${HOST}:${PORT}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[Orchestrator] Shutting down...');
    await orchestrator.stop();
    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error('[Orchestrator] Fatal error:', error);
  process.exit(1);
});
