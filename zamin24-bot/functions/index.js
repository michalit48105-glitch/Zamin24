/**
 * זמין24 — בוט וואטסאפ v3: בוט + השתלטות אנושית (Human Takeover)
 * ----------------------------------------------------------------
 * גרסה 2:
 * - כל הודעה (נכנסת/יוצאת) נשמרת ב-Firestore → הדשבורד מציג שיחה מלאה בזמן אמת
 * - mode לכל שיחה: "bot" (ברירת מחדל) / "human" (הבוט שותק)
 * - מעבר אוטומטי ל-human: הלקוח ביקש נציג, או שהבוט לא הבין פעמיים
 * - פונקציות לדשבורד: שליחת הודעה כנציג, החלפת מצב שיחה
 * חדש בגרסה 3:
 * - אימות חתימת X-Hub-Signature-256 על כל בקשה ל-Webhook (סוד APP_SECRET)
 * - דילוג על הודעות כפולות לפי מזהה ההודעה (wa_processed)
 * - כפתורים ותפריטים נקראים כטקסט; הודעה קולית, תמונה וכו' מקבלות תשובה
 * - lastCustomerAt בכל שיחה, כדי שהדשבורד יתריע על חלון 24 השעות
 * - ההגדרות של העסק נטענות מ-Firestore (businesses/{PHONE_NUMBER_ID}) מעל ברירת המחדל
 * חדש בגרסה 4:
 * - כל ליד (מהבוט ומטופס האתר) נכתב גם ל-Google Sheet אחד, אם הוגדר SHEET_ID
 * - netlifyLead: מקבל את טופס האתר מ-Netlify (Outgoing webhook חתום) ושומר אותו ב-wa_leads
 * - התראות לבעלים: אם הודעה רגילה נחסמת (מחוץ לחלון 24 השעות), נשלחת הודעת תבנית מאושרת
 */

const crypto = require("crypto");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { GoogleAuth } = require("google-auth-library");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const WA_TOKEN = defineSecret("WA_TOKEN");
const VERIFY_TOKEN = defineSecret("VERIFY_TOKEN");
const PHONE_NUMBER_ID = defineSecret("PHONE_NUMBER_ID");
const APP_SECRET = defineSecret("APP_SECRET"); // App Secret של האפליקציה במטא (App settings → Basic)
const NETLIFY_WEBHOOK_SECRET = defineSecret("NETLIFY_WEBHOOK_SECRET"); // JWS secret token של ה-Outgoing webhook בנטליפיי

// הגדרות לא סודיות (functions/.env). ריק = התכונה כבויה, והפריסה עובדת גם בלעדיהן.
const SHEET_ID = defineString("SHEET_ID", { default: "", description: "מזהה Google Sheet הלידים (החלק שבין /d/ ל-/edit). ריק = בלי גיליון" });
const OWNER_ALERT_TEMPLATE = defineString("OWNER_ALERT_TEMPLATE", { default: "", description: "שם תבנית מאושרת במטא להתראות לבעלים. ריק = רק הודעה רגילה" });
const OWNER_ALERT_LANG = defineString("OWNER_ALERT_LANG", { default: "he", description: "קוד השפה של תבנית ההתראה" });

// ⚠️ PLACEHOLDER — המיילים שמורשים להיכנס לדשבורד (חשבון גוגל שלך)
// חייב להתאים לפונקציה isAgent ב-firestore.rules
const ALLOWED_AGENTS = ["michael.hamo29@gmail.com"];

