"use client";

type ConversationRole = "user" | "assistant" | "meta";

export interface ConversationEventInput {
  role: ConversationRole;
  content: string;
  createdAt?: string;
}

interface SummarySegment {
  addedAt: string;
  text: string;
}

interface MemoryRecord {
  id: string;
  summary: string | null;
  summarySegments: SummarySegment[];
  updatedAt: string;
  lastSessionId: string | null;
}

interface MemorySnapshot {
  summary: string | null;
  updatedAt: string | null;
  lastSessionId: string | null;
}

const DB_NAME = "speakerMemory";
const STORE_NAME = "conversationMemory";
const RECORD_ID = "default";
const DB_VERSION = 1;
const SUMMARY_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

function supportsIndexedDb(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
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

function filterSegmentsByRetention(
  segments: SummarySegment[],
  retentionMs: number,
  nowMs: number
): SummarySegment[] {
  const cutoff = nowMs - retentionMs;
  return segments.filter((segment) => {
    const time = Date.parse(segment.addedAt);
    return !Number.isNaN(time) && time >= cutoff;
  });
}

function deltaFromEvents(events: ConversationEventInput[]): string {
  const user = events
    .filter((event) => event.role === "user")
    .map((event) => event.content.trim())
    .filter(Boolean)
    .slice(-12);
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
  if (user.length) {
    points.push(`Ключевые реплики пользователя: ${user.join(" | ")}`);
  }
  if (assistant.length) {
    points.push(`Ключевые ответы ассистента: ${assistant.join(" | ")}`);
  }
  if (meta.length) {
    points.push(`Технические заметки: ${meta.join(" | ")}`);
  }
  return points.join("\n");
}

function summarize(events: ConversationEventInput[], previousSummary: string | null): string {
  const user = events
    .filter((event) => event.role === "user")
    .map((event) => event.content.trim())
    .filter(Boolean)
    .slice(-12);
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
  if (user.length) {
    points.push(`Ключевые реплики пользователя: ${user.join(" | ")}`);
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

function openDb(): Promise<IDBDatabase | null> {
  if (!supportsIndexedDb()) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

function getRecord(db: IDBDatabase): Promise<MemoryRecord | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(RECORD_ID);

    request.onsuccess = () => {
      const raw = request.result as Partial<MemoryRecord> | undefined;
      if (!raw) {
        resolve(null);
        return;
      }
      resolve({
        id: RECORD_ID,
        summary: typeof raw.summary === "string" ? raw.summary : null,
        summarySegments: parseSegments(raw.summarySegments),
        updatedAt:
          typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
        lastSessionId:
          typeof raw.lastSessionId === "string" ? raw.lastSessionId : null,
      });
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to read memory record"));
  });
}

function putRecord(db: IDBDatabase, record: MemoryRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(record);

    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to write memory record"));
  });
}

function deleteRecord(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(RECORD_ID);

    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new Error("Failed to delete memory record"));
  });
}

export async function loadSummary(): Promise<MemorySnapshot> {
  const db = await openDb();
  if (!db) {
    return { summary: null, updatedAt: null, lastSessionId: null };
  }
  try {
    const record = await getRecord(db);
    if (!record) {
      return { summary: null, updatedAt: null, lastSessionId: null };
    }
    return {
      summary: record.summary,
      updatedAt: record.updatedAt,
      lastSessionId: record.lastSessionId,
    };
  } finally {
    db.close();
  }
}

export async function appendEvents(params: {
  sessionId: string;
  events: ConversationEventInput[];
}): Promise<MemorySnapshot> {
  const db = await openDb();
  if (!db) {
    return { summary: null, updatedAt: null, lastSessionId: null };
  }
  try {
    const events = params.events.filter(
      (event) =>
        (event.role === "assistant" || event.role === "user" || event.role === "meta") &&
        typeof event.content === "string" &&
        event.content.trim().length > 0
    );

    const prev = await getRecord(db);
    const nowMs = Date.now();
    let segments = filterSegmentsByRetention(
      parseSegments(prev?.summarySegments),
      SUMMARY_RETENTION_MS,
      nowMs
    );

    const prevJoined = segments.map((segment) => segment.text).join("\n\n");
    const summary = summarize(events, prevJoined.trim() ? prevJoined : null);
    const delta = deltaFromEvents(events);
    if (delta.length > 0) {
      segments = [...segments, { addedAt: new Date().toISOString(), text: delta }];
    }
    segments = filterSegmentsByRetention(segments, SUMMARY_RETENTION_MS, nowMs);

    const updatedAt = new Date().toISOString();
    await putRecord(db, {
      id: RECORD_ID,
      summary,
      summarySegments: segments,
      updatedAt,
      lastSessionId: params.sessionId,
    });

    return { summary, updatedAt, lastSessionId: params.sessionId };
  } finally {
    db.close();
  }
}

export async function resetMemory(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await deleteRecord(db);
  } finally {
    db.close();
  }
}
