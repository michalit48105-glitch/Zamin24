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
 */

const crypto = require("crypto");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const WA_TOKEN = defineSecret("WA_TOKEN");
const VERIFY_TOKEN = defineSecret("VERIFY_TOKEN");
const PHONE_NUMBER_ID = defineSecret("PHONE_NUMBER_ID");
const APP_SECRET = defineSecret("APP_SECRET"); // App Secret של האפליקציה במטא (App settings → Basic)

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
  await sendText(
    cfg.ownerPhone,
    `🔥 ליד חדש ב${cfg.name}!\nטלפון: ${phone}\nפרטים: ${text}\nמקור: ${source}`,
    token, phoneNumberId, "bot"
  );
}

// ---- מעבר לנציג אנושי ----
async function handoffToHuman(cfg, phone, reason, token, phoneNumberId) {
  await setState(phone, { mode: "human", handoffReason: reason, failCount: 0 });
  await sendText(phone, cfg.humanHandoff, token, phoneNumberId);
  await sendText(
    cfg.ownerPhone,
    `🙋 שיחה עברה לנציג!\nטלפון: ${phone}\nסיבה: ${reason}\nהיכנס לדשבורד לענות.`,
    token, phoneNumberId, "bot"
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
