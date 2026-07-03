"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import {
  CalendarEvent,
  CATEGORY_COLORS,
  CATEGORIES,
  PRELOADED_EVENTS,
  normalizeEvents,
} from "@/lib/events";

const FB_COLLECTION = "school_calendar";
const FB_DOCUMENT = "events";

// AI 解析後的單一事件（由 /api/qwen 回傳）
interface AIEvent {
  title?: string;
  date?: string;
  time?: string;
  end_date?: string;
  description?: string;
  event_type?: string;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function formatDate(d: Date) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（星期${WEEKDAYS[d.getDay()]}）`;
}

function toDateStr(d: Date) {
  // 使用本地時區（而非 UTC）輸出 YYYY-MM-DD，避免 toISOString() 造成跨日偏差
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getEventsForDate(target: string, events: CalendarEvent[]) {
  const t = new Date(target + "T00:00:00");
  return events.filter((ev) => {
    const s = new Date(ev.start.slice(0, 10) + "T00:00:00");
    const eEnd = ev.end
      ? new Date(
          new Date(ev.end.slice(0, 10) + "T00:00:00").getTime() -
            86400000
        )
      : s;
    return s <= t && t <= eEnd;
  });
}

export default function Home() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedDate, setSelectedDate] = useState(toDateStr(new Date()));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);

  // Sidebar sections toggle
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    import: false,
    manual: false,
    ai: false,
    export: false,
  });

  // Sidebar 整體收合（方便廣告機/電視全畫面顯示）
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Manual form
  const [mTitle, setMTitle] = useState("");
  const [mDate, setMDate] = useState(toDateStr(new Date()));
  const [mEnd, setMEnd] = useState("");
  const [mCat, setMCat] = useState(CATEGORIES[0]);
  const [mDesc, setMDesc] = useState("");

  // AI form
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  // Edit form
  const [eTitle, setETitle] = useState("");
  const [eStart, setEStart] = useState("");
  const [eEnd, setEEnd] = useState("");
  const [eCat, setECat] = useState("");
  const [eDesc, setEDesc] = useState("");

  const calRef = useRef<FullCalendar>(null);

  const showToast = useCallback((msg: string, error = false) => {
    setToast({ msg, error });
    setTimeout(() => setToast(null), 2500);
  }, []);

  // Save to Firebase
  const saveEvents = useCallback(async (evts: CalendarEvent[]) => {
    try {
      await setDoc(doc(db, FB_COLLECTION, FB_DOCUMENT), { events: evts });
    } catch (e) {
      console.error("Save error:", e);
    }
  }, []);

  // Load from Firebase on mount, subscribe for real-time
  useEffect(() => {
    const ref = doc(db, FB_COLLECTION, FB_DOCUMENT);

    // Initial load
    getDoc(ref).then((snap) => {
      if (snap.exists()) {
        const data = snap.data().events as CalendarEvent[];
        if (data && data.length > 0) {
          const { events: norm, changed } = normalizeEvents(data);
          setEvents(norm);
          if (changed) saveEvents(norm); // 一次性遷移舊「老師進修」事件並寫回
        } else {
          setEvents([...PRELOADED_EVENTS]);
          saveEvents([...PRELOADED_EVENTS]);
        }
      } else {
        setEvents([...PRELOADED_EVENTS]);
        saveEvents([...PRELOADED_EVENTS]);
      }
      setLoaded(true);
    }).catch(() => {
      setEvents([...PRELOADED_EVENTS]);
      setLoaded(true);
    });

    // Real-time listener
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const data = snap.data().events as CalendarEvent[];
        if (data) setEvents(normalizeEvents(data).events);
      }
    });

    return () => unsub();
  }, [saveEvents]);

  // ── 自動跟隨「當天」 ──
  // 此校曆常開於電視／廣告機，頁面可能連續開著多日。
  // 定時偵測日期是否已跨到新的一天，若是則自動切換到當天、
  // 並把日曆導航回今天，毋須人手點擊。
  useEffect(() => {
    let current = toDateStr(new Date());
    const tick = () => {
      const todayStr = toDateStr(new Date());
      if (todayStr !== current) {
        current = todayStr;
        setSelectedDate(todayStr);
        calRef.current?.getApi().today();
        // 跨日後重新載入整頁：確保「今天」高亮正確，同時自動取得最新部署版本。
        // 先以 HEAD 請求確認網絡正常，離線時保持原頁（靠上面的頁內更新）。
        fetch(window.location.href, { method: "HEAD", cache: "no-store" })
          .then((r) => { if (r.ok) window.location.reload(); })
          .catch(() => {});
      }
    };
    const id = setInterval(tick, 30 * 1000); // 每 30 秒檢查一次
    const onVisible = () => {
      if (!document.hidden) tick(); // 重新顯示分頁時立即檢查
    };
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // ── Add event (manual) ──
  const handleManualAdd = () => {
    if (!mTitle.trim()) return showToast("請輸入活動名稱", true);
    const ev: CalendarEvent = {
      id: `c${Date.now()}`,
      title: mTitle.trim(),
      start: mDate,
      color: CATEGORY_COLORS[mCat] || "#607d8b",
      category: mCat,
      description: mDesc,
    };
    if (mEnd && mEnd > mDate) {
      // FullCalendar end is exclusive for all-day
      const endD = new Date(mEnd + "T00:00:00");
      endD.setDate(endD.getDate() + 1);
      ev.end = toDateStr(endD);
    }
    const next = [...events, ev];
    setEvents(next);
    saveEvents(next);
    setMTitle("");
    setMDesc("");
    showToast(`✅ 已新增：${ev.title}`);
  };

  // ── AI parse ──
  const handleAI = async () => {
    if (!aiText.trim()) return showToast("請輸入活動描述", true);
    setAiLoading(true);
    try {
      const res = await fetch("/api/qwen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: aiText.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "AI request failed");
      }
      const result = await res.json();
      // API 統一回傳 { events: [...] }；亦相容舊有單一物件格式
      const items: AIEvent[] = Array.isArray(result?.events)
        ? result.events
        : result?.date
        ? [result]
        : [];

      if (items.length === 0) {
        throw new Error("找不到任何活動，請換個說法再試");
      }

      const teacherKeywords = ["進修", "培訓", "研習", "工作坊", "專業發展", "teacher training"];
      const baseId = Date.now();
      const newEvents: CalendarEvent[] = items.map((item, i) => {
        // 逐一判斷分類：學生事件 / 學校事件 / 新增
        const combinedText = (item.title || "") + aiText;
        const isTeacherTraining =
          item.event_type === "teacher_training" ||
          teacherKeywords.some((kw) => combinedText.includes(kw));
        const aiCategory = isTeacherTraining
          ? "學生事件"
          : item.event_type === "school"
          ? "學校事件"
          : "新增";
        const ev: CalendarEvent = {
          id: `ai${baseId}_${i}`,
          title: item.title || aiText.trim(),
          start: item.time
            ? `${item.date}T${item.time}:00`
            : item.date || toDateStr(new Date()),
          color: CATEGORY_COLORS[aiCategory],
          category: aiCategory,
          description: item.description || "",
        };
        if (item.end_date && item.end_date !== item.date) {
          // FullCalendar end is exclusive for all-day events, so +1 day
          const endD = new Date(item.end_date + "T00:00:00");
          endD.setDate(endD.getDate() + 1);
          ev.end = toDateStr(endD);
        }
        return ev;
      });

      const next = [...events, ...newEvents];
      setEvents(next);
      saveEvents(next);
      setAiText("");
      if (newEvents.length === 1) {
        showToast(`✅ 已新增：${newEvents[0].title}（${items[0].date || ""}）`);
      } else {
        showToast(`✅ 已新增 ${newEvents.length} 個活動`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "解析失敗";
      showToast(`❌ ${msg}`, true);
    } finally {
      setAiLoading(false);
    }
  };

  // ── Edit ──
  const startEdit = (ev: CalendarEvent) => {
    setEditingId(ev.id);
    setETitle(ev.title);
    setEStart(ev.start.slice(0, 10));
    if (ev.end) {
      const d = new Date(ev.end.slice(0, 10) + "T00:00:00");
      d.setDate(d.getDate() - 1);
      setEEnd(toDateStr(d));
    } else {
      setEEnd("");
    }
    setECat(ev.category);
    setEDesc(ev.description || "");
  };

  const handleSaveEdit = () => {
    const next = events.map((ev) => {
      if (ev.id !== editingId) return ev;
      const updated: CalendarEvent = {
        ...ev,
        title: eTitle,
        start: eStart,
        color: CATEGORY_COLORS[eCat] || "#607d8b",
        category: eCat,
        description: eDesc,
      };
      if (eEnd && eEnd >= eStart) {
        const d = new Date(eEnd + "T00:00:00");
        d.setDate(d.getDate() + 1);
        updated.end = toDateStr(d);
      } else {
        delete updated.end;
      }
      return updated;
    });
    setEvents(next);
    saveEvents(next);
    setEditingId(null);
    showToast("✅ 已儲存");
  };

  const handleDelete = (id: string) => {
    const next = events.filter((ev) => ev.id !== id);
    setEvents(next);
    saveEvents(next);
    setEditingId(null);
    showToast("🗑️ 已刪除");
  };

  // ── Export ──
  const handleExport = () => {
    const blob = new Blob(
      [JSON.stringify(events, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "school_calendar.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Import ──
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target?.result as string);
        if (Array.isArray(imported)) {
          const next = [...events, ...imported];
          setEvents(next);
          saveEvents(next);
          showToast(`✅ 已匯入 ${imported.length} 個活動`);
        } else {
          showToast("格式錯誤，需為 JSON 陣列", true);
        }
      } catch {
        showToast("匯入失敗", true);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Calendar events for FullCalendar
  const calEvents = events.map((ev) => ({
    title: ev.title,
    start: ev.start,
    end: ev.end,
    backgroundColor: ev.color,
    borderColor: ev.color,
    extendedProps: { description: ev.description, id: ev.id },
  }));

  // Selected day events
  const dayEvents = getEventsForDate(selectedDate, events);
  const selDateObj = new Date(selectedDate + "T00:00:00");

  const toggleSection = (key: string) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  if (!loaded) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <p>載入中...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      {toast && (
        <div className={`toast ${toast.error ? "toast-error" : ""}`}>
          {toast.msg}
        </div>
      )}

      {/* ── Sidebar ── */}
      {!sidebarCollapsed && (
      <aside className="sidebar">
        <div className="sidebar-title-row">
          <h2>⚙️ 設定與操作</h2>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={() => setSidebarCollapsed(true)}
            title="收起側邊欄"
            aria-label="收起側邊欄"
          >
            ◀
          </button>
        </div>

        {/* Import */}
        <div className="sidebar-section">
          <div className="sidebar-section-header" onClick={() => toggleSection("import")}>
            1. 匯入現有校曆
            <span>{openSections.import ? "▾" : "▸"}</span>
          </div>
          {openSections.import && (
            <div className="sidebar-section-body">
              <label>上傳 JSON 校曆</label>
              <input type="file" accept=".json" onChange={handleImport} />
            </div>
          )}
        </div>

        {/* Manual add */}
        <div className="sidebar-section">
          <div className="sidebar-section-header" onClick={() => toggleSection("manual")}>
            2. 手動新增活動
            <span>{openSections.manual ? "▾" : "▸"}</span>
          </div>
          {openSections.manual && (
            <div className="sidebar-section-body">
              <div>
                <label>活動名稱 *</label>
                <input
                  type="text"
                  value={mTitle}
                  onChange={(e) => setMTitle(e.target.value)}
                  placeholder="活動名稱"
                />
              </div>
              <div>
                <label>日期</label>
                <input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} />
              </div>
              <div>
                <label>結束日期（可選）</label>
                <input type="date" value={mEnd} onChange={(e) => setMEnd(e.target.value)} />
              </div>
              <div>
                <label>分類</label>
                <select value={mCat} onChange={(e) => setMCat(e.target.value)}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>備注</label>
                <textarea
                  value={mDesc}
                  onChange={(e) => setMDesc(e.target.value)}
                  placeholder="備注（可選）"
                />
              </div>
              <button className="btn btn-primary" onClick={handleManualAdd}>
                直接新增
              </button>
            </div>
          )}
        </div>

        {/* AI add */}
        <div className="sidebar-section">
          <div className="sidebar-section-header" onClick={() => toggleSection("ai")}>
            3. AI 智慧新增
            <span>{openSections.ai ? "▾" : "▸"}</span>
          </div>
          {openSections.ai && (
            <div className="sidebar-section-body">
              <p style={{ fontSize: "0.8rem", color: "#999" }}>
                可一次輸入多個事件／多個日期，AI 會自動分開新增。例如：
                「下週三早上9點六年級家長會；3月20日至22日學校旅行；下星期五全校大掃除」
              </p>
              <textarea
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                placeholder="自然語言輸入（可貼上一整段，包含多個事件與日期）"
                rows={5}
              />
              <button
                className="btn btn-primary"
                onClick={handleAI}
                disabled={aiLoading}
              >
                {aiLoading && <span className="spinner" />}
                {aiLoading ? "Qwen 分析中..." : "送出給 Qwen 分析"}
              </button>
            </div>
          )}
        </div>

        {/* Export */}
        <div className="sidebar-section">
          <div className="sidebar-section-header" onClick={() => toggleSection("export")}>
            📥 匯出校曆
            <span>{openSections.export ? "▾" : "▸"}</span>
          </div>
          {openSections.export && (
            <div className="sidebar-section-body">
              <button className="btn btn-secondary" onClick={handleExport}>
                下載自訂活動 JSON
              </button>
            </div>
          )}
        </div>
      </aside>
      )}

      {sidebarCollapsed && (
        <button
          type="button"
          className="sidebar-expand-btn"
          onClick={() => setSidebarCollapsed(false)}
          title="展開側邊欄"
          aria-label="展開側邊欄"
        >
          ⚙️ ▶
        </button>
      )}

      {/* ── Main content ── */}
      <main className="main-content">
        <div className="page-header">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/logo.png" alt="基慈小學" style={{ width: 48, height: 48 }} />
            <h1>中華基督教會基慈小學 智慧校曆</h1>
          </div>
          <span className="sync-badge">✓ 即時同步中</span>
        </div>

        <p className="hint">💡 點擊日期格即可查看當天所有活動</p>

        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale="zh-tw"
          firstDay={0}
          headerToolbar={{
            left: "today prev,next",
            center: "title",
            right: "dayGridMonth,timeGridWeek,listWeek",
          }}
          buttonText={{ today: "今天", month: "月", week: "週", list: "列表" }}
          height={640}
          events={calEvents}
          selectable
          dateClick={(info) => setSelectedDate(info.dateStr)}
          eventClick={(info) => {
            const start = info.event.startStr;
            setSelectedDate(start.slice(0, 10));
          }}
          eventDisplay="block"
        />

        {/* Day detail panel */}
        <div className="day-panel">
          <h3>📆 {formatDate(selDateObj)}</h3>
          {dayEvents.length === 0 ? (
            <p style={{ color: "#999" }}>當天沒有活動</p>
          ) : (
            dayEvents.map((ev) => (
              <div key={ev.id}>
                <div className="event-card" style={{ borderLeftColor: ev.color }}>
                  <span className="cat-badge" style={{ background: ev.color }}>
                    {ev.category}
                  </span>
                  <span className="ev-title">{ev.title}</span>
                  {ev.start.includes("T") && (
                    <div className="ev-meta">🕐 {ev.start.slice(11, 16)}</div>
                  )}
                  {ev.end && (
                    <div className="ev-meta">→ {ev.end.slice(0, 10)}</div>
                  )}
                  {ev.description && (
                    <div className="ev-desc">📝 {ev.description}</div>
                  )}
                  <div className="event-card-actions">
                    {editingId !== ev.id && (
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => startEdit(ev)}
                      >
                        ✏️ 編輯
                      </button>
                    )}
                  </div>
                </div>

                {editingId === ev.id && (
                  <div className="edit-form">
                    <div>
                      <label>活動名稱</label>
                      <input
                        type="text"
                        value={eTitle}
                        onChange={(e) => setETitle(e.target.value)}
                      />
                    </div>
                    <div className="edit-form-row">
                      <div>
                        <label>開始日期</label>
                        <input
                          type="date"
                          value={eStart}
                          onChange={(e) => setEStart(e.target.value)}
                        />
                      </div>
                      <div>
                        <label>結束日期（可選）</label>
                        <input
                          type="date"
                          value={eEnd}
                          onChange={(e) => setEEnd(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <label>分類</label>
                      <select value={eCat} onChange={(e) => setECat(e.target.value)}>
                        {Object.keys(CATEGORY_COLORS).map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label>備注</label>
                      <textarea
                        value={eDesc}
                        onChange={(e) => setEDesc(e.target.value)}
                      />
                    </div>
                    <div className="edit-form-actions">
                      <button className="btn btn-primary" onClick={handleSaveEdit}>
                        💾 儲存
                      </button>
                      <button
                        className="btn btn-danger"
                        onClick={() => handleDelete(ev.id)}
                      >
                        🗑️ 刪除
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => setEditingId(null)}
                      >
                        ✕ 取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Legend */}
        <div className="legend">
          {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
            <div className="legend-item" key={cat}>
              <span className="legend-dot" style={{ background: color }} />
              {cat}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
