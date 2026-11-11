"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import zhTwLocale from "@fullcalendar/core/locales/zh-tw";
import { doc, onSnapshot, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { CalendarEvent, CATEGORY_COLORS, CATEGORIES } from "@/lib/events";
import {
  addDays,
  dateLabel,
  draftError,
  draftFromEvent,
  emptyDraft,
  eventFromDraft,
  eventKey,
  hongKongDate,
  isPeriodReminder,
  lastEventDate,
  mergeNewEvents,
  occursOn,
  previewDrafts,
  validDate,
  type EventDraft,
} from "@/lib/calendar-utils";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const refForEvents = () => doc(db, "school_calendar", "events");
const CATEGORY_TONES: Record<string, string> = {
  假期: "#b43b50",
  評估: "#9d580d",
  校外活動: "#2166a0",
  活動: "#24745e",
  交流: "#7651a2",
  會議: "#1d7079",
  校務: "#56677a",
  課外活動: "#956114",
  教師進修: "#7252a5",
  新增: "#7651a2",
  學校事件: "#7651a2",
  學生事件: "#7651a2",
  郵件匯入: "#ae3d67",
};
const tone = (category: string) =>
  ({ "--event-tone": CATEGORY_TONES[category] || "#526881" }) as CSSProperties;

type DialogMode = "manual" | "ai" | "manage" | "edit" | null;

function Dialog({
  title,
  onClose,
  busy,
  children,
}: {
  title: string;
  onClose: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="editor-dialog"
      aria-labelledby="editor-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="dialog-header">
        <h2 id="editor-title">{title}</h2>
        <button
          className="icon-button"
          type="button"
          aria-label="關閉"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}

function DraftFields({
  value,
  onChange,
  prefix,
  disabled = false,
}: {
  value: EventDraft;
  onChange: (draft: EventDraft) => void;
  prefix: string;
  disabled?: boolean;
}) {
  const set = (field: keyof EventDraft, text: string) =>
    onChange({ ...value, [field]: text });
  const categories = CATEGORIES.includes(value.category)
    ? CATEGORIES
    : [...CATEGORIES, value.category];
  return (
    <fieldset className="draft-fields" disabled={disabled}>
      <label htmlFor={prefix + "-title"}>
        活動名稱 <span className="required">*</span>
        <input
          id={prefix + "-title"}
          value={value.title}
          maxLength={200}
          onChange={(e) => set("title", e.target.value)}
          placeholder="例如：科組會議"
          required
        />
      </label>
      <div className="form-columns">
        <label htmlFor={prefix + "-date"}>
          開始日期 <span className="required">*</span>
          <input
            id={prefix + "-date"}
            type="date"
            value={value.date}
            onChange={(e) => set("date", e.target.value)}
            onInput={(e) => set("date", e.currentTarget.value)}
            required
          />
        </label>
        <label htmlFor={prefix + "-end"}>
          結束日期（可選）
          <input
            id={prefix + "-end"}
            type="date"
            min={value.date}
            value={value.endDate}
            onChange={(e) => set("endDate", e.target.value)}
            onInput={(e) => set("endDate", e.currentTarget.value)}
          />
        </label>
      </div>
      <div className="form-columns">
        <label htmlFor={prefix + "-time"}>
          開始時間（可選）
          <input
            id={prefix + "-time"}
            type="time"
            value={value.time}
            onChange={(e) => set("time", e.target.value)}
            onInput={(e) => set("time", e.currentTarget.value)}
          />
        </label>
        <label htmlFor={prefix + "-end-time"}>
          結束時間（可選）
          <input
            id={prefix + "-end-time"}
            type="time"
            value={value.endTime}
            onChange={(e) => set("endTime", e.target.value)}
            onInput={(e) => set("endTime", e.currentTarget.value)}
          />
        </label>
      </div>
      <label htmlFor={prefix + "-category"}>
        分類 <span className="required">*</span>
        <select
          id={prefix + "-category"}
          value={value.category}
          onChange={(e) => set("category", e.target.value)}
        >
          {categories.map((cat) => (
            <option key={cat}>{cat}</option>
          ))}
        </select>
      </label>
      <label htmlFor={prefix + "-description"}>
        備註
        <textarea
          id={prefix + "-description"}
          rows={3}
          value={value.description}
          maxLength={4000}
          onChange={(e) => set("description", e.target.value)}
          placeholder="地點、參與對象或注意事項"
        />
      </label>
    </fieldset>
  );
}

function sampleEvents(today: string): CalendarEvent[] {
  return [
    {
      ...emptyDraft(today),
      title: "科組會議",
      time: "15:30",
      category: "會議",
      description: "本機測試活動，不會寫入正式校曆。",
    },
    {
      ...emptyDraft(today),
      title: "二年級主題式學習教師問卷提交截止",
      category: "校務",
    },
    {
      ...emptyDraft(addDays(today, 1)),
      title: "教師人工智能教學工作坊",
      category: "教師進修",
      time: "14:00",
    },
    {
      ...emptyDraft(addDays(today, 2)),
      title: "小四成長的天空挑戰日營",
      category: "校外活動",
    },
    {
      ...emptyDraft(today),
      title: "【周內辦妥】籌備幼稚園敬師活動",
      endDate: addDays(today, 4),
      category: "校務",
    },
  ].map((draft, i) => eventFromDraft(draft, "local-" + i));
}

export default function CalendarApp({ demo = false }: { demo?: boolean }) {
  const [today, setToday] = useState(hongKongDate);
  const [selectedDate, setSelectedDate] = useState(hongKongDate);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [online, setOnline] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [toast, setToast] = useState("");
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [formError, setFormError] = useState("");
  const [manual, setManual] = useState(() => emptyDraft(hongKongDate()));
  const [editing, setEditing] = useState<EventDraft | null>(null);
  const [aiText, setAiText] = useState("");
  const [aiSource, setAiSource] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [drafts, setDrafts] = useState<EventDraft[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("全部");
  const [mobile, setMobile] = useState(false);
  const [mobileView, setMobileView] = useState<"agenda" | "month">("agenda");
  const [view, setView] = useState("dayGridMonth");
  const [monthTitle, setMonthTitle] = useState("");
  const [displayMode, setDisplayMode] = useState(false);
  const calRef = useRef<FullCalendar>(null);
  const eventRef = useRef(events);
  eventRef.current = events;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    const network = () => setOnline(navigator.onLine);
    network();
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
    };
  }, []);

  useEffect(() => {
    if (demo) {
      setEvents(sampleEvents(hongKongDate()));
      setLoaded(true);
      return;
    }
    setLoadError("");
    return onSnapshot(
      refForEvents(),
      { includeMetadataChanges: true },
      (snapshot) => {
        setEvents(
          Array.isArray(snapshot.data()?.events) ? snapshot.data()!.events : [],
        );
        setLoaded(true);
        setLoadError("");
      },
      () => {
        setLoadError("未能讀取校曆，請檢查網絡後重試。");
        setLoaded(true);
      },
    );
  }, [demo, reloadKey]);

  useEffect(() => {
    let current = hongKongDate();
    const tick = () => {
      const next = hongKongDate();
      if (next !== current) {
        current = next;
        setToday(next);
        setSelectedDate(next);
        calRef.current?.getApi().gotoDate(next);
      }
    };
    const timer = setInterval(tick, 30000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    document.body.classList.toggle("display-mode", displayMode);
    return () => document.body.classList.remove("display-mode");
  }, [displayMode]);

  const mutate = useCallback(
    async (change: (current: CalendarEvent[]) => CalendarEvent[]) => {
      if (saveLock.current) throw new Error("正在儲存，請稍候");
      if (loadError || !loaded) throw new Error("請先成功載入校曆後再儲存");
      if (!demo && !navigator.onLine)
        throw new Error("目前離線，內容已保留，連線後再儲存");
      saveLock.current = true;
      setSaving(true);
      setFormError("");
      try {
        if (demo) {
          const next = change(eventRef.current);
          const added = next.length - eventRef.current.length;
          setEvents(next);
          return added;
        }
        const result = await runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(refForEvents());
          const current: CalendarEvent[] = Array.isArray(
            snapshot.data()?.events,
          )
            ? snapshot.data()!.events
            : [];
          const next = change(current);
          transaction.set(refForEvents(), { events: next }, { merge: true });
          return { next, added: next.length - current.length };
        });
        setEvents(result.next);
        return result.added;
      } catch (error) {
        throw new Error(
          error instanceof Error && !("code" in error)
            ? error.message
            : "未能儲存，內容已保留，請稍後重試",
        );
      } finally {
        saveLock.current = false;
        setSaving(false);
      }
    },
    [demo, loadError, loaded],
  );

  const filtered = useMemo(
    () =>
      events.filter(
        (event) =>
          (category === "全部" || event.category === category) &&
          (!search.trim() ||
            (event.title + " " + (event.description || ""))
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase())),
      ),
    [events, search, category],
  );
  const periodEvents = filtered.filter(
    (event) => isPeriodReminder(event) && occursOn(event, selectedDate),
  );
  const dayEvents = filtered
    .filter(
      (event) => !isPeriodReminder(event) && occursOn(event, selectedDate),
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  const categories = Array.from(
    new Set([...CATEGORIES, ...events.map((event) => event.category)]),
  );
  const weekStart = addDays(
    selectedDate,
    -((new Date(selectedDate + "T12:00:00Z").getUTCDay() + 6) % 7),
  );
  const selectedDrafts = drafts.filter((draft) => draft.included);
  const previewError = selectedDrafts.map(draftError).find(Boolean);
  const existingKeys = new Set(events.map(eventKey));
  const isDuplicate = (draft: EventDraft) =>
    !draftError(draft) &&
    existingKeys.has(eventKey(eventFromDraft(draft, "preview")));

  function goDate(date: string) {
    setSelectedDate(date);
    calRef.current?.getApi().gotoDate(date);
  }
  function open(mode: DialogMode) {
    setFormError("");
    if (mode === "manual" && !manual.title) setManual(emptyDraft(selectedDate));
    setDialog(mode);
  }
  function close() {
    if (!saving && !aiLoading) {
      setDialog(null);
      setFormError("");
    }
  }
  function changeView(next: string) {
    setView(next);
    calRef.current?.getApi().changeView(next, selectedDate);
  }
  function navigate(direction: number) {
    if (mobile && mobileView === "agenda")
      goDate(addDays(selectedDate, direction * 7));
    else {
      const api = calRef.current?.getApi();
      direction < 0 ? api?.prev() : api?.next();
    }
  }
  async function saveManual() {
    const value = dialog === "edit" && editing ? editing : manual;
    const error = draftError(value);
    if (error) {
      setFormError(error);
      return;
    }
    try {
      const event = eventFromDraft(
        value,
        dialog === "edit" ? value.id : crypto.randomUUID(),
      );
      if (dialog === "edit") {
        await mutate((current) => {
          if (!current.some((item) => item.id === event.id))
            throw new Error("此活動已被移除，請重新載入");
          return current
            .map((item) =>
              item.id === event.id
                ? {
                    ...item,
                    ...event,
                    ...(event.end ? {} : { end: undefined }),
                  }
                : item,
            )
            .map((item) => {
              const clean = { ...item };
              if (!clean.end) delete clean.end;
              return clean;
            });
        });
        setToast("活動已更新");
      } else {
        const added = await mutate((current) =>
          mergeNewEvents(current, [event]),
        );
        setToast(added ? "活動已加入校曆" : "校曆已有相同活動，沒有重複新增");
        setManual(emptyDraft(selectedDate));
      }
      goDate(value.date);
      setDialog(null);
      setEditing(null);
    } catch (error) {
      setFormError((error as Error).message);
    }
  }
  async function analyze() {
    if (!aiText.trim()) {
      setFormError("請先貼上活動內容");
      return;
    }
    setAiLoading(true);
    setFormError("");
    try {
      const response = await fetch("/api/qwen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: aiText.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "分析未完成，請重試");
      const next = previewDrafts(result);
      if (!next.length) throw new Error("未找到活動，請補充活動名稱及日期再試");
      setDrafts(
        next.map((draft) => ({ ...draft, included: !isDuplicate(draft) })),
      );
      setAiSource(aiText.trim());
    } catch (error) {
      setFormError((error as Error).message || "分析未完成，請稍後重試");
    } finally {
      setAiLoading(false);
    }
  }
  async function confirmAI() {
    if (!selectedDrafts.length || previewError || aiSource !== aiText.trim())
      return;
    try {
      const incoming = selectedDrafts.map((draft) =>
        eventFromDraft(draft, crypto.randomUUID()),
      );
      const added = await mutate((current) =>
        mergeNewEvents(current, incoming),
      );
      goDate(selectedDrafts[0].date);
      setDrafts([]);
      setAiText("");
      setAiSource("");
      setDialog(null);
      setToast(
        "已加入 " +
          added +
          " 項活動" +
          (added < incoming.length ? "，相同活動已略過" : ""),
      );
    } catch (error) {
      setFormError((error as Error).message);
    }
  }
  async function deleteEvent() {
    if (!editing || !window.confirm("確定刪除「" + editing.title + "」？"))
      return;
    try {
      await mutate((current) =>
        current.filter((event) => event.id !== editing.id),
      );
      setDialog(null);
      setEditing(null);
      setToast("活動已刪除");
    } catch (error) {
      setFormError((error as Error).message);
    }
  }
  function exportEvents() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(events, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "基慈校曆_" + today + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importEvents(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000)
        throw new Error("檔案過大，請選擇小於 2 MB 的校曆檔");
      const data: unknown = JSON.parse(await file.text());
      if (!Array.isArray(data) || !data.length || data.length > 1500)
        throw new Error("請上傳有效的 JSON 校曆陣列（最多 1,500 項）");
      const incoming: CalendarEvent[] = data.map((item) => {
        if (
          !item ||
          typeof item.title !== "string" ||
          !item.title.trim() ||
          typeof item.start !== "string" ||
          !validDate(item.start.slice(0, 10)) ||
          (item.end &&
            (typeof item.end !== "string" || !validDate(item.end.slice(0, 10))))
        )
          throw new Error("檔案含有缺少名稱或日期無效的活動，請檢查後再匯入");
        const category =
          typeof item.category === "string" &&
          Object.hasOwn(CATEGORY_COLORS, item.category)
            ? item.category
            : "活動";
        return {
          id: crypto.randomUUID(),
          title: item.title,
          start: item.start,
          ...(item.end ? { end: item.end } : {}),
          category,
          color: CATEGORY_COLORS[category],
          description:
            typeof item.description === "string" ? item.description : "",
        };
      });
      const added = await mutate((current) =>
        mergeNewEvents(current, incoming),
      );
      setToast("已匯入 " + added + " 項活動，相同活動會自動略過");
      setDialog(null);
    } catch (error) {
      setFormError(
        error instanceof SyntaxError
          ? "檔案不是有效的 JSON 格式"
          : (error as Error).message,
      );
    }
  }
  function eventCard(event: CalendarEvent) {
    const last = lastEventDate(event);
    return (
      <article
        className="event-card"
        style={tone(event.category)}
        key={event.id}
      >
        <div className="event-topline">
          <span className="category-tag">{event.category}</span>
          <span className="event-time">
            {event.start.includes("T") ? event.start.slice(11, 16) : "全日"}
          </span>
        </div>
        <h3>{event.title}</h3>
        {last !== event.start.slice(0, 10) && (
          <p className="event-meta">
            {dateLabel(event.start.slice(0, 10))} 至 {dateLabel(last)}
          </p>
        )}
        {event.end?.includes("T") && (
          <p className="event-meta">結束時間 {event.end.slice(11, 16)}</p>
        )}
        {event.description?.trim() && (
          <div className="event-description">
            <span className="event-description-label">備註</span>
            <p>{event.description}</p>
          </div>
        )}
        {!displayMode && (
          <button
            className="text-button"
            onClick={() => {
              setEditing(draftFromEvent(event));
              open("edit");
            }}
          >
            編輯活動<span aria-hidden="true"> ↗</span>
          </button>
        )}
      </article>
    );
  }

  return (
    <div className={"calendar-app" + (displayMode ? " is-display" : "")}>
      {demo && (
        <div className="local-preview">本機測試環境 · 活動只儲存在此頁</div>
      )}
      <header className="app-header">
        <a className="school-brand" href="/" aria-label="基慈小學智慧校曆首頁">
          <img
            src="/logo.png"
            alt="中華基督教會基慈小學校徽"
            width="48"
            height="56"
          />
          <div>
            <h1>智慧校曆</h1>
            <p>中華基督教會基慈小學</p>
          </div>
        </a>
        <div className="header-actions">
          <span
            className={
              "sync-state" + (loadError || !online ? " is-offline" : "")
            }
          >
            <i />
            {!online
              ? "目前離線"
              : loadError
                ? "連線待恢復"
                : !loaded
                  ? "載入中"
                  : saving
                    ? "儲存中"
                    : "即時同步"}
          </span>
          {!displayMode && (
            <>
              <button
                className="button quiet management-button"
                aria-label="管理校曆"
                onClick={() => open("manage")}
              >
                {mobile ? "管理" : "管理校曆"}
              </button>
              <button
                className="button primary add-button"
                onClick={() => open("manual")}
              >
                <span className="plus" aria-hidden="true">
                  ＋
                </span>
                新增活動
              </button>
            </>
          )}
          {displayMode && (
            <button className="button" onClick={() => setDisplayMode(false)}>
              結束展示
            </button>
          )}
        </div>
      </header>
      <main className="app-main">
        {loadError && (
          <div className="error-banner" role="alert">
            {loadError}
            <button
              className="button"
              onClick={() => setReloadKey((n) => n + 1)}
            >
              重新連線
            </button>
          </div>
        )}
        {!loaded ? (
          <div className="loading-state">
            <span className="spinner" />
            正在載入校曆…
          </div>
        ) : (
          <>
            {!displayMode && (
              <div className="filter-toolbar">
                <label className="search-field">
                  <span aria-hidden="true">⌕</span>
                  <input
                    aria-label="搜尋活動或備註"
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜尋活動或備註"
                  />
                </label>
                <label className="category-select">
                  <span>分類</span>
                  <select
                    aria-label="篩選分類"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option>全部</option>
                    {categories.map((cat) => (
                      <option key={cat}>{cat}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="button quiet display-button"
                  onClick={() => setDisplayMode(true)}
                >
                  大字展示
                </button>
              </div>
            )}
            <div className="workspace">
              <section
                className={
                  "calendar-section" +
                  (mobile && mobileView === "agenda" ? " agenda-mode" : "")
                }
                aria-label="校曆總覽"
              >
                <div className="calendar-toolbar">
                  <div className="month-navigation">
                    <button
                      className="icon-button"
                      aria-label={
                        mobile && mobileView === "agenda" ? "上一週" : "上一期"
                      }
                      onClick={() => navigate(-1)}
                    >
                      ‹
                    </button>
                    <h2>
                      {mobile && mobileView === "agenda"
                        ? dateLabel(weekStart) + "的一週"
                        : monthTitle || today.slice(0, 7)}
                    </h2>
                    <button
                      className="icon-button"
                      aria-label={
                        mobile && mobileView === "agenda" ? "下一週" : "下一期"
                      }
                      onClick={() => navigate(1)}
                    >
                      ›
                    </button>
                  </div>
                  <button
                    className="button today-button"
                    onClick={() => goDate(today)}
                  >
                    今日
                  </button>
                </div>
                <div className="view-toolbar">
                  <div className="view-switch" aria-label="校曆顯示方式">
                    {mobile ? (
                      <>
                        <button
                          aria-pressed={mobileView === "agenda"}
                          onClick={() => setMobileView("agenda")}
                        >
                          每日安排
                        </button>
                        <button
                          aria-pressed={mobileView === "month"}
                          onClick={() => {
                            setMobileView("month");
                            setView("dayGridMonth");
                          }}
                        >
                          月曆
                        </button>
                      </>
                    ) : (
                      [
                        ["dayGridMonth", "月曆"],
                        ["timeGridWeek", "週曆"],
                        ["listWeek", "列表"],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          aria-pressed={view === id}
                          onClick={() => changeView(id)}
                        >
                          {label}
                        </button>
                      ))
                    )}
                  </div>
                  <span className="view-hint">點日期查看安排</span>
                </div>
                {mobile && mobileView === "agenda" ? (
                  <div className="week-strip">
                    {Array.from({ length: 7 }, (_, i) =>
                      addDays(weekStart, i),
                    ).map((date) => (
                      <button
                        key={date}
                        className={
                          "week-day" + (date === today ? " is-today" : "")
                        }
                        aria-pressed={date === selectedDate}
                        aria-label={dateLabel(date, true)}
                        onClick={() => goDate(date)}
                      >
                        <span>
                          週
                          {WEEKDAYS[new Date(date + "T12:00:00Z").getUTCDay()]}
                        </span>
                        <strong>{Number(date.slice(8))}</strong>
                        <i
                          className={
                            filtered.some(
                              (event) =>
                                !isPeriodReminder(event) &&
                                occursOn(event, date),
                            )
                              ? "has-events"
                              : ""
                          }
                        />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="calendar-surface">
                    <FullCalendar
                      key={mobile ? "mobile-month" : "desktop"}
                      ref={calRef}
                      plugins={[
                        dayGridPlugin,
                        timeGridPlugin,
                        listPlugin,
                        interactionPlugin,
                      ]}
                      locale={zhTwLocale}
                      initialView={mobile ? "dayGridMonth" : view}
                      initialDate={selectedDate}
                      now={today + "T12:00:00"}
                      timeZone="local"
                      firstDay={0}
                      headerToolbar={false}
                      height="auto"
                      fixedWeekCount={false}
                      dayMaxEvents={mobile ? 1 : 3}
                      views={{ timeGridWeek: { dayMaxEventRows: 3 } }}
                      eventDisplay="block"
                      eventOrder="start,title"
                      displayEventEnd
                      events={filtered
                        .filter((event) => !isPeriodReminder(event))
                        .map((event) => ({
                          id: event.id,
                          title: event.title,
                          start: event.start,
                          end: event.end,
                          classNames: ["calendar-event"],
                          backgroundColor:
                            (CATEGORY_TONES[event.category] || "#526881") +
                            "18",
                          borderColor: "transparent",
                          textColor:
                            CATEGORY_TONES[event.category] || "#526881",
                        }))}
                      datesSet={(info) => setMonthTitle(info.view.title)}
                      dayCellClassNames={(info) =>
                        hongKongDate(info.date) === selectedDate
                          ? ["selected-day"]
                          : []
                      }
                      dateClick={(info) => {
                        setSelectedDate(info.dateStr.slice(0, 10));
                        if (mobile) setMobileView("agenda");
                      }}
                      eventClick={(info) => {
                        const date = info.el
                          .closest("[data-date]")
                          ?.getAttribute("data-date");
                        setSelectedDate(
                          date && validDate(date)
                            ? date
                            : info.event.startStr.slice(0, 10),
                        );
                        if (mobile) setMobileView("agenda");
                      }}
                      moreLinkClick={(info) => {
                        setSelectedDate(hongKongDate(info.date));
                        if (mobile) setMobileView("agenda");
                        return "popover";
                      }}
                      buttonText={{
                        today: "今日",
                        month: "月曆",
                        week: "週曆",
                        list: "列表",
                      }}
                      noEventsContent="這段期間沒有符合條件的活動"
                      allDayText="全日"
                      moreLinkText={(num) => "另有 " + num + " 項"}
                      eventTimeFormat={{
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      }}
                      slotLabelFormat={{
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      }}
                      slotMinTime="07:00:00"
                      slotMaxTime="20:00:00"
                    />
                  </div>
                )}
                <div className="calendar-caption">
                  <span>
                    <i className="today-dot" />
                    今日
                  </span>
                  <span>
                    <i className="selected-dot" />
                    所選日期
                  </span>
                  {(category !== "全部" || search) && (
                    <button
                      className="text-button"
                      onClick={() => {
                        setCategory("全部");
                        setSearch("");
                      }}
                    >
                      清除篩選
                    </button>
                  )}
                </div>
              </section>
              <aside className="day-agenda" aria-label="當日安排">
                <header className="agenda-header">
                  <div>
                    <p>{selectedDate === today ? "今日安排" : "當日安排"}</p>
                    <h2>{dateLabel(selectedDate)}</h2>
                  </div>
                  <span>
                    {
                      WEEKDAYS[
                        new Date(selectedDate + "T12:00:00Z").getUTCDay()
                      ]
                    }
                    <small>星期</small>
                  </span>
                </header>
                <div className="agenda-count">
                  {dayEvents.length} 項活動
                  {periodEvents.length
                    ? " · " + periodEvents.length + " 項持續提醒"
                    : ""}
                </div>
                <div
                  className="agenda-items"
                  key={selectedDate}
                  aria-live="polite"
                >
                  {dayEvents.length ? (
                    dayEvents.map(eventCard)
                  ) : (
                    <div className="empty-state">
                      <span aria-hidden="true">☀</span>
                      <h3>
                        {search || category !== "全部"
                          ? "沒有符合篩選的活動"
                          : "這天暫時沒有活動"}
                      </h3>
                      <p>
                        {periodEvents.length
                          ? "本週及持續提醒已列於下方。"
                          : "點選其他日期，或新增一項安排。"}
                      </p>
                    </div>
                  )}
                </div>
              </aside>
              {periodEvents.length > 0 && (
                <section
                  className="period-reminders"
                  aria-labelledby="period-reminders-title"
                >
                  <header className="period-header">
                    <h2 id="period-reminders-title">本週及持續提醒</h2>
                    <span>{periodEvents.length} 項</span>
                  </header>
                  <div className="period-list">
                    {periodEvents.map(eventCard)}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          ✓ {toast}
          <button aria-label="關閉提示" onClick={() => setToast("")}>
            ×
          </button>
        </div>
      )}
      {dialog && (
        <Dialog
          title={
            dialog === "edit"
              ? "編輯活動"
              : dialog === "manage"
                ? "管理校曆"
                : "新增活動"
          }
          busy={saving || aiLoading}
          onClose={close}
        >
          {(dialog === "manual" || dialog === "ai") && (
            <div className="editor-tabs" aria-label="新增方式">
              <button
                aria-pressed={dialog === "manual"}
                disabled={aiLoading || saving}
                onClick={() => open("manual")}
              >
                手動新增
              </button>
              <button
                aria-pressed={dialog === "ai"}
                disabled={aiLoading || saving}
                onClick={() => open("ai")}
              >
                <span aria-hidden="true">✦ </span>AI 智慧新增
              </button>
            </div>
          )}
          <div className="dialog-body">
            {(dialog === "manual" || dialog === "edit") && (
              <form
                id="manual-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveManual();
                }}
              >
                <DraftFields
                  value={dialog === "edit" && editing ? editing : manual}
                  onChange={dialog === "edit" ? setEditing : setManual}
                  prefix="activity"
                  disabled={saving}
                />
              </form>
            )}
            {dialog === "ai" && (
              <div className="ai-workspace">
                <p className="helper">
                  貼上通知或活動文字，AI
                  會逐項整理日期及分類。確認預覽後先會加入校曆。
                </p>
                <label htmlFor="ai-text">
                  活動內容
                  <textarea
                    id="ai-text"
                    value={aiText}
                    onChange={(e) => setAiText(e.target.value)}
                    disabled={aiLoading || saving}
                    maxLength={6000}
                    rows={5}
                    placeholder="例如：11月18日下午3時科組會議；11月20日老師參加AI工作坊；11月27日學校旅行。"
                  />
                </label>
                <div className="ai-actions">
                  <span>{aiText.length.toLocaleString()} / 6,000 字</span>
                  <button
                    className="button primary"
                    disabled={aiLoading || saving || !aiText.trim()}
                    onClick={() => void analyze()}
                  >
                    {aiLoading ? (
                      <>
                        <span className="spinner" />
                        正在分析…
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true">✦</span>
                        {drafts.length ? "重新分析" : "分析並預覽"}
                      </>
                    )}
                  </button>
                </div>
                {drafts.length > 0 && (
                  <section className="ai-preview" aria-label="AI 活動預覽">
                    <div className="preview-heading">
                      <h3>核對活動預覽</h3>
                      <span>
                        已選 {selectedDrafts.length} / {drafts.length} 項
                      </span>
                    </div>
                    <p className="helper">
                      可修改名稱、日期、時間及分類；取消勾選即可略過該項。
                    </p>
                    {drafts.map((draft, index) => (
                      <article
                        className={
                          "preview-item" +
                          (!draft.included ? " is-excluded" : "")
                        }
                        key={draft.id}
                      >
                        <div className="preview-item-header">
                          <label className="include-check">
                            <input
                              type="checkbox"
                              checked={draft.included}
                              disabled={saving}
                              onChange={(e) =>
                                setDrafts((items) =>
                                  items.map((item, i) =>
                                    i === index
                                      ? { ...item, included: e.target.checked }
                                      : item,
                                  ),
                                )
                              }
                            />
                            <span>加入第 {index + 1} 項</span>
                          </label>
                          <span
                            className="category-tag"
                            style={tone(draft.category)}
                          >
                            {draft.category}
                          </span>
                        </div>
                        <DraftFields
                          value={draft}
                          onChange={(value) =>
                            setDrafts((items) =>
                              items.map((item, i) =>
                                i === index ? value : item,
                              ),
                            )
                          }
                          prefix={"preview-" + index}
                          disabled={saving || !draft.included}
                        />
                        {draft.included && draftError(draft) && (
                          <p className="field-warning">{draftError(draft)}</p>
                        )}
                        {isDuplicate(draft) && (
                          <p className="field-warning">
                            校曆已有相同活動，儲存時會略過。
                          </p>
                        )}
                      </article>
                    ))}
                    {aiSource !== aiText.trim() && (
                      <p className="field-warning">
                        活動文字已修改，請重新分析後再確認。
                      </p>
                    )}
                  </section>
                )}
              </div>
            )}
            {dialog === "manage" && (
              <div className="management-options">
                <section>
                  <h3>匯出校曆</h3>
                  <p>下載完整校曆，方便備份及日後匯入。</p>
                  <button
                    className="button"
                    disabled={!loaded || !!loadError}
                    onClick={exportEvents}
                  >
                    下載校曆 JSON
                  </button>
                </section>
                <section>
                  <h3>匯入現有校曆</h3>
                  <p>加入檔案內的活動，保留現有校曆，相同活動會略過。</p>
                  <label className="file-label" htmlFor="calendar-import">
                    選擇 JSON 檔案
                    <input
                      id="calendar-import"
                      type="file"
                      accept=".json,application/json"
                      disabled={saving}
                      onChange={(e) => {
                        void importEvents(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </section>
                <section>
                  <h3>電視及廣告機</h3>
                  <p>放大活動文字，收起管理工具。</p>
                  <button
                    className="button"
                    onClick={() => {
                      setDisplayMode(true);
                      setDialog(null);
                    }}
                  >
                    開啟大字展示
                  </button>
                </section>
              </div>
            )}
            {formError && (
              <div className="form-error" role="alert">
                {formError}
              </div>
            )}
          </div>
          <footer className="dialog-footer">
            <button
              className="button"
              disabled={saving || aiLoading}
              onClick={close}
            >
              關閉
            </button>
            {dialog === "edit" && (
              <button
                className="button danger"
                disabled={saving}
                onClick={() => void deleteEvent()}
              >
                刪除活動
              </button>
            )}
            {(dialog === "manual" || dialog === "edit") && (
              <button
                className="button primary"
                form="manual-form"
                type="submit"
                disabled={saving || !!loadError}
              >
                {saving
                  ? "儲存中…"
                  : dialog === "edit"
                    ? "儲存修改"
                    : "加入校曆"}
              </button>
            )}
            {dialog === "ai" && drafts.length > 0 && (
              <button
                className="button primary"
                disabled={
                  saving ||
                  aiLoading ||
                  !selectedDrafts.length ||
                  !!previewError ||
                  aiSource !== aiText.trim() ||
                  !!loadError
                }
                onClick={() => void confirmAI()}
              >
                {saving
                  ? "儲存中…"
                  : "確認加入 " + selectedDrafts.length + " 項"}
              </button>
            )}
          </footer>
        </Dialog>
      )}
    </div>
  );
}
