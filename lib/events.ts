export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  color: string;
  category: string;
  description?: string;
}

export const CATEGORY_COLORS: Record<string, string> = {
  "假期":    "#e74c3c",
  "評估":    "#e67e22",
  "校外活動": "#3498db",
  "活動":    "#2ecc71",
  "交流":    "#9b59b6",
  "會議":    "#1abc9c",
  "校務":    "#7f8c8d",
  "課外活動": "#f39c12",
  "新增":  "#8e44ad",
  "學校事件": "#9b59b6",
  "老師進修": "#f1c40f",
};

export const CATEGORIES = Object.keys(CATEGORY_COLORS).filter(c => c !== "新增" && c !== "學校事件" && c !== "老師進修");

export const PRELOADED_EVENTS: CalendarEvent[] = [
  { id: "p01", title: "元宵節", start: "2026-03-03", color: "#e74c3c", category: "假期" },
  { id: "p02", title: "3-6年級填寫KPM持份者學生問卷", start: "2026-03-04", end: "2026-03-06", color: "#e67e22", category: "校務" },
  { id: "p03", title: "派發温習材料", start: "2026-03-06", color: "#7f8c8d", category: "校務" },
  { id: "p04", title: "星期六課外活動開始", start: "2026-03-07", color: "#f39c12", category: "課外活動" },
  { id: "p05", title: "區本活動開始", start: "2026-03-07", color: "#2ecc71", category: "活動" },
  { id: "p06", title: "法團校董會會議 (6:30pm)", start: "2026-03-14", color: "#1abc9c", category: "會議" },
  { id: "p07", title: "二至六年級評估二 / 一年級主題式學習", start: "2026-03-16", end: "2026-03-21", color: "#e67e22", category: "評估" },
  { id: "p08", title: "「新時代築夢計劃（人工智能）」校內問卷評估（前測）", start: "2026-03-18T12:00:00", color: "#9b59b6", category: "活動" },
  { id: "p09", title: "一、四年級校外科學探索活動 / 賽馬會大熊貓之旅", start: "2026-03-18", color: "#3498db", category: "校外活動" },
  { id: "p10", title: "Tales of Character: 一、二年級英文語常會活動", start: "2026-03-25", color: "#2ecc71", category: "活動", description: "1:25-2:55 p.m." },
  { id: "p11", title: "境外交流（冲繩）四天", start: "2026-03-26", end: "2026-03-30", color: "#9b59b6", category: "交流" },
  { id: "p12", title: "故事爸媽活動", start: "2026-03-26", color: "#2ecc71", category: "活動" },
  { id: "p13", title: "五年級英語活動", start: "2026-03-26", color: "#3498db", category: "活動", description: "1:25-2:55 p.m., i/c玲" },
  { id: "p14", title: "Tales of Character: 五年級英文語常會活動", start: "2026-03-26", color: "#2ecc71", category: "活動" },
  { id: "p15", title: "Tales of Character: 三年級英文語常會活動", start: "2026-03-31", color: "#2ecc71", category: "活動" },
  { id: "p16", title: "學生春季生日會", start: "2026-03-31", color: "#e74c3c", category: "活動" },
  { id: "p17", title: "派發傑出學生選舉申請表", start: "2026-03-31", color: "#7f8c8d", category: "校務" },
  { id: "p18", title: "領取正取生名單", start: "2026-03-31", color: "#7f8c8d", category: "校務" },
  { id: "p19", title: "復活節崇拜及小四福音活動", start: "2026-04-01", color: "#e74c3c", category: "活動" },
  { id: "p20", title: "復活節假期", start: "2026-04-02", end: "2026-04-08", color: "#e74c3c", category: "假期" },
  { id: "p21", title: "「新時代築夢計劃（人工智能）」交流團", start: "2026-04-03", color: "#9b59b6", category: "交流" },
];
