/**
 * Gmail → 學校行事曆 自動匯入
 *
 * 用法（喺目標 Gmail 帳戶操作）：
 * 1. 開 https://script.google.com → 新增專案 → 貼上此檔案全部內容
 * 2. 修改下面 CONFIG.SENDERS 為實際寄件人電郵（可以多個）
 * 3. 揀 checkEmails 函數 → 按「執行」一次，授權 Gmail 權限，並確認執行紀錄正常
 * 4. 揀 setupDailyTrigger 函數 → 按「執行」一次，設定每日早上 7 點自動執行
 *
 * 處理過嘅郵件會加上「已入行事曆」label，唔會重複處理。
 * 行事曆入面由郵件匯入嘅事件係粉紅色「郵件匯入」分類。
 */

var CONFIG = {
  // ★ 改呢度：只處理呢啲寄件人嘅郵件（可以係完整電郵或者 domain，例如 "edb.gov.hk"）
  SENDERS: [
    "example@keitsz.edu.hk",
  ],

  API_URL: "https://school-calendar-vercel.pages.dev/api/ingest-email",
  // ★ 改呢度：填入 EMAIL_INGEST_KEY（同 Cloudflare Pages 環境變數一致，見本機 .env.local）
  INGEST_KEY: "在此填入EMAIL_INGEST_KEY",

  LABEL: "已入行事曆",
  SEARCH_WINDOW: "2d",   // 只搵過去 2 日內嘅郵件（每日執行，有重疊以防漏）
  MAX_THREADS: 20,
  MAX_BODY_CHARS: 5000,
};

/** 每日主流程：搵新郵件 → 送去行事曆 API → 加 label */
function checkEmails() {
  var label = getOrCreateLabel_(CONFIG.LABEL);
  var fromQuery = CONFIG.SENDERS.map(function (s) { return "from:" + s; }).join(" OR ");
  var query = "(" + fromQuery + ") newer_than:" + CONFIG.SEARCH_WINDOW +
              " -label:" + CONFIG.LABEL.replace(/\s/g, "-");

  var threads = GmailApp.search(query, 0, CONFIG.MAX_THREADS);
  if (threads.length === 0) {
    Logger.log("冇新郵件需要處理。查詢：" + query);
    return;
  }

  var emails = [];
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      emails.push({
        subject: msg.getSubject(),
        body: msg.getPlainBody().slice(0, CONFIG.MAX_BODY_CHARS),
      });
    });
  });

  Logger.log("搵到 " + threads.length + " 個對話（" + emails.length + " 封郵件），送去解析…");

  var response = UrlFetchApp.fetch(CONFIG.API_URL, {
    method: "post",
    contentType: "application/json",
    headers: { "x-ingest-key": CONFIG.INGEST_KEY },
    payload: JSON.stringify({ emails: emails }),
    muteHttpExceptions: true,
  });

  var code = response.getResponseCode();
  var bodyText = response.getContentText();
  Logger.log("API 回應 " + code + ": " + bodyText);

  if (code !== 200) {
    // 失敗時唔加 label，下次執行會重試
    throw new Error("行事曆 API 失敗（" + code + "）：" + bodyText);
  }

  var result = JSON.parse(bodyText);
  threads.forEach(function (thread) { thread.addLabel(label); });

  Logger.log("完成：新增 " + result.added + " 個事件，跳過重複 " + result.skipped + " 個。" +
             (result.events && result.events.length ? "\n事件：\n" + result.events.join("\n") : ""));
  if (result.errors && result.errors.length) {
    Logger.log("部分郵件解析失敗：\n" + result.errors.join("\n"));
  }
}

/** 執行一次，設定每日早上 7 點自動執行 checkEmails */
function setupDailyTrigger() {
  // 刪除舊 trigger 避免重複
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "checkEmails") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("checkEmails")
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .inTimezone("Asia/Hong_Kong")
    .create();
  Logger.log("已設定每日早上 7 點（香港時間）自動執行。");
}

/** 測試用：只解析唔寫入行事曆（dry run），睇下 AI 抽到啲乜 */
function testDryRun() {
  var response = UrlFetchApp.fetch(CONFIG.API_URL, {
    method: "post",
    contentType: "application/json",
    headers: { "x-ingest-key": CONFIG.INGEST_KEY },
    payload: JSON.stringify({
      dryRun: true,
      emails: [{
        subject: "測試：下星期五全校旅行",
        body: "各位同事，下星期五全校旅行，地點係大埔海濱公園，請於8:15回校集合。",
      }],
    }),
    muteHttpExceptions: true,
  });
  Logger.log(response.getResponseCode() + ": " + response.getContentText());
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
