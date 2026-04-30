import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const { text } = await req.json();
  const apiKey = process.env.QWEN_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }
  if (!text || typeof text !== "string" || text.length > 500) {
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
    `請從自然語言中提取事件信息，只返回純JSON（不要加markdown代碼塊），格式：\n` +
    `{"title":"活動名稱","date":"YYYY-MM-DD","time":"HH:MM","end_date":"YYYY-MM-DD","description":""}\n` +
    `time 和 end_date 可省略，date 必填。`;

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
    return NextResponse.json(parsed);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
