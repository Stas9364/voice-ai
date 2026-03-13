"use client";

/**
 * Parses sample rate from mime type (e.g. "audio/pcm;rate=24000" -> 24000).
 * Gemini Native Audio returns PCM 16-bit 24kHz; input from mic is 16kHz.
 */
function getSampleRateFromMimeType(mimeType: string): number {
  const match = mimeType.match(/rate=(\d+)/i);
  return match ? parseInt(match[1], 10) : 24000;
}

/**
 * Decodes base64 PCM 16-bit little-endian to Float32Array (-1..1).
 */
function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const pcm = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    float32[i] = pcm[i] / (pcm[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

let sharedContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!sharedContext) {
    sharedContext = new AudioContext();
  }
  return sharedContext;
}

const queue: { base64: string; mimeType: string }[] = [];
let isPlaying = false;

function playNext() {
  if (isPlaying || queue.length === 0) return;
  const item = queue.shift();
  if (!item) {
    playNext();
    return;
  }
  isPlaying = true;
  try {
    const ctx = getAudioContext();
    const rate = getSampleRateFromMimeType(item.mimeType);
    const samples = base64PcmToFloat32(item.base64);
    const buffer = ctx.createBuffer(1, samples.length, rate);
    buffer.getChannelData(0).set(samples);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      isPlaying = false;
      playNext();
    };
    source.start(0);
  } catch {
    isPlaying = false;
    playNext();
  }
}

/**
 * Queues a PCM audio chunk (base64) for playback. Supports e.g. "audio/pcm;rate=24000".
 * Chunks are played in order, one after another.
 */
export function playPcmChunk(base64: string, mimeType: string): void {
  if (!base64 || !mimeType.startsWith("audio/")) return;
  queue.push({ base64, mimeType });
  playNext();
}

/**
 * Stops playback and clears the queue.
 */
export function stopAudioPlayback(): void {
  queue.length = 0;
  isPlaying = false;
}
