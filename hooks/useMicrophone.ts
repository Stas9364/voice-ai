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
  /** Вызвать синхронно при клике, до любых await — иначе iOS заблокирует AudioContext. */
  preinitAudioContext: () => void;
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
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const stateChangeHandlerRef = useRef<(() => void) | null>(null);
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
    const ctx = contextRef.current;
    if (ctx && stateChangeHandlerRef.current) {
      ctx.removeEventListener("statechange", stateChangeHandlerRef.current);
      stateChangeHandlerRef.current = null;
    }
    if (scriptProcessorRef.current) {
      try {
        scriptProcessorRef.current.disconnect();
      } catch {
        // already disconnected
      }
      scriptProcessorRef.current = null;
    }
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

  const preinitAudioContext = useCallback(() => {
    if (contextRef.current) return;
    const context = new AudioContext();
    contextRef.current = context;
    void context.resume();
  }, []);

  const start = useCallback(async () => {
    console.log("[mic] start called");
    setError(null);
    if (streamRef.current) {
      stop();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("[mic] got stream");
      streamRef.current = stream;

      stream.getTracks().forEach((t) => {
        t.addEventListener("ended", () => console.log("[mic] track ended:", t.label));
      });

      let context = contextRef.current;
      if (!context) {
        context = new AudioContext();
        contextRef.current = context;
      }
      console.log("[mic] context state:", context.state);
      if (context.state === "suspended") {
        await context.resume();
      }
      console.log("[mic] context resumed, state:", context.state);

      const onStateChange = () => {
        console.log("[mic] context statechange:", context?.state);
        if (context?.state === "suspended") {
          void context.resume();
        }
      };
      context.addEventListener("statechange", onStateChange);
      stateChangeHandlerRef.current = onStateChange;

      const source = context.createMediaStreamSource(stream);
      const silentGain = context.createGain();
      silentGain.gain.value = 0;

      let chunkCount = 0;
      const sendChunk = (data: Float32Array) => {
        if (!data?.length) return;
        chunkCount++;
        if (chunkCount <= 3 || chunkCount % 50 === 0) {
          console.log("[mic] chunk", chunkCount, "length:", data.length);
        }
        const onChunk = onChunkRef.current;
        if (!onChunk) return;
        const base64 = processAudioBufferToBase64(data, context!.sampleRate);
        onChunk(base64);
      };

      try {
        const workletUrl =
          typeof window !== "undefined"
            ? new URL("/live-audio-worklet.js", window.location.origin).href
            : "/live-audio-worklet.js";
        await context.audioWorklet.addModule(workletUrl);
        console.log("[mic] worklet loaded");
        const workletNode = new AudioWorkletNode(context, "live-audio-processor");
        nodeRef.current = workletNode;
        workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
          sendChunk(e.data);
        };
        source.connect(workletNode);
        workletNode.connect(silentGain);
      } catch (e) {
        console.log("[mic] worklet failed, fallback ScriptProcessor:", e);
        const bufferSize = 4096;
        const scriptProcessor = context.createScriptProcessor(bufferSize, 1, 1);
        scriptProcessorRef.current = scriptProcessor;
        scriptProcessor.onaudioprocess = (e: AudioProcessingEvent) => {
          const data = e.inputBuffer.getChannelData(0);
          sendChunk(Float32Array.from(data));
        };
        source.connect(scriptProcessor);
        scriptProcessor.connect(silentGain);
      }
      silentGain.connect(context.destination);

      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;
      setIsListening(true);
      console.log("[mic] setup complete");
    } catch (err) {
      console.error("[mic] error:", err);
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

  return { preinitAudioContext, start, stop, isListening, level, error };
}
