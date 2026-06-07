import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const { text } = await req.json();
  const apiKey = process.env.QWEN_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }
  if (!text || typeof text !== "string" || text.length > 2000) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // 以香港時區取得「今天」，避免 Edge runtime 預設 UTC 造成日期偏差
  const TZ = "Asia/Hong_Kong";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const yyyy = get("year");
  const mm = get("month");
  const dd = get("day");
  const isoToday = `${yyyy}-${mm}-${dd}`; // YYYY-MM-DD (HKT)
  // 用 HKT 的日期字串建立 Date 以取得正確星期
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const weekday = weekdays[new Date(`${isoToday}T00:00:00+08:00`).getUTCDay()];
  const todayStr = `${yyyy}年${Number(mm)}月${Number(dd)}日（星期${weekday}）`;

  const systemPrompt =
    `你是一個學校校曆助手。今天是 ${todayStr}（ISO: ${isoToday}，時區 Asia/Hong_Kong）。\n` +
    `所有相對日期（今天/明天/後天/下週X 等）一律以上述香港時區為準。\n` +
    `一段文字內可能包含「多個事件」和「多個日期」，請逐一拆解：不同事件、不同日期都要分開成獨立的活動。\n` +
    `請從自然語言中提取所有事件信息，只返回純JSON（不要加markdown代碼塊），固定回傳一個物件，格式：\n` +
    `{"events":[{"title":"活動名稱","date":"YYYY-MM-DD","time":"HH:MM","end_date":"YYYY-MM-DD","description":"","event_type":"school或teacher_training或other"}]}\n` +
    `events 為陣列，每個事件一個元素；time 和 end_date 可省略，title 與 date 必填，event_type 必填。\n` +
    `只有單一事件時也要放進 events 陣列。end_date 只用於「跨多天」的同一事件（例如連續假期）；不同日子的不同事件請各自獨立成元素，不要用 end_date 串連。\n` +
    `event_type 判斷規則（優先級由高到低）：\n` +
    `1. 若事件涉及老師/教師/教職員 外出、進修、培訓、研習、工作坊、專業發展，一律填 "teacher_training"。關鍵詞：進修、培訓、研習、工作坊、外出（指老師）、專業發展、teacher training。\n` +
    `2. 若事件是學校為學生/家長舉辦的活動（如家長會、校內評估、典禮、假期、旅行、比賽等），填 "school"。\n` +
    `3. 其他填 "other"。`;

  try {
    const res = await fetch(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "qwen-plus",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text },
          ],
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: errText }, { status: res.status });
    }

    const data = await res.json();
    let content = data.choices?.[0]?.message?.content?.trim() || "";
    content = content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(content);

    // 統一輸出成 { events: [...] }，相容模型可能回傳的不同形態：
    // 1. { events: [...] }（預期）  2. 直接是陣列 [...]  3. 單一物件 {...}
    let events: unknown[];
    if (Array.isArray(parsed)) {
      events = parsed;
    } else if (parsed && Array.isArray(parsed.events)) {
      events = parsed.events;
    } else if (parsed && typeof parsed === "object") {
      events = [parsed];
    } else {
      events = [];
    }
    // 過濾掉沒有 date 的無效項目
    events = events.filter(
      (e) => e && typeof e === "object" && (e as { date?: string }).date
    );

    return NextResponse.json({ events });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
