import { NextRequest, NextResponse } from "next/server";
import { parseEventsWithQwen } from "../../../lib/qwen";
import { CATEGORY_COLORS } from "../../../lib/events";
import type { CalendarEvent } from "../../../lib/events";

export const runtime = "edge";

// Gmail 自動匯入 endpoint：由 Google Apps Script 每日定時呼叫。
// 流程：驗證 x-ingest-key → Qwen 解析郵件內容 → 去重後寫入 Firestore。

const EMAIL_CATEGORY = "郵件匯入";
const MAX_EMAILS_PER_REQUEST = 20;
const MAX_TEXT_LENGTH = 6000;

// Firebase 客戶端設定本身是公開的（已內嵌於前端 JS），此處作為 env 缺失時的後備
const FALLBACK_PROJECT_ID = "schoolcaldener";
const FALLBACK_FB_API_KEY = "AIzaSyB4Ef1tgYk3lETFh0d_0Oeo5fuEjKWZQlk";

interface IncomingEmail {
  subject?: string;
  body?: string;
}

function firestoreDocUrl(): string {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || FALLBACK_PROJECT_ID;
  const apiKey =
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY || FALLBACK_FB_API_KEY;
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/school_calendar/events?key=${apiKey}`;
}

// Firestore REST value 格式 ↔ CalendarEvent（所有欄位皆為字串）
type FsValue = { stringValue?: string };
type FsMap = { mapValue: { fields: Record<string, FsValue> } };

function decodeEvents(doc: unknown): CalendarEvent[] {
  const values =
    (doc as { fields?: { events?: { arrayValue?: { values?: FsMap[] } } } })
      ?.fields?.events?.arrayValue?.values ?? [];
  return values.map((v) => {
    const f = v.mapValue?.fields ?? {};
    const ev: CalendarEvent = {
      id: f.id?.stringValue ?? "",
      title: f.title?.stringValue ?? "",
      start: f.start?.stringValue ?? "",
      color: f.color?.stringValue ?? "",
      category: f.category?.stringValue ?? "",
    };
    if (f.end?.stringValue) ev.end = f.end.stringValue;
    if (f.description?.stringValue) ev.description = f.description.stringValue;
    return ev;
  });
}

function encodeEvents(events: CalendarEvent[]): FsMap[] {
  return events.map((ev) => {
    const fields: Record<string, FsValue> = {
      id: { stringValue: ev.id },
      title: { stringValue: ev.title },
      start: { stringValue: ev.start },
      color: { stringValue: ev.color },
      category: { stringValue: ev.category },
    };
    if (ev.end) fields.end = { stringValue: ev.end };
    if (ev.description) fields.description = { stringValue: ev.description };
    return { mapValue: { fields } };
  });
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function POST(req: NextRequest) {
  const ingestKey = process.env.EMAIL_INGEST_KEY;
  if (!ingestKey) {
    return NextResponse.json(
      { error: "EMAIL_INGEST_KEY not configured" },
      { status: 500 }
    );
  }
  if (req.headers.get("x-ingest-key") !== ingestKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const qwenKey = process.env.QWEN_API_KEY;
  if (!qwenKey) {
    return NextResponse.json(
      { error: "QWEN_API_KEY not configured" },
      { status: 500 }
    );
  }

  let emails: IncomingEmail[];
  let dryRun = false;
  try {
    const body = await req.json();
    emails = Array.isArray(body?.emails) ? body.emails : [];
    dryRun = body?.dryRun === true;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (emails.length === 0) {
    return NextResponse.json({ added: 0, skipped: 0, events: [] });
  }
  emails = emails.slice(0, MAX_EMAILS_PER_REQUEST);

  // 逐封郵件解析（一封郵件可含多個事件）
  const parsedEvents: { ev: CalendarEvent; fromSubject: string }[] = [];
  const errors: string[] = [];
  const baseId = Date.now();

  for (let i = 0; i < emails.length; i++) {
    const subject = (emails[i].subject || "").trim();
    const body = (emails[i].body || "").trim();
    const text = `郵件標題：${subject}\n郵件內容：\n${body}`.slice(
      0,
      MAX_TEXT_LENGTH
    );
    try {
      const items = await parseEventsWithQwen(text, qwenKey);
      items.forEach((item, j) => {
        const ev: CalendarEvent = {
          id: `em${baseId}_${i}_${j}`,
          title: item.title || subject,
          start: item.time ? `${item.date}T${item.time}:00` : item.date,
          color: CATEGORY_COLORS[EMAIL_CATEGORY],
          category: EMAIL_CATEGORY,
          description:
            (item.description ? item.description + "\n" : "") +
            `（來自郵件：${subject}）`,
        };
        if (item.end_date && item.end_date !== item.date) {
          // FullCalendar 全日事件的 end 為排他日期，需 +1 天
          const endD = new Date(item.end_date + "T00:00:00");
          endD.setDate(endD.getDate() + 1);
          ev.end = toDateStr(endD);
        }
        parsedEvents.push({ ev, fromSubject: subject });
      });
    } catch (e) {
      errors.push(
        `「${subject}」: ${e instanceof Error ? e.message : "解析失敗"}`
      );
    }
  }

  if (parsedEvents.length === 0) {
    return NextResponse.json({ added: 0, skipped: 0, events: [], errors });
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      added: parsedEvents.length,
      skipped: 0,
      events: parsedEvents.map((p) => `${p.ev.start} ${p.ev.title}`),
      errors,
    });
  }

  // 讀取現有事件 → 以（標題+開始日期）去重 → 寫回
  const url = firestoreDocUrl();
  const getRes = await fetch(url);
  if (!getRes.ok && getRes.status !== 404) {
    return NextResponse.json(
      { error: `Firestore read failed: ${getRes.status}` },
      { status: 502 }
    );
  }
  const existing = getRes.ok ? decodeEvents(await getRes.json()) : [];
  const existingKeys = new Set(
    existing.map((ev) => `${ev.title}|${ev.start.slice(0, 10)}`)
  );

  const fresh = parsedEvents.filter(
    (p) => !existingKeys.has(`${p.ev.title}|${p.ev.start.slice(0, 10)}`)
  );
  const skipped = parsedEvents.length - fresh.length;

  if (fresh.length > 0) {
    const all = [...existing, ...fresh.map((p) => p.ev)];
    const patchRes = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: { events: { arrayValue: { values: encodeEvents(all) } } },
      }),
    });
    if (!patchRes.ok) {
      return NextResponse.json(
        {
          error: `Firestore write failed: ${patchRes.status} ${await patchRes.text()}`,
        },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({
    added: fresh.length,
    skipped,
    events: fresh.map((p) => `${p.ev.start} ${p.ev.title}`),
    errors,
  });
}