// ברירת מחדל. כל שדה אפשר לדרוס במסמך businesses/{PHONE_NUMBER_ID} ב-Firestore,
// כך שכל לקוח (מספר וואטסאפ) מקבל טקסטים משלו מאותו קוד.
// {name} בתוך leadDone מוחלף בשם הלקוח.
const DEFAULT_CONFIG = {
  name: "זמין24",
  ownerPhone: "972504666396", // ⚠️ PLACEHOLDER — המספר שלך להתראות
  greeting:
    "היי! 👋 הגעת לזמין24 — אנחנו מקימים לעסקים קטנים דף נחיתה + בוט וואטסאפ (כמו זה שמדבר איתך עכשיו 😉).",
  menu:
    "במה נוכל לעזור?\n1️⃣ אני רוצה כזה לעסק שלי\n2️⃣ מחירון\n3️⃣ לדבר עם בן אדם\n\nפשוט כתבו מספר 🙂",
  pricing:
    "💰 מחירון זמין24:\n\n🚀 חבילת השקה — ₪790 חד־פעמי (5 מקומות)\nדף נחיתה + בוט וואטסאפ + הדרכה + חודש ליווי\n\n⭐ חבילה מלאה — ₪1,690 + ₪149/חודש\nכל הנ״ל + עדכונים שוטפים, תזכורות ודוח לידים\n\nרוצה להתקדם? כתבו 1 ⚡",
  humanHandoff:
    "מעביר אותך לנציג אנושי 🙋 תוך כמה דקות מישהו מצטרף לשיחה. אפשר בינתיים לכתוב את השאלה שלך.",
  leadAsk:
    "מעולה! 🎯 מה השם שלך ומה סוג העסק? (למשל: \"יעל, קוסמטיקה\")",
  leadDone:
    "תודה {name}! ✅ הפרטים אצלנו ונחזור אליך תוך שעות ספורות.\nבינתיים: https://zamin24.netlify.app",
  fallback:
    "לא בטוח שהבנתי 🙈 כתבו:\n1️⃣ לפרטים על השירות\n2️⃣ למחירון\n3️⃣ לדבר עם בן אדם",
  unsupported:
    "קיבלתי 🙏 כרגע אני יודע לקרוא רק הודעות טקסט. כתבו:\n1️⃣ לפרטים על השירות\n2️⃣ למחירון\n3️⃣ לדבר עם בן אדם",
  backToBot: "חוזר למענה האוטומטי 🤖 כתבו 3 בכל שלב כדי לחזור לנציג.",
};

// ---- הגדרות העסק: Firestore מעל ברירת המחדל, עם מטמון קצר ----
const CONFIG_TTL_MS = 60 * 1000;
const configCache = new Map();
async function getConfig(phoneNumberId) {
  const hit = configCache.get(phoneNumberId);
  if (hit && Date.now() - hit.at < CONFIG_TTL_MS) return hit.cfg;
  let cfg = DEFAULT_CONFIG;
  try {
    const snap = await db.collection("businesses").doc(String(phoneNumberId)).get();
    if (snap.exists) cfg = { ...DEFAULT_CONFIG, ...snap.data() };
  } catch (err) {
    console.error("Config load failed, using defaults:", err);
  }
  configCache.set(phoneNumberId, { cfg, at: Date.now() });
  return cfg;
}

const GRAPH_URL = (id) => `https://graph.facebook.com/v21.0/${id}/messages`;

// ---- שליחת טקסט + תיעוד בהיסטוריית השיחה ----
async function sendText(to, body, token, phoneNumberId, sender = "bot") {
  const res = await fetch(GRAPH_URL(phoneNumberId), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!res.ok) {
    console.error("WA send failed:", res.status, await res.text());
    return false;
  }
  await logMessage(to, body, sender);
  return true;
}

// ---- תיעוד הודעה בשיחה (ל-live view בדשבורד) ----
async function logMessage(phone, text, sender) {
  const convRef = db.collection("wa_conversations").doc(phone);
  await convRef.collection("messages").add({
    text,
    sender, // "customer" | "bot" | "agent"
    ts: FieldValue.serverTimestamp(),
  });
  await convRef.set(
    {
      lastMessage: text.slice(0, 80),
      lastSender: sender,
      updatedAt: FieldValue.serverTimestamp(),
      // lastCustomerAt פותח את חלון 24 השעות שבו מותר לשלוח הודעה חופשית
      ...(sender === "customer" ? { unread: FieldValue.increment(1), lastCustomerAt: FieldValue.serverTimestamp() } : {}),
    },
    { merge: true }
  );
}

