import { NextRequest, NextResponse } from "next/server";
import { parseEventsWithQwen } from "../../../lib/qwen";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "輸入格式不正確" }, { status: 400 });
  }
  const text =
    body && typeof body === "object"
      ? (body as { text?: unknown }).text
      : undefined;
  if (typeof text !== "string" || !text.trim() || text.length > 6000) {
    return NextResponse.json(
      { error: "請輸入活動內容（最多 6,000 字）" },
      { status: 400 },
    );
  }
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey)
    return NextResponse.json(
      { error: "AI 服務尚未就緒，請稍後重試或使用手動新增" },
      { status: 503 },
    );
  try {
    // This endpoint only parses; it never writes calendar data.
    const events = await parseEventsWithQwen(text.trim(), apiKey, true);
    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.name === "TimeoutError"
            ? "分析時間較長，請縮短內容再試"
            : "分析未完成，請稍後重試；你輸入的內容仍然保留",
      },
      { status: 502 },
    );
  }
}
