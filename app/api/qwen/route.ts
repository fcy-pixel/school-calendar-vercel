import { NextRequest, NextResponse } from "next/server";
import { parseEventsWithQwen } from "../../../lib/qwen";

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

  try {
    const events = await parseEventsWithQwen(text, apiKey);
    return NextResponse.json({ events });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