// ---- התראה לבעלים: הודעה רגילה, ואם מטא חוסמת (עברו 24 שעות) — הודעת תבנית ----
async function sendOwnerAlert(cfg, text, token, phoneNumberId) {
  if (await sendText(cfg.ownerPhone, text, token, phoneNumberId, "bot")) return true;
  const template = OWNER_ALERT_TEMPLATE.value();
  if (!template) {
    console.error("Owner alert not delivered. Set OWNER_ALERT_TEMPLATE to send alerts outside the 24h window.");
    return false;
  }
  // פרמטר בתבנית לא יכול להכיל ירידות שורה
  const param = text.replace(/\s*\n+\s*/g, " · ").slice(0, 1000);
  const res = await fetch(GRAPH_URL(phoneNumberId), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: cfg.ownerPhone, type: "template",
      template: { name: template, language: { code: OWNER_ALERT_LANG.value() }, components: [{ type: "body", parameters: [{ type: "text", text: param }] }] },
    }),
  });
  if (!res.ok) {
    console.error("Owner alert template failed:", res.status, await res.text());
    return false;
  }
  await logMessage(cfg.ownerPhone, text, "bot");
  return true;
}

// ---- Google Sheet: שורה לכל ליד, עם ה-service account של הפונקציות ----
const sheetsAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const toLocalPhone = (p) => (String(p || "").startsWith("972") ? "0" + String(p).slice(3) : String(p || ""));
const toIntlPhone = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.startsWith("0") ? "972" + d.slice(1) : d; };
async function appendLeadRow({ name, phone, business, source, notes = "" }) {
  const id = SHEET_ID.value();
  if (!id) return false;
  try {
    const client = await sheetsAuth.getClient();
    const date = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
    await client.request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/A:G:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      method: "POST",
      // כותרות הגיליון: תאריך | שם | טלפון | סוג עסק | מקור | סטטוס | הערות
      data: { values: [[date, name || "", toLocalPhone(phone), business || "", source, "חדש", notes]] },
    });
    return true;
  } catch (err) {
    console.error("Sheets append failed:", err.message);
    return false;
  }
}

