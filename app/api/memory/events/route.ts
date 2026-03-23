import { getSupabaseServerClient } from "@/lib/supabase/server";

type ConversationRole = "user" | "assistant" | "meta";

interface ConversationEventInput {
  role: ConversationRole;
  content: string;
  createdAt?: string;
}

interface EventsPayload {
  email?: string;
  sessionId?: string;
  events?: ConversationEventInput[];
}

/** Если true — писать строки в conversation_events (детальный лог). Код сохранён, по умолчанию выключено. */
const PERSIST_CONVERSATION_EVENTS = false;

const SUMMARY_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

interface SummarySegment {
  addedAt: string;
  text: string;
}

function parseSegments(raw: unknown): SummarySegment[] {
  if (!Array.isArray(raw)) return [];
  const out: SummarySegment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const addedAt = rec.addedAt != null ? String(rec.addedAt) : "";
    const text = rec.text != null ? String(rec.text).trim() : "";
    if (addedAt && text) out.push({ addedAt, text });
  }
  return out;
}

function filterSegmentsByRetention(segments: SummarySegment[], retentionMs: number, nowMs: number): SummarySegment[] {
  const cutoff = nowMs - retentionMs;
  return segments.filter((s) => {
    const t = Date.parse(s.addedAt);
    return !Number.isNaN(t) && t >= cutoff;
  });
}

function deltaFromEvents(events: ConversationEventInput[]): string {
  const assistant = events
    .filter((event) => event.role === "assistant")
    .map((event) => event.content.trim())
    .filter(Boolean)
    .slice(-12);
  const meta = events
    .filter((event) => event.role === "meta")
    .map((event) => event.content.trim())
    .filter(Boolean)
    .slice(-4);

  const points: string[] = [];
  if (assistant.length) {
    points.push(`Ключевые ответы ассистента: ${assistant.join(" | ")}`);
  }
  if (meta.length) {
    points.push(`Технические заметки: ${meta.join(" | ")}`);
  }
  return points.join("\n");
}

function summarize(events: ConversationEventInput[], previousSummary: string | null): string {
  const assistant = events
    .filter((event) => event.role === "assistant")
    .map((event) => event.content.trim())
    .filter(Boolean)
    .slice(-12);
  const meta = events
    .filter((event) => event.role === "meta")
    .map((event) => event.content.trim())
    .filter(Boolean)
    .slice(-4);

  const points: string[] = [];
  if (previousSummary?.trim()) {
    points.push(`Предыдущий summary: ${previousSummary.trim()}`);
  }
  if (assistant.length) {
    points.push(`Ключевые ответы ассистента: ${assistant.join(" | ")}`);
  }
  if (meta.length) {
    points.push(`Технические заметки: ${meta.join(" | ")}`);
  }

  const text = points.join("\n");
  return text.length > 4000 ? text.slice(0, 4000) : text;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as EventsPayload;
    const email = body.email?.trim().toLowerCase();
    const sessionId = body.sessionId?.trim();
    const events = (body.events ?? []).filter(
      (event) =>
        (event.role === "assistant" || event.role === "user" || event.role === "meta") &&
        typeof event.content === "string" &&
        event.content.trim().length > 0
    );

    if (!email) {
      return Response.json({ error: "email is required" }, { status: 400 });
    }
    if (!sessionId) {
      return Response.json({ error: "sessionId is required" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();

    if (PERSIST_CONVERSATION_EVENTS && events.length > 0) {
      const rows = events.map((event) => ({
        email,
        session_id: sessionId,
        role: event.role,
        content: event.content.trim(),
        created_at: event.createdAt ?? new Date().toISOString(),
      }));

      const insertResult = await supabase.from("conversation_events").insert(rows);
      if (insertResult.error) {
        console.error("[memory/events] insert conversation_events:", insertResult.error);
        return Response.json(
          { error: insertResult.error.message, code: insertResult.error.code },
          { status: 500 }
        );
      }
    }

    const previousResult = await supabase
      .from("conversation_memory")
      .select("summary_segments")
      .eq("email", email)
      .maybeSingle();
    if (previousResult.error) {
      console.error("[memory/events] select conversation_memory:", previousResult.error);
      return Response.json(
        { error: previousResult.error.message, code: previousResult.error.code },
        { status: 500 }
      );
    }

    const nowMs = Date.now();
    let segments = filterSegmentsByRetention(
      parseSegments(previousResult.data?.summary_segments),
      SUMMARY_RETENTION_MS,
      nowMs
    );

    const prevJoined = segments.map((s) => s.text).join("\n\n");
    const summary = summarize(events, prevJoined.trim() ? prevJoined : null);

    const delta = deltaFromEvents(events);
    if (delta.length > 0) {
      segments = [...segments, { addedAt: new Date().toISOString(), text: delta }];
    }
    segments = filterSegmentsByRetention(segments, SUMMARY_RETENTION_MS, nowMs);

    const upsertResult = await supabase.from("conversation_memory").upsert(
      {
        email,
        summary,
        summary_segments: segments,
        updated_at: new Date().toISOString(),
        last_session_id: sessionId,
      },
      { onConflict: "email" }
    );
    if (upsertResult.error) {
      console.error("[memory/events] upsert conversation_memory:", upsertResult.error);
      return Response.json(
        { error: upsertResult.error.message, code: upsertResult.error.code },
        { status: 500 }
      );
    }

    return Response.json({ ok: true, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
