"use client";

/** Sample rate required by Gemini Live API (Hz). */
export const LIVE_SAMPLE_RATE = 16_000;

/** Recommended chunk duration in ms (100–200 ms balances latency and overhead). */
export const CHUNK_MS = 160;

/** Bytes per sample (16-bit = 2). */
const BYTES_PER_SAMPLE = 2;

/**
 * Converts Float32Array (-1…1) to 16-bit PCM little-endian (Int16Array).
 */
export function float32ToPcm16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

/**
 * Resamples a Float32 buffer from one sample rate to another (linear interpolation).
 */
export function resample(
  input: Float32Array,
  fromSampleRate: number,
  toSampleRate: number
): Float32Array {
  if (fromSampleRate === toSampleRate) return input;
  const ratio = fromSampleRate / toSampleRate;
  const outLength = Math.round(input.length / ratio);
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio;
    const idx = Math.floor(srcIndex);
    const frac = srcIndex - idx;
    const next = Math.min(idx + 1, input.length - 1);
    output[i] = input[idx] * (1 - frac) + input[next] * frac;
  }
  return output;
}

/**
 * Encodes a PCM 16-bit mono chunk to base64 (for sending to Live API).
 */
export function pcm16ChunkToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Computes how many samples make one chunk at 16 kHz for the given duration (ms).
 */
export function chunkSamplesForMs(ms: number, sampleRate: number = LIVE_SAMPLE_RATE): number {
  return Math.floor((sampleRate * ms) / 1000);
}

/**
 * Converts one buffer of Float32 audio (any sample rate) to base64 PCM 16 kHz mono
 * for the Live API: resample → PCM16 → base64.
 */
export function processAudioBufferToBase64(
  float32: Float32Array,
  fromSampleRate: number
): string {
  const resampled = resample(float32, fromSampleRate, LIVE_SAMPLE_RATE);
  const pcm = float32ToPcm16(resampled);
  return pcm16ChunkToBase64(pcm);
}
