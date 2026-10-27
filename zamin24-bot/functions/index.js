/**
 * זמין24 — בוט וואטסאפ v2: בוט + השתלטות אנושית (Human Takeover)
 * ----------------------------------------------------------------
 * חדש בגרסה 2:
 * - כל הודעה (נכנסת/יוצאת) נשמרת ב-Firestore → הדשבורד מציג שיחה מלאה בזמן אמת
 * - mode לכל שיחה: "bot" (ברירת מחדל) / "human" (הבוט שותק)
 * - מעבר אוטומטי ל-human: הלקוח ביקש נציג, או שהבוט לא הבין פעמיים
 * - פונקציות לדשבורד: שליחת הודעה כנציג, החלפת מצב שיחה
 */

const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const WA_TOKEN = defineSecret("WA_TOKEN");
const VERIFY_TOKEN = defineSecret("VERIFY_TOKEN");
const PHONE_NUMBER_ID = defineSecret("PHONE_NUMBER_ID");

// ⚠️ PLACEHOLDER — המיילים שמורשים להיכנס לדשבורד (חשבון גוגל שלך)
const ALLOWED_AGENTS = ["michael.hamo29@gmail.com"];

const BUSINESS_CONFIG = {
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
  leadDone: (name) =>
    `תודה ${name}! ✅ הפרטים אצלנו ונחזור אליך תוך שעות ספורות.\nבינתיים: https://zamin24.netlify.app`,
  fallback:
    "לא בטוח שהבנתי 🙈 כתבו:\n1️⃣ לפרטים על השירות\n2️⃣ למחירון\n3️⃣ לדבר עם בן אדם",
  backToBot: "חוזר למענה האוטומטי 🤖 כתבו 3 בכל שלב כדי לחזור לנציג.",
};

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
    ts: admin.firestore.FieldValue.serverTimestamp(),
  });
  await convRef.set(
    {
      lastMessage: text.slice(0, 80),
      lastSender: sender,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(sender === "customer" ? { unread: admin.firestore.FieldValue.increment(1) } : {}),
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
    { ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function saveLead(phone, text, source, token, phoneNumberId) {
  await db.collection("wa_leads").add({
    phone, details: text, source,
    createdAt: admin.firestore.FieldValue.serverTimestamp(), status: "new",
  });
  await sendText(
    BUSINESS_CONFIG.ownerPhone,
    `🔥 ליד חדש בזמין24!\nטלפון: ${phone}\nפרטים: ${text}\nמקור: ${source}`,
    token, phoneNumberId, "bot"
  );
}

// ---- מעבר לנציג אנושי ----
async function handoffToHuman(phone, reason, token, phoneNumberId) {
  await setState(phone, { mode: "human", handoffReason: reason, failCount: 0 });
  await sendText(phone, BUSINESS_CONFIG.humanHandoff, token, phoneNumberId);
  await sendText(
    BUSINESS_CONFIG.ownerPhone,
    `🙋 שיחה עברה לנציג!\nטלפון: ${phone}\nסיבה: ${reason}\nהיכנס לדשבורד לענות.`,
    token, phoneNumberId, "bot"
  );
}

// ---- מוח הבוט ----
async function handleMessage(phone, text, token, phoneNumberId) {
  await logMessage(phone, text, "customer");
  const state = await getState(phone);
  const t = (text || "").trim();

  // מצב אנושי → הבוט שותק לחלוטין. הנציג עונה מהדשבורד.
  if (state.mode === "human") return;

  if (state.stage === "new" || !state.stage) {
    await sendText(phone, BUSINESS_CONFIG.greeting + "\n\n" + BUSINESS_CONFIG.menu, token, phoneNumberId);
    await setState(phone, { stage: "menu", mode: "bot", failCount: 0 });
    return;
  }

  if (state.stage === "menu") {
    if (t === "1") {
      await sendText(phone, BUSINESS_CONFIG.leadAsk, token, phoneNumberId);
      await setState(phone, { stage: "collect_lead", failCount: 0 });
    } else if (t === "2") {
      await sendText(phone, BUSINESS_CONFIG.pricing, token, phoneNumberId);
      await setState(phone, { failCount: 0 });
    } else if (t === "3") {
      await handoffToHuman(phone, "הלקוח ביקש נציג", token, phoneNumberId);
    } else {
      const fails = (state.failCount || 0) + 1;
      if (fails >= 2) {
        // הבוט לא הבין פעמיים → מעבירים לאדם במקום לתסכל
        await handoffToHuman(phone, "הבוט לא הבין פעמיים", token, phoneNumberId);
      } else {
        await sendText(phone, BUSINESS_CONFIG.fallback, token, phoneNumberId);
        await setState(phone, { failCount: fails });
      }
    }
    return;
  }

  if (state.stage === "collect_lead") {
    const firstName = t.split(/[ ,]+/)[0] || "";
    await saveLead(phone, t, state.source || "תפריט - מתעניין", token, phoneNumberId);
    await sendText(phone, BUSINESS_CONFIG.leadDone(firstName), token, phoneNumberId);
    await setState(phone, { stage: "menu", leadCaptured: true, failCount: 0 });
    return;
  }

  await sendText(phone, BUSINESS_CONFIG.fallback, token, phoneNumberId);
  await setState(phone, { stage: "menu" });
}

// ---- Webhook ----
exports.whatsappWebhook = onRequest(
  { secrets: [WA_TOKEN, VERIFY_TOKEN, PHONE_NUMBER_ID], region: "europe-west1" },
  async (req, res) => {
    if (req.method === "GET") {
      const ok =
        req.query["hub.mode"] === "subscribe" &&
        req.query["hub.verify_token"] === VERIFY_TOKEN.value();
      return ok ? res.status(200).send(req.query["hub.challenge"]) : res.sendStatus(403);
    }
    if (req.method === "POST") {
      try {
        const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (message && message.type === "text") {
          await handleMessage(
            message.from,
            message.text?.body || "",
            WA_TOKEN.value(),
            PHONE_NUMBER_ID.value()
          );
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
    if (!ok) throw new HttpsError("internal", "שליחה לוואטסאפ נכשלה");
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
      await sendText(phone, BUSINESS_CONFIG.backToBot, WA_TOKEN.value(), PHONE_NUMBER_ID.value());
    }
    return { ok: true };
  }
);