async function getState(phone) {
  const doc = await db.collection("wa_conversations").doc(phone).get();
  return doc.exists ? doc.data() : { stage: "new", mode: "bot", failCount: 0 };
}
async function setState(phone, data) {
  await db.collection("wa_conversations").doc(phone).set(
    { ...data, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function saveLead(cfg, phone, text, source, token, phoneNumberId) {
  await db.collection("wa_leads").add({
    phone, details: text, source,
    createdAt: FieldValue.serverTimestamp(), status: "new",
  });
  const [name, ...rest] = text.split(/\s*,\s*/);
  await appendLeadRow({ name, phone, business: rest.join(", "), source: `בוט וואטסאפ · ${source}` });
  await sendOwnerAlert(
    cfg,
    `🔥 ליד חדש ב${cfg.name}!\nטלפון: ${phone}\nפרטים: ${text}\nמקור: ${source}`,
    token, phoneNumberId
  );
}

// ---- מעבר לנציג אנושי ----
async function handoffToHuman(cfg, phone, reason, token, phoneNumberId) {
  await setState(phone, { mode: "human", handoffReason: reason, failCount: 0 });
  await sendText(phone, cfg.humanHandoff, token, phoneNumberId);
  await sendOwnerAlert(
    cfg,
    `🙋 שיחה עברה לנציג!\nטלפון: ${phone}\nסיבה: ${reason}\nהיכנס לדשבורד לענות.`,
    token, phoneNumberId
  );
}

// ---- מוח הבוט ----
async function handleMessage(cfg, phone, text, token, phoneNumberId) {
  await logMessage(phone, text, "customer");
  const state = await getState(phone);
  const t = (text || "").trim();

  // מצב אנושי → הבוט שותק לחלוטין. הנציג עונה מהדשבורד.
  if (state.mode === "human") return;

  if (state.stage === "new" || !state.stage) {
    await sendText(phone, cfg.greeting + "\n\n" + cfg.menu, token, phoneNumberId);
    await setState(phone, { stage: "menu", mode: "bot", failCount: 0 });
    return;
  }

  if (state.stage === "menu") {
    if (t === "1") {
      await sendText(phone, cfg.leadAsk, token, phoneNumberId);
      await setState(phone, { stage: "collect_lead", failCount: 0 });
    } else if (t === "2") {
      await sendText(phone, cfg.pricing, token, phoneNumberId);
      await setState(phone, { failCount: 0 });
    } else if (t === "3") {
      await handoffToHuman(cfg, phone, "הלקוח ביקש נציג", token, phoneNumberId);
    } else {
      const fails = (state.failCount || 0) + 1;
      if (fails >= 2) {
        // הבוט לא הבין פעמיים → מעבירים לאדם במקום לתסכל
        await handoffToHuman(cfg, phone, "הבוט לא הבין פעמיים", token, phoneNumberId);
      } else {
        await sendText(phone, cfg.fallback, token, phoneNumberId);
        await setState(phone, { failCount: fails });
      }
    }
    return;
  }

  if (state.stage === "collect_lead") {
    const firstName = t.split(/[ ,]+/)[0] || "";
    await saveLead(cfg, phone, t, state.source || "תפריט - מתעניין", token, phoneNumberId);
    await sendText(phone, cfg.leadDone.replace("{name}", firstName), token, phoneNumberId);
    await setState(phone, { stage: "menu", leadCaptured: true, failCount: 0 });
    return;
  }

  await sendText(phone, cfg.fallback, token, phoneNumberId);
  await setState(phone, { stage: "menu" });
}

// ---- הודעה שאינה טקסט (קולית, תמונה, מסמך...) ----
const MEDIA_LABELS = {
  audio: "הודעה קולית", image: "תמונה", video: "סרטון", document: "מסמך",
  sticker: "סטיקר", location: "מיקום", contacts: "איש קשר", reaction: "תגובה",
};
async function handleUnsupported(cfg, phone, type, token, phoneNumberId) {
  if (type === "reaction") return; // אימוג'י על הודעה קיימת — לא דורש מענה
  await logMessage(phone, `[${MEDIA_LABELS[type] || type}]`, "customer");
  const state = await getState(phone);
  if (state.mode === "human") return; // הנציג יראה את זה בדשבורד
  await sendText(phone, cfg.unsupported, token, phoneNumberId);
  if (!state.stage || state.stage === "new") await setState(phone, { stage: "menu", mode: "bot", failCount: 0 });
}

// כפתורים ותפריטים מגיעים כ-interactive/button — קוראים אותם כטקסט
function textOf(message) {
  if (message.type === "text") return message.text?.body || "";
  if (message.type === "button") return message.button?.text || "";
  if (message.type === "interactive") {
    const i = message.interactive || {};
    return i.button_reply?.title || i.list_reply?.title || "";
  }
  return null;
}

// ---- אבטחה: רק בקשות שמטא חתמה עליהן ----
function hasValidSignature(req, appSecret) {
  const header = req.get("x-hub-signature-256") || "";
  if (!header.startsWith("sha256=") || !req.rawBody) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(req.rawBody).digest("hex");
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  const want = Buffer.from(expected, "hex");
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

// ---- מניעת כפילויות: מטא שולחת שוב אירוע שלא אושר בזמן ----
async function isFirstDelivery(messageId) {
  if (!messageId) return true;
  try {
    await db.collection("wa_processed").doc(messageId).create({ at: FieldValue.serverTimestamp() });
    return true;
  } catch (err) {
    if (err.code === 6) return false; // ALREADY_EXISTS
    throw err;
  }
}

// ---- Webhook ----
exports.whatsappWebhook = onRequest(
  { secrets: [WA_TOKEN, VERIFY_TOKEN, PHONE_NUMBER_ID, APP_SECRET], region: "europe-west1" },
  async (req, res) => {
    if (req.method === "GET") {
      const ok =
        req.query["hub.mode"] === "subscribe" &&
        req.query["hub.verify_token"] === VERIFY_TOKEN.value();
      return ok ? res.status(200).send(req.query["hub.challenge"]) : res.sendStatus(403);
    }
    if (req.method === "POST") {
      if (!hasValidSignature(req, APP_SECRET.value())) {
        console.warn("Webhook rejected: bad or missing signature");
        return res.sendStatus(401);
      }
      try {
        const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (message && (await isFirstDelivery(message.id))) {
          const token = WA_TOKEN.value();
          const phoneNumberId = PHONE_NUMBER_ID.value();
          const cfg = await getConfig(phoneNumberId);
          const text = textOf(message);
          if (text !== null) {
            await handleMessage(cfg, message.from, text, token, phoneNumberId);
          } else {
            await handleUnsupported(cfg, message.from, message.type, token, phoneNumberId);
          }
        }
      } catch (err) {
        console.error("Webhook error:", err);
      }
      return res.sendStatus(200);
    }
    return res.sendStatus(405);
  }
);

// ---- טופס האתר: Outgoing webhook של Netlify Forms ----
// נטליפיי חותמת כל קריאה ב-JWS (HS256) בכותרת X-Webhook-Signature, עם hash של גוף הבקשה.
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
function hasValidNetlifySignature(req, secret) {
  const jws = req.get("x-webhook-signature") || "";
  const [h, p, sig] = jws.split(".");
  if (!h || !p || !sig || !req.rawBody) return false;
  const expected = b64url(crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest());
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const claims = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    const bodyHash = crypto.createHash("sha256").update(req.rawBody).digest("hex");
    return claims.iss === "netlify" && claims.sha256 === bodyHash;
  } catch {
    return false;
  }
}

exports.netlifyLead = onRequest(
  { secrets: [NETLIFY_WEBHOOK_SECRET], region: "europe-west1" },
  async (req, res) => {
    if (req.method !== "POST") return res.sendStatus(405);
    if (!hasValidNetlifySignature(req, NETLIFY_WEBHOOK_SECRET.value())) {
      console.warn("Netlify webhook rejected: bad or missing signature");
      return res.sendStatus(401);
    }
    const d = req.body?.data || {};
    const name = String(d.name || "").trim().slice(0, 120);
    const phone = toIntlPhone(d.phone);
    const business = String(d.business || "").trim().slice(0, 120);
    if (!name || !phone) return res.sendStatus(200); // שליחה ריקה או ספאם — לא נשמרת
    await db.collection("wa_leads").add({
      phone, details: [name, business].filter(Boolean).join(", "), source: "טופס באתר",
      createdAt: FieldValue.serverTimestamp(), status: "new",
    });
    await appendLeadRow({ name, phone, business, source: "טופס באתר" });
    return res.sendStatus(200);
  }
);

// ---- אימות נציג ----
function assertAgent(request) {
  const email = request.auth?.token?.email;
  if (!email || !ALLOWED_AGENTS.includes(email)) {
    throw new HttpsError("permission-denied", "לא מורשה");
  }
}

// ---- דשבורד: שליחת הודעה כנציג ----
exports.sendAgentMessage = onCall(
  { secrets: [WA_TOKEN, PHONE_NUMBER_ID], region: "europe-west1" },
  async (request) => {
    assertAgent(request);
    const { phone, text } = request.data || {};
    if (!phone || !text) throw new HttpsError("invalid-argument", "חסר טלפון או טקסט");
    const ok = await sendText(phone, text, WA_TOKEN.value(), PHONE_NUMBER_ID.value(), "agent");
    // הסיבה הנפוצה לכישלון: עברו יותר מ-24 שעות מההודעה האחרונה של הלקוח
    if (!ok) throw new HttpsError("internal", "שליחה לוואטסאפ נכשלה. אם עברו 24 שעות מההודעה האחרונה של הלקוח, מטא מאפשרת רק הודעת תבנית.");
    // שליחת הודעה כנציג = השתלטות אוטומטית על השיחה
    await setState(phone, { mode: "human", unread: 0 });
    return { ok: true };
  }
);

// ---- דשבורד: החלפת מצב שיחה (bot/human) ----
exports.setConversationMode = onCall(
  { secrets: [WA_TOKEN, PHONE_NUMBER_ID], region: "europe-west1" },
  async (request) => {
    assertAgent(request);
    const { phone, mode } = request.data || {};
    if (!phone || !["bot", "human"].includes(mode)) {
      throw new HttpsError("invalid-argument", "פרמטרים שגויים");
    }
    await setState(phone, { mode, failCount: 0, unread: 0, ...(mode === "bot" ? { stage: "menu" } : {}) });
    if (mode === "bot") {
      const cfg = await getConfig(PHONE_NUMBER_ID.value());
      await sendText(phone, cfg.backToBot, WA_TOKEN.value(), PHONE_NUMBER_ID.value());
    }
    return { ok: true };
  }
);
