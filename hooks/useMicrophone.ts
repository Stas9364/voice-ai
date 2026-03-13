"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { processAudioBufferToBase64 } from "@/lib/gemini/audio";

export interface UseMicrophoneOptions {
  /** Called with each base64 PCM 16 kHz chunk. */
  onChunk?: (base64: string) => void;
  /** Called when the stream ends (e.g. after stop). */
  onStreamEnd?: () => void;
}

export interface UseMicrophoneReturn {
  start: () => Promise<void>;
  stop: () => void;
  isListening: boolean;
  /** Current input level 0…1 when listening, 0 when stopped. */
  level: number;
  error: string | null;
}

export function useMicrophone(options: UseMicrophoneOptions = {}): UseMicrophoneReturn {
  const [isListening, setIsListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const onChunkRef = useRef(options.onChunk);
  const onStreamEndRef = useRef(options.onStreamEnd);
  useEffect(() => {
    onChunkRef.current = options.onChunk;
    onStreamEndRef.current = options.onStreamEnd;
  }, [options.onChunk, options.onStreamEnd]);

  const stop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    analyserRef.current = null;
    setLevel(0);
    if (nodeRef.current) {
      try {
        nodeRef.current.disconnect();
      } catch {
        // already disconnected
      }
      nodeRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (contextRef.current) {
      void contextRef.current.close();
      contextRef.current = null;
    }
    setIsListening(false);
    onStreamEndRef.current?.();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (streamRef.current) {
      stop();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const context = new AudioContext();
      contextRef.current = context;

      const workletUrl =
        typeof window !== "undefined"
          ? new URL("/live-audio-worklet.js", window.location.origin).href
          : "/live-audio-worklet.js";
      await context.audioWorklet.addModule(workletUrl);

      const workletNode = new AudioWorkletNode(context, "live-audio-processor");
      nodeRef.current = workletNode;

      workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const data = e.data;
        if (!data?.length) return;
        const onChunk = onChunkRef.current;
        if (!onChunk) return;
        const base64 = processAudioBufferToBase64(data, context.sampleRate);
        onChunk(base64);
      };

      const source = context.createMediaStreamSource(stream);
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      source.connect(workletNode);
      workletNode.connect(silentGain);
      silentGain.connect(context.destination);

      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;
      setIsListening(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      stop();
    }
  }, [stop]);

  useEffect(() => {
    if (!isListening || !analyserRef.current) return;
    const analyser = analyserRef.current;
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (!analyserRef.current) return;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = data.length > 0 ? sum / data.length / 255 : 0;
      setLevel(Math.min(1, avg * 2));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [isListening]);

  return { start, stop, isListening, level, error };
}
