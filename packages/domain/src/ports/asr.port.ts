import { ASRResult, ASRSegment, EnginePolicy } from '../types/entities.js';
import { ASREngine, ChunkingStrategy, ExecutionMode } from '../types/enums.js';

/**
 * ASR (Automatic Speech Recognition) port interface
 *
 * Production: NVIDIA NIMs adapter (default), Whisper adapter, BYO adapter
 * Local: Stub adapter for development
 *
 * As defined in PRD Section 6: "pluggable transcription engines"
 */
export interface ASRPort {
  /**
   * Initialize the ASR engine connection
   */
  initialize(): Promise<void>;

  /**
   * Get the engine type
   */
  getEngine(): ASREngine;

  /**
   * Transcribe audio buffer
   * @param audio Audio data as buffer
   * @param options Transcription options
   */
  transcribe(audio: Buffer, options: TranscribeOptions): Promise<ASRResult>;

  /**
   * Check if engine supports GPU execution
   */
  supportsGPU(): boolean;

  /**
   * Get engine capabilities
   */
  getCapabilities(): ASRCapabilities;

  /**
   * Health check
   */
  healthCheck(): Promise<boolean>;

  /**
   * Close connection
   */
  close(): Promise<void>;
}

export interface TranscribeOptions {
  /** Enable speaker diarization (default: true per PRD) */
  diarization: boolean;

  /** Execution mode (CPU/GPU) */
  executionMode: ExecutionMode;

  /** Language hint */
  language?: string;

  /** Content type of audio */
  contentType: string;

  /** Duration hint in ms (for progress reporting) */
  durationHint?: number;
}

export interface ASRCapabilities {
  /** Supported audio formats */
  supportedFormats: string[];

  /** Supports speaker diarization */
  supportsDiarization: boolean;

  /** Maximum audio duration in seconds */
  maxDurationSeconds: number;

  /** Supported languages */
  supportedLanguages: string[];
}

/**
 * ASR Engine Factory interface
 * Creates ASR adapters based on engine policy
 */
export interface ASREngineFactory {
  /**
   * Create ASR adapter for given engine
   */
  createAdapter(engine: ASREngine): ASRPort;

  /**
   * Get available engines
   */
  getAvailableEngines(): ASREngine[];
}

/**
 * Segment raw ASR output based on strategy
 * As defined in PRD Section 7:
 * - Default: sentence-level segmentation
 * - Fallback: fixed 5-second windows when compute thresholds exceeded
 */
export interface Segmenter {
  /**
   * Segment ASR result based on strategy
   */
  segment(
    result: ASRResult,
    strategy: ChunkingStrategy
  ): ASRSegment[];

  /**
   * Determine optimal chunking strategy based on media duration and policy
   */
  selectStrategy(
    durationMs: number,
    policy: EnginePolicy
  ): ChunkingStrategy;
}

/**
 * Default fixed window duration in milliseconds (5 seconds per PRD Section 7.2)
 */
export const FIXED_WINDOW_DURATION_MS = 5000;

/**
 * Create a sentence-based segmenter
 */
export function createSentenceSegments(
  segments: ASRSegment[],
  text: string
): ASRSegment[] {
  // Combine all segments into one text, then re-segment by sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

  const result: ASRSegment[] = [];
  let currentTime = segments[0]?.start_ms ?? 0;

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    // Find approximate end time based on text proportion
    const textRatio = trimmed.length / text.length;
    const totalDuration = (segments[segments.length - 1]?.end_ms ?? 0) - (segments[0]?.start_ms ?? 0);
    const segmentDuration = totalDuration * textRatio;

    result.push({
      start_ms: currentTime,
      end_ms: currentTime + segmentDuration,
      text: trimmed,
      speaker: null, // Re-assign speakers based on overlap
      confidence: segments[0]?.confidence ?? 0.9,
    });

    currentTime += segmentDuration;
  }

  return result;
}

/**
 * Create fixed 5-second window segments
 * As per PRD Section 7.2: "fall back to fixed 5-second windows"
 */
export function createFixedWindowSegments(
  segments: ASRSegment[],
  windowDurationMs: number = FIXED_WINDOW_DURATION_MS
): ASRSegment[] {
  if (segments.length === 0) return [];

  const startTime = segments[0].start_ms;
  const endTime = segments[segments.length - 1].end_ms;
  const result: ASRSegment[] = [];

  for (let windowStart = startTime; windowStart < endTime; windowStart += windowDurationMs) {
    const windowEnd = Math.min(windowStart + windowDurationMs, endTime);

    // Collect text from segments that overlap this window
    const windowSegments = segments.filter(
      (s) => s.end_ms > windowStart && s.start_ms < windowEnd
    );

    if (windowSegments.length === 0) continue;

    const text = windowSegments.map((s) => s.text).join(' ');
    const avgConfidence =
      windowSegments.reduce((sum, s) => sum + s.confidence, 0) / windowSegments.length;

    // Most common speaker in window
    const speakers = windowSegments.map((s) => s.speaker).filter(Boolean);
    const speaker = speakers.length > 0
      ? speakers.sort((a, b) =>
          speakers.filter((s) => s === a).length - speakers.filter((s) => s === b).length
        ).pop() ?? null
      : null;

    result.push({
      start_ms: windowStart,
      end_ms: windowEnd,
      text: text.trim(),
      speaker,
      confidence: avgConfidence,
    });
  }

  return result;
}
