"use client";

/**
 * Прямое WebSocket-подключение к Gemini Live API из браузера (без route.ts).
 * Ключ берётся из NEXT_PUBLIC_GEMINI_API_KEY — только для разработки/личного использования.
 * В продакшене используйте createLiveStream из live-api-client.ts (прокси через API route).
 */

import { GoogleGenAI, Modality } from "@google/genai";
import type { LiveServerMessage, Session } from "@google/genai";

const LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";
const AUDIO_MIME = "audio/pcm;rate=16000";

export type LiveStreamEvent =
  | { type: "open" }
  | { type: "text"; text: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "toolCall"; toolCall: unknown }
  | { type: "error"; message: string }
  | { type: "close"; reason?: string };

export interface LiveStreamCallbacks {
  onOpen?: () => void;
  onText?: (text: string) => void;
  onTurnComplete?: () => void;
  onAudio?: (data: string, mimeType: string) => void;
  onToolCall?: (toolCall: { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> }) => void;
  onError?: (message: string) => void;
  onClose?: (reason?: string) => void;
}

export interface FunctionResponsePayload {
  id?: string;
  name?: string;
  response?: Record<string, unknown>;
}

export interface LiveStreamOptions {
  initialSummary?: string;
}

export type LiveStreamController = {
  sendAudio: (base64Pcm: string) => void;
  sendAudioStreamEnd: () => void;
  sendToolResponse: (functionResponses: FunctionResponsePayload | FunctionResponsePayload[]) => void;
  abort: () => void;
  start: () => Promise<void>;
};

/**
 * Подключение к Live API по WebSocket напрямую из браузера.
 * Требует NEXT_PUBLIC_GEMINI_API_KEY в .env.local.
 */
function isClosedSocketError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /CLOSING|CLOSED|already closed/i.test(msg);
}

export function createLiveStreamDirectWS(
  callbacks: LiveStreamCallbacks = {},
  options: LiveStreamOptions = {}
): LiveStreamController {
  let session: Session | null = null;

  return {
    sendAudio(base64Pcm: string) {
      if (!session) return;
      try {
        session.sendRealtimeInput({
          audio: { data: base64Pcm, mimeType: AUDIO_MIME },
        });
      } catch (e) {
        if (!isClosedSocketError(e)) throw e;
      }
    },
    sendAudioStreamEnd() {
      if (!session) return;
      try {
        session.sendRealtimeInput({ audioStreamEnd: true });
      } catch (e) {
        if (!isClosedSocketError(e)) throw e;
      }
    },
    sendToolResponse(functionResponses: FunctionResponsePayload | FunctionResponsePayload[]) {
      if (!session) return;
      try {
        session.sendToolResponse({
          functionResponses: Array.isArray(functionResponses) ? functionResponses : [functionResponses],
        });
      } catch (e) {
        if (!isClosedSocketError(e)) throw e;
      }
    },
    abort() {
      const s = session;
      session = null;
      try {
        s?.close();
      } catch (e) {
        if (!isClosedSocketError(e)) throw e;
      }
    },
    async start(): Promise<void> {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY as string | undefined;
      if (!apiKey?.trim()) {
        throw new Error(
          "Для прямого WS задайте NEXT_PUBLIC_GEMINI_API_KEY в .env.local (только для разработки)."
        );
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          baseUrl: "https://generativelanguage.googleapis.com",
          apiVersion: "v1beta",
        },
      });
      session = await ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          ...(options.initialSummary
            ? {
                systemInstruction: {
                  parts: [
                    {
                      text: `Предыдущий контекст пользователя:\n${options.initialSummary}\n\nПродолжай разговор с учетом этого контекста.`,
                    },
                  ],
                },
              }
            : {}),
        },
        callbacks: {
          onopen: () => callbacks.onOpen?.(),
          onmessage: (msg: LiveServerMessage) => {
            if (msg.serverContent?.turnComplete) callbacks.onTurnComplete?.();
            const parts = msg.serverContent?.modelTurn?.parts;
            if (parts) {
              for (const part of parts) {
                const textPart = (part as { text?: string }).text;
                if (textPart) callbacks.onText?.(textPart);
                const blob = (part as { inlineData?: { data?: string; mimeType?: string } }).inlineData;
                if (blob?.data && blob?.mimeType?.startsWith("audio/")) {
                  callbacks.onAudio?.(blob.data, blob.mimeType);
                }
              }
            }
            if (msg.toolCall) callbacks.onToolCall?.(msg.toolCall as { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> });
          },
          onerror: (e: ErrorEvent) => callbacks.onError?.(e.message ?? String(e)),
          onclose: (e: CloseEvent) => {
            session = null;
            callbacks.onClose?.(e.reason);
          },
        },
      });
    },
  };
}
