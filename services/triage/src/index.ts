/**
 * MediaSearch Triage Service
 *
 * Manages DLQ items and quarantined assets (PRD Section 16):
 * - Lists quarantined assets with triage_state
 * - Allows operators to retry, skip, or permanently fail assets
 * - Provides recommended actions based on error type
 *
 * Triage states:
 * - NEEDS_MEDIA_FIX: Codec/format issues requiring re-encoding
 * - NEEDS_ENGINE_TUNING: ASR engine configuration issues
 * - QUARANTINED: Unknown errors requiring investigation
 */

import Fastify from 'fastify';
import { TriageService } from './service.js';
import { createAdapters } from './adapters.js';

const PORT = parseInt(process.env.TRIAGE_PORT || '3002', 10);
const HOST = process.env.TRIAGE_HOST || '0.0.0.0';

async function main() {
  console.log('[Triage] Starting MediaSearch Triage Service...');

  const adapters = await createAdapters();
  const triageService = new TriageService(adapters);

  await triageService.initialize();

  const server = Fastify({ logger: true });

  // Health check
  server.get('/health', async () => {
    const healthy = await triageService.healthCheck();
    if (!healthy) {
      throw { statusCode: 503, message: 'Service unhealthy' };
    }
    return { status: 'healthy' };
  });

  // List quarantined assets
  server.get<{
    Querystring: { limit?: string; state?: string };
  }>('/quarantined', async (request) => {
    const limit = parseInt(request.query.limit || '50', 10);
    const state = request.query.state;

    const assets = await triageService.listQuarantined(limit, state);
    return { total: assets.length, assets };
  });

  // List DLQ items
  server.get<{
    Querystring: { limit?: string };
  }>('/dlq', async (request) => {
    const limit = parseInt(request.query.limit || '50', 10);
    const items = await triageService.listDLQ(limit);
    return { total: items.length, items };
  });

  // Retry a quarantined asset
  server.post<{
    Params: { assetId: string };
    Body: { engine?: string };
  }>('/quarantined/:assetId/retry', async (request) => {
    const { assetId } = request.params;
    const { engine } = request.body || {};

    await triageService.retryAsset(assetId, engine);
    return { success: true, assetId };
  });

  // Skip a quarantined asset (mark as permanently failed)
  server.post<{
    Params: { assetId: string };
    Body: { reason?: string };
  }>('/quarantined/:assetId/skip', async (request) => {
    const { assetId } = request.params;
    const { reason } = request.body || {};

    await triageService.skipAsset(assetId, reason);
    return { success: true, assetId };
  });

  // Remove DLQ item
  server.delete<{
    Params: { dlqId: string };
  }>('/dlq/:dlqId', async (request) => {
    const { dlqId } = request.params;
    await triageService.removeDLQItem(dlqId);
    return { success: true, dlqId };
  });

  // Stats
  server.get('/stats', async () => {
    return triageService.getStats();
  });

  await server.listen({ port: PORT, host: HOST });
  console.log(`[Triage] Server listening on ${HOST}:${PORT}`);

  const shutdown = async () => {
    console.log('[Triage] Shutting down...');
    await server.close();
    await triageService.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error('[Triage] Fatal error:', error);
  process.exit(1);
});
