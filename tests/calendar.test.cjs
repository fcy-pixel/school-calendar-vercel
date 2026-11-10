const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const ts = require("typescript");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "school-calendar-tests-"));
for (const name of ["events", "calendar-utils", "qwen"]) {
  fs.writeFileSync(
    path.join(dir, name + ".js"),
    ts.transpileModule(
      fs.readFileSync(path.join(__dirname, "../lib", name + ".ts"), "utf8"),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
        },
      },
    ).outputText,
  );
}
const u = require(path.join(dir, "calendar-utils.js"));
const q = require(path.join(dir, "qwen.js"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("Hong Kong day and weekday agree near UTC midnight", () => {
  assert.equal(u.hongKongDate(new Date("2026-11-10T16:05:00Z")), "2026-11-11");
  const context = q.hongKongTodayContext(new Date("2026-11-10T16:05:00Z"));
  assert.equal(context.isoToday, "2026-11-11");
  assert.match(context.todayStr, /星期三/);
});
test("date validation rejects impossible dates and missing dates", () => {
  assert.equal(u.validDate("2026-02-30"), false);
  assert.equal(u.validDate("2028-02-29"), true);
  assert.equal(u.validDate(""), false);
  assert.equal(u.addDays("2026-12-31", 1), "2027-01-01");
});
test("mixed AI activities are independently classified and never saved by preview conversion", () => {
  const input = {
    events: [
      {
        title: "老師人工智能工作坊",
        date: "2026-11-20",
        event_type: "teacher_training",
      },
      { title: "學校旅行", date: "2026-11-27", event_type: "school" },
      { title: "科組會議", date: "2026-11-18" },
      { title: "學生機械人工作坊", date: "2026-11-21", category: "課外活動" },
    ],
  };
  const before = JSON.stringify(input);
  assert.deepEqual(
    u.previewDrafts(input).map((d) => d.category),
    ["教師進修", "校外活動", "會議", "課外活動"],
  );
  assert.equal(JSON.stringify(input), before);
});
test("incomplete AI dates remain visible but cannot be confirmed", () => {
  const draft = u.previewDrafts({
    events: [{ title: "日期未定的會議", date: "", category: "會議" }],
  })[0];
  assert.equal(draft.date, "");
  assert.equal(u.draftError(draft), "請確認開始日期");
  assert.throws(() => u.eventFromDraft(draft, "1"));
});
test("invalid AI categories fall back per item and not arbitrary object keys", () => {
  assert.equal(
    u.categoryForItem({ category: "__proto__", title: "復活節假期" }),
    "假期",
  );
});
test("inclusive all-day end dates round-trip without off-by-one errors", () => {
  const draft = {
    ...u.emptyDraft("2026-11-09"),
    title: "評估週",
    endDate: "2026-11-20",
    category: "評估",
  };
  const event = u.eventFromDraft(draft, "1");
  assert.equal(event.end, "2026-11-21");
  assert.equal(u.lastEventDate(event), "2026-11-20");
  assert.equal(u.occursOn(event, "2026-11-20"), true);
  assert.equal(u.occursOn(event, "2026-11-21"), false);
  assert.equal(u.draftFromEvent(event).endDate, draft.endDate);
});
test("timed edits preserve start and end times", () => {
  const event = {
    id: "1",
    title: "會議",
    start: "2026-11-13T15:30:00",
    end: "2026-11-13T17:00:00",
    category: "會議",
    color: "#1abc9c",
    description: "",
  };
  const draft = u.draftFromEvent(event);
  assert.equal(draft.time, "15:30");
  assert.equal(draft.endTime, "17:00");
  assert.deepEqual(u.eventFromDraft(draft, event.id), event);
  assert.equal(u.occursOn(event, "2026-11-13"), true);
});
test("midnight ends and backwards times are handled safely", () => {
  const event = {
    id: "1",
    title: "活動",
    start: "2026-11-12T19:00:00",
    end: "2026-11-13T00:00:00",
    category: "活動",
    color: "",
  };
  assert.equal(u.lastEventDate(event), "2026-11-12");
  assert.equal(u.occursOn(event, "2026-11-13"), false);
  assert.equal(
    u.draftError({
      ...u.emptyDraft("2026-11-13"),
      title: "會議",
      time: "17:00",
      endTime: "15:00",
    }),
    "結束時間需晚於開始時間",
  );
});
test("long reminders are grouped without dropping ordinary multi-day activities", () => {
  const base = {
    id: "1",
    title: "評估週",
    start: "2026-11-09",
    end: "2026-11-21",
    category: "評估",
    color: "",
  };
  assert.equal(u.isPeriodReminder(base), false);
  assert.equal(
    u.isPeriodReminder({ ...base, title: "【周內辦妥】交回文件" }),
    true,
  );
  assert.equal(u.isPeriodReminder({ ...base, end: "2027-01-01" }), true);
});
test("merge keeps existing and concurrently added activities and deduplicates new confirmations", () => {
  const one = u.eventFromDraft(
    { ...u.emptyDraft("2026-11-13"), title: "會議" },
    "one",
  );
  const two = u.eventFromDraft(
    { ...u.emptyDraft("2026-11-14"), title: "旅行" },
    "two",
  );
  const original = [one];
  const merged = u.mergeNewEvents(original, [
    { ...one, id: "duplicate" },
    two,
    { ...two, id: "retry" },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(original.length, 1);
  assert.equal(merged[0].id, "one");
});
test("AI parser retains incomplete items for preview and excludes them for email ingestion", async () => {
  const old = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                events: [
                  { title: "科組會議", date: "2026-11-18", category: "會議" },
                  { title: "待定活動", date: "", category: "活動" },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  try {
    assert.equal(
      (await q.parseEventsWithQwen("test", "test-key", true)).length,
      2,
    );
    assert.equal((await q.parseEventsWithQwen("test", "test-key")).length, 1);
  } finally {
    global.fetch = old;
  }
});

test("single-day duplicates match with or without an explicit exclusive end", () => {
  const event = u.eventFromDraft(
    { ...u.emptyDraft("2026-11-13"), title: "校務會議" },
    "one",
  );
  assert.equal(
    u.eventKey(event),
    u.eventKey({ ...event, id: "two", end: "2026-11-14" }),
  );
});
