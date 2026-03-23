import { connectLiveSession } from "@/lib/gemini/client";
import { defaultLiveTools } from "@/lib/gemini/tools";
import { Modality, type LiveServerMessage } from "@google/genai";

const AUDIO_MIME = "audio/pcm;rate=16000";

/** Prebuilt voice for Native Audio: Aoede, Charon, Fenrir, Kore, Puck */
const NATIVE_AUDIO_VOICE = "Aoede";

/**
 * Bridge proxy: browser ↔ this route ↔ Gemini Live API.
 * Not using Edge runtime: @google/genai SDK relies on Node.js (WebSocket). For long sessions
 * avoid serverless time limits (e.g. use self-hosted Node or Vercel Pro).
 */
export async function POST(request: Request) {
  const summaryHeader = request.headers.get("x-memory-summary");
  const memorySummary = summaryHeader?.trim() ? summaryHeader.trim() : null;
  const body = request.body;
  if (!body) {
    return new Response("Body required", { status: 400 });
  }

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  function send(event: object) {
    void writer.write(encoder.encode(JSON.stringify(event) + "\n"));
  }

  let session: Awaited<ReturnType<typeof connectLiveSession>>;
  try {
    session = await connectLiveSession({
    config: {
      tools: defaultLiveTools,
      responseModalities: [Modality.TEXT, Modality.AUDIO],
      ...(memorySummary
        ? {
            systemInstruction: {
              parts: [
                {
                  text: `Предыдущий контекст пользователя:\n${memorySummary}\n\nПродолжай разговор, учитывая этот контекст.`,
                },
              ],
            },
          }
        : {}),
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: NATIVE_AUDIO_VOICE },
        },
      },
    },
    callbacks: {
      onopen: () => send({ type: "open" }),
      onmessage: (msg: LiveServerMessage) => {
        const text = msg.text;
        if (text !== undefined && text !== "") send({ type: "text", text });
        if (msg.setupComplete) send({ type: "setupComplete" });
        if (msg.serverContent?.turnComplete) send({ type: "turnComplete" });
        const parts = msg.serverContent?.modelTurn?.parts;
        if (parts) {
          for (const part of parts) {
            const blob = (part as { inlineData?: { data?: string; mimeType?: string } }).inlineData;
            if (blob?.data && blob?.mimeType?.startsWith("audio/")) {
              send({ type: "audio", data: blob.data, mimeType: blob.mimeType });
            }
          }
        }
        if (msg.toolCall) send({ type: "toolCall", toolCall: msg.toolCall });
        if (msg.usageMetadata) send({ type: "usage", usage: msg.usageMetadata });
      },
      onerror: (e: ErrorEvent) => send({ type: "error", message: e.message ?? String(e) }),
      onclose: (e: CloseEvent) => {
        send({ type: "close", reason: e.reason });
        void writer.close();
      },
    },
  });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void writer.close();
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  request.signal.addEventListener("abort", () => {
    session.close();
    void writer.close();
  });

  (async () => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
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
            const obj = JSON.parse(trimmed) as {
              audio?: string;
              audioStreamEnd?: boolean;
              toolResponse?: { functionResponses: Array<{ id?: string; name?: string; response?: Record<string, unknown> }> };
            };
            if (obj.audio != null) {
              session.sendRealtimeInput({
                audio: { data: obj.audio, mimeType: AUDIO_MIME },
              });
            }
            if (obj.audioStreamEnd === true) {
              session.sendRealtimeInput({ audioStreamEnd: true });
            }
            if (obj.toolResponse?.functionResponses?.length) {
              session.sendToolResponse({
                functionResponses: obj.toolResponse.functionResponses,
              });
            }
          } catch {
            // skip malformed line
          }
        }
      }
      if (buffer.trim()) {
        try {
          const obj = JSON.parse(buffer.trim()) as {
            audio?: string;
            audioStreamEnd?: boolean;
            toolResponse?: { functionResponses: Array<{ id?: string; name?: string; response?: Record<string, unknown> }> };
          };
          if (obj.audio != null) {
            session.sendRealtimeInput({
              audio: { data: obj.audio, mimeType: AUDIO_MIME },
            });
          }
          if (obj.audioStreamEnd === true) {
            session.sendRealtimeInput({ audioStreamEnd: true });
          }
          if (obj.toolResponse?.functionResponses?.length) {
            session.sendToolResponse({
              functionResponses: obj.toolResponse.functionResponses,
            });
          }
        } catch {
          // skip
        }
      }
    } finally {
      session.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    },
  });
}
