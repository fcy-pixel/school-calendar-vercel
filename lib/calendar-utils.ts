import { CalendarEvent, CATEGORIES, CATEGORY_COLORS } from "./events";

export interface EventDraft {
  id: string;
  title: string;
  date: string;
  endDate: string;
  time: string;
  endTime: string;
  category: string;
  description: string;
  included: boolean;
}

export function hongKongDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((type) => parts.find((p) => p.type === type)?.value)
    .join("-");
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T12:00:00Z");
  return (
    !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  );
}

export function addDays(value: string, days: number): string {
  const date = new Date(value + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dateLabel(value: string, weekday = false): string {
  if (!validDate(value)) return "日期待確認";
  return new Intl.DateTimeFormat("zh-HK", {
    month: "long",
    day: "numeric",
    ...(weekday ? { weekday: "long" as const } : {}),
    timeZone: "Asia/Hong_Kong",
  }).format(new Date(value + "T12:00:00+08:00"));
}

export function lastEventDate(event: CalendarEvent): string {
  if (!event.end) return event.start.slice(0, 10);
  const date = event.end.slice(0, 10);
  // FullCalendar treats date-only and midnight ends as exclusive.
  if (
    !event.end.includes("T") ||
    /^00:00(?::00)?(?:[+.Z-]|$)/.test(event.end.slice(11))
  ) {
    return addDays(date, -1);
  }
  return date;
}

export function occursOn(event: CalendarEvent, date: string): boolean {
  return event.start.slice(0, 10) <= date && lastEventDate(event) >= date;
}

export function isPeriodReminder(event: CalendarEvent): boolean {
  return (
    /^【(?:本周主題|本週主題|周內辦妥|週內辦妥)】/.test(event.title) ||
    lastEventDate(event) > addDays(event.start.slice(0, 10), 14)
  );
}

export function emptyDraft(date: string): EventDraft {
  return {
    id: "",
    title: "",
    date,
    endDate: "",
    time: "",
    endTime: "",
    category: "活動",
    description: "",
    included: true,
  };
}

export function draftFromEvent(event: CalendarEvent): EventDraft {
  return {
    ...emptyDraft(event.start.slice(0, 10)),
    id: event.id,
    title: event.title,
    time: event.start.includes("T") ? event.start.slice(11, 16) : "",
    endDate: event.end ? lastEventDate(event) : "",
    endTime:
      event.end?.includes("T") && !event.end.slice(11).startsWith("00:00")
        ? event.end.slice(11, 16)
        : "",
    category: event.category,
    description: event.description || "",
  };
}

export function draftError(draft: EventDraft): string | null {
  if (!draft.title.trim()) return "請填寫活動名稱";
  if (!validDate(draft.date)) return "請確認開始日期";
  if (draft.endDate && !validDate(draft.endDate)) return "請確認結束日期";
  if (draft.endDate && draft.endDate < draft.date)
    return "結束日期不可早於開始日期";
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (draft.time && !timePattern.test(draft.time)) return "開始時間格式不正確";
  if (draft.endTime && (!draft.time || !timePattern.test(draft.endTime)))
    return "請確認開始及結束時間";
  if (
    draft.endTime &&
    (!draft.endDate || draft.endDate === draft.date) &&
    draft.endTime <= draft.time
  ) {
    return "結束時間需晚於開始時間";
  }
  if (!Object.hasOwn(CATEGORY_COLORS, draft.category)) return "請選擇活動分類";
  return null;
}

export function eventFromDraft(draft: EventDraft, id: string): CalendarEvent {
  const error = draftError(draft);
  if (error) throw new Error(error);
  const event: CalendarEvent = {
    id,
    title: draft.title.trim(),
    start: draft.date + (draft.time ? "T" + draft.time + ":00" : ""),
    category: draft.category,
    color: CATEGORY_COLORS[draft.category],
    description: draft.description.trim(),
  };
  if (draft.endTime)
    event.end = (draft.endDate || draft.date) + "T" + draft.endTime + ":00";
  else if (draft.endDate) event.end = addDays(draft.endDate, 1);
  return event;
}

function field(item: Record<string, unknown>, key: string): string {
  return typeof item[key] === "string" ? (item[key] as string).trim() : "";
}

export function categoryForItem(item: Record<string, unknown>): string {
  const category = field(item, "category");
  if (CATEGORIES.includes(category)) return category;
  // Only inspect this event, never the whole multi-event input.
  const text = field(item, "title") + " " + field(item, "description");
  if (
    item.event_type === "teacher_training" ||
    /教師進修|老師進修|教職員培訓|專業發展|teacher training/i.test(text)
  )
    return "教師進修";
  if (/假期|放假|公眾假日/.test(text)) return "假期";
  if (/評估|考試|測驗|默書|呈分/.test(text)) return "評估";
  if (/會議|科會|議會/.test(text)) return "會議";
  if (/交流|姊妹學校/.test(text)) return "交流";
  if (/旅行|校外|戶外|日營|參觀/.test(text)) return "校外活動";
  if (/課外活動|興趣班|訓練班/.test(text)) return "課外活動";
  if (/交回|提交|截止|校務|派發|籌備/.test(text)) return "校務";
  return "活動";
}

export function previewDrafts(input: unknown): EventDraft[] {
  const record =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const items = Array.isArray(input)
    ? input
    : Array.isArray(record.events)
      ? record.events
      : record.title
        ? [record]
        : [];
  return items
    .filter(
      (value): value is Record<string, unknown> =>
        !!value && typeof value === "object",
    )
    .map((item, index) => ({
      id: "preview-" + index,
      title: field(item, "title"),
      date: field(item, "date"),
      endDate: field(item, "end_date"),
      time: field(item, "time"),
      endTime: field(item, "end_time"),
      category: categoryForItem(item),
      description: field(item, "description"),
      included: true,
    }));
}

export function eventKey(event: CalendarEvent): string {
  const end =
    event.end || (!event.start.includes("T") ? addDays(event.start, 1) : "");
  return [event.title.trim().replace(/\s+/g, " "), event.start, end].join("|");
}

export function mergeNewEvents(
  existing: CalendarEvent[],
  incoming: CalendarEvent[],
): CalendarEvent[] {
  const keys = new Set(existing.map(eventKey));
  const next = [...existing];
  for (const event of incoming) {
    const key = eventKey(event);
    if (!keys.has(key)) {
      keys.add(key);
      next.push(event);
    }
  }
  return next;
}
