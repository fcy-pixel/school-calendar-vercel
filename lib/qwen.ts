// 共用的 Qwen 事件解析邏輯 — 供 /api/qwen（手動輸入）及 /api/ingest-email（Gmail 自動匯入）使用

export interface AIParsedEvent {
  title: string;
  date: string;
  time?: string;
  end_date?: string;
  description?: string;
  event_type?: string;
}

export function hongKongTodayContext(): { isoToday: string; todayStr: string } {
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
  const isoToday = `${yyyy}-${mm}-${dd}`;
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const weekday = weekdays[new Date(`${isoToday}T00:00:00+08:00`).getUTCDay()];
  const todayStr = `${yyyy}年${Number(mm)}月${Number(dd)}日（星期${weekday}）`;
  return { isoToday, todayStr };
}

function buildSystemPrompt(): string {
  const { isoToday, todayStr } = hongKongTodayContext();
  return (
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
    `3. 其他填 "other"。\n` +
    `如果文字中完全沒有具體事件（例如純廣告、閒聊），回傳 {"events":[]}。`
  );
}

// 呼叫 Qwen 將自然語言解析成事件陣列；解析不到事件時回傳空陣列
export async function parseEventsWithQwen(
  text: string,
  apiKey: string
): Promise<AIParsedEvent[]> {
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
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: text },
        ],
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Qwen API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  let content = data.choices?.[0]?.message?.content?.trim() || "";
  content = content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(content);

  // 相容模型可能回傳的不同形態：{events:[...]} / 直接陣列 / 單一物件
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

  return events.filter(
    (e): e is AIParsedEvent =>
      !!e && typeof e === "object" && !!(e as { date?: string }).date
  );
}
