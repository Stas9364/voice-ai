"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { playPcmChunk, stopAudioPlayback } from "@/lib/gemini/audioPlayback";
import { createLiveStream } from "@/lib/gemini/live-api-client";
import { createLiveStreamDirectWS } from "@/lib/gemini/live-api-client-ws";

export type LiveAPIStatus = "idle" | "connecting" | "connected" | "error";

export interface LiveAPIContextValue {
  status: LiveAPIStatus;
  error: string | null;
  email: string;
  setEmail: (email: string) => void;
  memorySummary: string | null;
  isMemoryLoading: boolean;
  memoryError: string | null;
  clearMemory: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendAudio: (base64Pcm: string) => void;
  sendAudioStreamEnd: () => void;
  /** Send function call results back to the model (for tool calls). */
  sendToolResponse: (
    functionResponses:
      | { id?: string; name?: string; response?: Record<string, unknown> }
      | Array<{ id?: string; name?: string; response?: Record<string, unknown> }>
  ) => void;
  /** Accumulated text responses from the model (for Transcript). */
  transcript: string[];
}

export const LiveAPIContext =
  createContext<LiveAPIContextValue | undefined>(undefined);

interface LiveAPIProviderProps {
  children: ReactNode;
}

export function LiveAPIProvider({ children }: LiveAPIProviderProps) {
  const [status, setStatus] = useState<LiveAPIStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [email, setEmailState] = useState("");
  const [memorySummary, setMemorySummary] = useState<string | null>(null);
  const [isMemoryLoading, setIsMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const streamControllerRef = useRef<
    ReturnType<typeof createLiveStream> | ReturnType<typeof createLiveStreamDirectWS> | null
  >(null);
  const sessionIdRef = useRef<string | null>(null);
  const eventLogRef = useRef<Array<{ role: "assistant" | "meta"; content: string; createdAt: string }>>([]);

  const normalizeEmail = useCallback((value: string) => value.trim().toLowerCase(), []);

  const flushSessionMemory = useCallback(async () => {
    const normalizedEmail = normalizeEmail(email);
    const sessionId = sessionIdRef.current;
    const events = eventLogRef.current;

    if (!normalizedEmail || !sessionId || events.length === 0) return;

    try {
      const response = await fetch("/api/memory/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          sessionId,
          events,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
        const msg = body.error ?? `HTTP ${response.status}`;
        console.error("[memory] save session failed:", msg, body.code ?? "");
        setMemoryError(msg);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[memory] save session failed:", message);
      setMemoryError(message);
    } finally {
      eventLogRef.current = [];
      sessionIdRef.current = null;
    }
  }, [email, normalizeEmail]);

  const disconnect = useCallback(() => {
    void flushSessionMemory();
    streamControllerRef.current?.abort();
    streamControllerRef.current = null;
    stopAudioPlayback();
    setStatus("idle");
    setError(null);
  }, [flushSessionMemory]);

  const setEmail = useCallback(
    (value: string) => {
      setEmailState(value);
      if (!normalizeEmail(value)) {
        setMemorySummary(null);
        setMemoryError(null);
      }
    },
    [normalizeEmail]
  );

  const clearMemory = useCallback(async () => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return;
    setMemoryError(null);
    const response = await fetch("/api/memory/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${response.status}`);
    }
    setMemorySummary(null);
  }, [email, normalizeEmail]);

  const connect = useCallback(async () => {
    const normalizedEmail = normalizeEmail(email);
    setError(null);
    setMemoryError(null);
    setTranscript([]);
    setStatus("connecting");
    eventLogRef.current = [
      { role: "meta", content: "voice_session_started", createdAt: new Date().toISOString() },
    ];
    sessionIdRef.current = crypto.randomUUID();

    let initialSummary = "";
    if (normalizedEmail) {
      setIsMemoryLoading(true);
      try {
        const response = await fetch(
          `/api/memory/summary?email=${encodeURIComponent(normalizedEmail)}`
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${response.status}`);
        }
        const payload = (await response.json()) as { summary?: string | null };
        initialSummary = payload.summary?.trim() ?? "";
        setMemorySummary(initialSummary || null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setMemoryError(message);
      } finally {
        setIsMemoryLoading(false);
      }
    } else {
      setMemorySummary(null);
    }

    const useDirectWS =
      typeof window !== "undefined" &&
      typeof process.env.NEXT_PUBLIC_GEMINI_API_KEY === "string" &&
      process.env.NEXT_PUBLIC_GEMINI_API_KEY.length > 0;

    let resolveConnected: () => void;
    let rejectConnected: (err: Error) => void;
    let connectedSettled = false;
    const connectedPromise = new Promise<void>((resolve, reject) => {
      resolveConnected = () => {
        if (!connectedSettled) {
          connectedSettled = true;
          resolve();
        }
      };
      rejectConnected = (err: Error) => {
        if (!connectedSettled) {
          connectedSettled = true;
          reject(err);
        }
      };
    });
    const CONNECTED_TIMEOUT_MS = 15_000;

    const ctrl = useDirectWS
      ? createLiveStreamDirectWS({
          onOpen: () => {
            setStatus("connected");
            resolveConnected();
          },
          onText: (text) => {
            setTranscript((prev) => [...prev, text]);
            eventLogRef.current.push({
              role: "assistant",
              content: text,
              createdAt: new Date().toISOString(),
            });
          },
          onAudio: (data, mimeType) => {
            playPcmChunk(data, mimeType);
          },
          onToolCall: (toolCall) => {
            const calls = toolCall.functionCalls ?? [];
            const responses = calls.map((fc) => {
              if (fc.name === "get_current_time") {
                return {
                  id: fc.id,
                  name: fc.name,
                  response: { result: new Date().toISOString() },
                };
              }
              return { id: fc.id, name: fc.name, response: { result: "Unknown function" } };
            });
            if (responses.length) {
              streamControllerRef.current?.sendToolResponse(responses);
            }
          },
          onError: (message) => {
            console.log("[ws] onError:", message);
            setError(message);
            setStatus("error");
            rejectConnected(new Error(message));
          },
          onClose: (reason?: string) => {
            console.log("[ws] onClose reason:", reason);
            streamControllerRef.current = null;
            setStatus((s) => (s === "connected" ? "idle" : s));
            rejectConnected(new Error(reason ?? "Connection closed before open"));
          },
        }, { initialSummary })
      : createLiveStream({
      onOpen: () => setStatus("connected"),
      onText: (text) => {
        setTranscript((prev) => [...prev, text]);
        eventLogRef.current.push({
          role: "assistant",
          content: text,
          createdAt: new Date().toISOString(),
        });
      },
      onAudio: (data, mimeType) => {
        playPcmChunk(data, mimeType);
      },
      onToolCall: (toolCall) => {
        const calls = toolCall.functionCalls ?? [];
        const responses = calls.map((fc) => {
          if (fc.name === "get_current_time") {
            return {
              id: fc.id,
              name: fc.name,
              response: { result: new Date().toISOString() },
            };
          }
          return { id: fc.id, name: fc.name, response: { result: "Unknown function" } };
        });
        if (responses.length) {
          streamControllerRef.current?.sendToolResponse(responses);
        }
      },
      onError: (message) => {
        setError(message);
        setStatus("error");
      },
      onClose: () => {
        streamControllerRef.current = null;
        setStatus((s) => (s === "connected" ? "idle" : s));
      },
    }, { initialSummary });

    try {
      await ctrl.start();
      if (useDirectWS) {
        await Promise.race([
          connectedPromise,
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error("Connection open timeout")), CONNECTED_TIMEOUT_MS)
          ),
        ]);
      }
      streamControllerRef.current = ctrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log("[ws] connect catch:", message);
      setError(message);
      setStatus("error");
      streamControllerRef.current = null;
    }
  }, [email, normalizeEmail]);

  const sendAudio = useCallback((base64Pcm: string) => {
    streamControllerRef.current?.sendAudio(base64Pcm);
  }, []);

  const sendAudioStreamEnd = useCallback(() => {
    streamControllerRef.current?.sendAudioStreamEnd();
  }, []);

  const sendToolResponse = useCallback(
    (
      functionResponses:
        | { id?: string; name?: string; response?: Record<string, unknown> }
        | Array<{ id?: string; name?: string; response?: Record<string, unknown> }>
    ) => {
      streamControllerRef.current?.sendToolResponse(functionResponses);
    },
    []
  );

  const value: LiveAPIContextValue = {
    status,
    error,
    email,
    setEmail,
    memorySummary,
    isMemoryLoading,
    memoryError,
    clearMemory,
    connect,
    disconnect,
    sendAudio,
    sendAudioStreamEnd,
    sendToolResponse,
    transcript,
  };

  return (
    <LiveAPIContext.Provider value={value}>{children}</LiveAPIContext.Provider>
  );
}

export function useLiveAPI(): LiveAPIContextValue {
  const ctx = useContext(LiveAPIContext);
  if (ctx === undefined) {
    throw new Error("useLiveAPI must be used within LiveAPIProvider");
  }
  return ctx;
}
