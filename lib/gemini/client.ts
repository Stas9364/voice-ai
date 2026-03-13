import { GoogleGenAI, Modality } from "@google/genai";
import type { LiveConnectConfig, LiveConnectParameters, Session } from "@google/genai";

/** Live API model for real-time audio/text. */
export const LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

/**
 * Returns a Gemini API client. Server-only: uses GEMINI_API_KEY.
 * Do not import this file from client components — use the API route instead.
 */
export function getGeminiClient(): GoogleGenAI {
  if (typeof window !== "undefined") {
    throw new Error(
      "getGeminiClient() is server-only. Use fetch('/api/gemini-live') from the client."
    );
  }

  const apiKey = process.env.GEMINI_API_KEY as string | undefined;
  if (!apiKey?.trim()) {
    throw new Error(
      "Missing GEMINI_API_KEY. Set it in .env.local (server-side only)."
    );
  }

  return new GoogleGenAI({ apiKey });
}

/**
 * Connects to the Gemini Live API. Server-only.
 *
 * @param params.model - Model ID (default: gemini-2.5-flash-live)
 * @param params.config - Optional session config
 * @param params.callbacks - onopen, onmessage, onerror, onclose
 */
export async function connectLiveSession(
  params: Omit<LiveConnectParameters, "model"> & {
    model?: string;
  }
): Promise<Session> {
  const client = getGeminiClient();
  const { model = LIVE_MODEL, config, callbacks } = params;

  const connectConfig: LiveConnectConfig = {
    responseModalities: [Modality.TEXT, Modality.AUDIO],
    ...config,
  };

  return client.live.connect({
    model,
    config: connectConfig,
    callbacks,
  });
}
