"use client";

/**
 * Client-side API for Gemini Live. No API key is used in the browser —
 * all requests go through POST /api/gemini-live (key is on the server).
 */

const NDJSON_MIME = "application/x-ndjson";

export type LiveStreamEvent =
  | { type: "open" }
  | { type: "setupComplete" }
  | { type: "text"; text: string }
  | { type: "turnComplete" }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "toolCall"; toolCall: unknown }
  | { type: "usage"; usage: unknown }
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

export interface LiveStreamOptions {
  initialSummary?: string;
}

/** One function response for sendToolResponse. */
export interface FunctionResponsePayload {
  id?: string;
  name?: string;
  response?: Record<string, unknown>;
}

const encoder = new TextEncoder();

/**
 * Opens a streaming connection to the Live API via our server.
 * Send audio with sendAudio(), read events from the returned stream or callbacks.
 *
 * @param callbacks - Optional handlers for stream events
 * @returns Controller with sendAudio(), sendAudioStreamEnd(), sendToolResponse(), and abort()
 */
export function createLiveStream(
  callbacks: LiveStreamCallbacks = {},
  options: LiveStreamOptions = {}
): {
  sendAudio: (base64Pcm: string) => void;
  sendAudioStreamEnd: () => void;
  sendToolResponse: (functionResponses: FunctionResponsePayload | FunctionResponsePayload[]) => void;
  abort: () => void;
  start: () => Promise<ReadableStream<LiveStreamEvent>>;
} {
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let abortController: AbortController | null = null;

  function sendLine(obj: object) {
    if (writer) {
      void writer.write(encoder.encode(JSON.stringify(obj) + "\n"));
    }
  }

  return {
    sendAudio(base64Pcm: string) {
      sendLine({ audio: base64Pcm });
    },
    sendAudioStreamEnd() {
      sendLine({ audioStreamEnd: true });
    },
    sendToolResponse(functionResponses: FunctionResponsePayload | FunctionResponsePayload[]) {
      sendLine({
        toolResponse: {
          functionResponses: Array.isArray(functionResponses) ? functionResponses : [functionResponses],
        },
      });
    },
    abort() {
      abortController?.abort();
    },
    async start(): Promise<ReadableStream<LiveStreamEvent>> {
      abortController = new AbortController();
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      writer = writable.getWriter();

      // Use 127.0.0.1 instead of localhost to avoid ERR_ALPN_NEGOTIATION_FAILED with streaming fetch
      const apiUrl =
        typeof window !== "undefined" && window.location.hostname === "localhost"
          ? `http://127.0.0.1:${window.location.port}/api/gemini-live`
          : "/api/gemini-live";

      const response = await fetch(apiUrl, {
        method: "POST",
        body: readable,
        signal: abortController.signal,
        headers: {
          "Content-Type": NDJSON_MIME,
          ...(options.initialSummary
            ? { "x-memory-summary": options.initialSummary }
            : {}),
        },
        ...({ duplex: "half" } as RequestInit),
      });

      if (!response.ok || !response.body) {
        writer = null;
        const text = await response.text();
        let message = text || `HTTP ${response.status}`;
        try {
          const json = JSON.parse(text) as { error?: string };
          if (json.error) message = json.error;
        } catch {
          // use raw text
        }
        throw new Error(response.status === 400 ? "Body required" : message);
      }
      const decoder = new TextDecoder();
      let buffer = "";

      const eventStream = new ReadableStream<LiveStreamEvent>({
        async start(controller) {
          const reader = response.body!.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const event = JSON.parse(trimmed) as LiveStreamEvent;
                  controller.enqueue(event);
                  if (event.type === "open") callbacks.onOpen?.();
                  else if (event.type === "text") callbacks.onText?.(event.text);
                  else if (event.type === "turnComplete") callbacks.onTurnComplete?.();
                  else if (event.type === "audio") callbacks.onAudio?.(event.data, event.mimeType);
                  else if (event.type === "toolCall")
                    callbacks.onToolCall?.(event.toolCall as { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> });
                  else if (event.type === "error") callbacks.onError?.(event.message);
                  else if (event.type === "close") callbacks.onClose?.(event.reason);
                } catch {
                  // skip
                }
              }
            }
            if (buffer.trim()) {
              try {
                const event = JSON.parse(buffer.trim()) as LiveStreamEvent;
                controller.enqueue(event);
                if (event.type === "open") callbacks.onOpen?.();
                else if (event.type === "text") callbacks.onText?.(event.text);
                else if (event.type === "turnComplete") callbacks.onTurnComplete?.();
                else if (event.type === "audio") callbacks.onAudio?.(event.data, event.mimeType);
                else if (event.type === "toolCall")
                  callbacks.onToolCall?.(event.toolCall as { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> });
                else if (event.type === "error") callbacks.onError?.(event.message);
                else if (event.type === "close") callbacks.onClose?.(event.reason);
              } catch {
                // skip
              }
            }
          } finally {
            controller.close();
          }
        },
      });

      return eventStream;
    },
  };
}
