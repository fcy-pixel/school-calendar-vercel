import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { text } = await req.json();
  const apiKey = process.env.QWEN_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }
  if (!text || typeof text !== "string" || text.length > 500) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const today = new Date();
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const todayStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日（星期${weekdays[today.getDay()]}）`;

  const systemPrompt =
    `你是一個學校校曆助手。今天是 ${todayStr}。\n` +
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
