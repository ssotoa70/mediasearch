/**
 * MediaSearch ASR Worker
 *
 * Standalone worker process for ASR transcription.
 * Can run on CPU or GPU nodes.
 *
 * In the orchestrator architecture, the orchestrator calls ASR adapters directly.
 * This standalone worker is for scaling transcription independently.
 */

console.log('[ASR Worker] MediaSearch ASR Worker');
console.log('[ASR Worker] Use @mediasearch/orchestrator for integrated processing');
console.log('[ASR Worker] This worker is for standalone/scaled deployments');

// Export ASR adapters for use by orchestrator
export * from './adapters.js';
