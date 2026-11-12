// הקמה חד-פעמית של החיבורים בין השירותים. רץ מתוך GitHub Actions (setup.yml).
//   node scripts/ci/setup.mjs <netlify|meta|google>
// כל שלב בודק קודם מה כבר קיים, כך שאפשר להריץ אותו שוב בלי ליצור כפילויות.
// משתני הסביבה מגיעים מ-GitHub Secrets ו-Variables. ערכים סודיים לא מודפסים ללוג.
import { appendFileSync } from "node:fs";

const env = (name, fallback = "") => (process.env[name] || fallback).trim();
const summary = (line) => {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\n");
};
const need = (...names) => {
  const missing = names.filter((n) => !env(n));
  if (missing.length) throw new Error(`חסרים ב-GitHub: ${missing.join(", ")}`);
};
async function call(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) { headers["Content-Type"] = "application/x-www-form-urlencoded"; payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${url.split("?")[0]} → ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

const REGION = "europe-west1";
const fnUrl = (project, name) => `https://${REGION}-${project}.cloudfunctions.net/${name}`;

// ---------- Netlify: אתרים, התראת מייל, webhook לטופס ----------
export async function setupNetlify() {
  need("NETLIFY_AUTH_TOKEN", "FIREBASE_PROJECT_ID", "NETLIFY_WEBHOOK_SECRET");
  const token = env("NETLIFY_AUTH_TOKEN");
  const api = "https://api.netlify.com/api/v1";
  const ensureSite = async (name) => {
    const found = (await call("GET", `${api}/sites?name=${encodeURIComponent(name)}&filter=all`, { token })).find((s) => s.name === name);
    if (found) { summary(`- אתר Netlify \`${name}\` כבר קיים: ${found.ssl_url || found.url}`); return found; }
    const created = await call("POST", `${api}/sites`, { token, body: { name } });
    summary(`- נוצר אתר Netlify \`${name}\`: ${created.ssl_url || created.url}`);
    return created;
  };
  const site = await ensureSite(env("NETLIFY_SITE_NAME", "zamin24"));
  const inbox = await ensureSite(env("NETLIFY_DASHBOARD_SITE_NAME", "zamin24-inbox"));

  const hooks = await call("GET", `${api}/hooks?site_id=${site.id}`, { token });
  const has = (type, key, value) => hooks.some((h) => h.type === type && h.event === "submission_created" && h.data?.[key] === value);
  const hookUrl = fnUrl(env("FIREBASE_PROJECT_ID"), "netlifyLead");
  if (has("url", "url", hookUrl)) summary("- ה-webhook של הטופס כבר מחובר");
  else {
    await call("POST", `${api}/hooks`, { token, body: { site_id: site.id, type: "url", event: "submission_created", data: { url: hookUrl, signature_secret: env("NETLIFY_WEBHOOK_SECRET") } } });
    summary(`- חובר webhook לטופס: ${hookUrl}`);
  }
  const email = env("OWNER_EMAIL");
  if (!email) summary("- דילגתי על התראת מייל: המשתנה OWNER_EMAIL לא מוגדר");
  else if (has("email", "email", email)) summary("- התראת המייל על טופס כבר מוגדרת");
  else {
    await call("POST", `${api}/hooks`, { token, body: { site_id: site.id, type: "email", event: "submission_created", data: { email } } });
    summary("- הוגדרה התראת מייל על כל שליחה של הטופס");
  }
  return { site, inbox };
}

// ---------- Meta: תבנית התראה, Webhook לאפליקציה, מינוי ה-WABA ----------
export async function setupMeta() {
  need("WA_TOKEN", "META_WABA_ID", "META_APP_ID", "APP_SECRET", "VERIFY_TOKEN", "FIREBASE_PROJECT_ID");
  const graph = "https://graph.facebook.com/v21.0";
  const token = env("WA_TOKEN"), waba = env("META_WABA_ID");
  const template = env("OWNER_ALERT_TEMPLATE", "zamin24_alert");

  const existing = await call("GET", `${graph}/${waba}/message_templates?name=${encodeURIComponent(template)}`, { token });
  const tpl = (existing.data || []).find((t) => t.name === template);
  if (tpl) summary(`- תבנית \`${template}\` כבר קיימת, סטטוס: ${tpl.status}`);
  else {
    await call("POST", `${graph}/${waba}/message_templates`, { token, body: {
      name: template, category: "UTILITY", language: "he",
      components: [{ type: "BODY", text: "התראה מזמין24: {{1}}", example: { body_text: [["ליד חדש · טלפון 0500000000 · דנה, קוסמטיקה"]] } }],
    } });
    summary(`- נשלחה לאישור תבנית \`${template}\` (האישור במטא לוקח בדרך כלל דקות עד שעות)`);
  }

  // Webhook ברמת האפליקציה: לאן מטא שולחת הודעות נכנסות
  const callback = fnUrl(env("FIREBASE_PROJECT_ID"), "whatsappWebhook");
  await call("POST", `${graph}/${env("META_APP_ID")}/subscriptions`, { form: {
    object: "whatsapp_business_account", callback_url: callback, verify_token: env("VERIFY_TOKEN"),
    fields: "messages", access_token: `${env("META_APP_ID")}|${env("APP_SECRET")}`,
  } });
  summary(`- ה-Webhook של האפליקציה מצביע על ${callback} (שדה messages)`);
  await call("POST", `${graph}/${waba}/subscribed_apps`, { token });
  summary("- חשבון ה-WhatsApp Business מנוי לאפליקציה");
}

// ---------- Google: דומיין הדשבורד, Sheets API, חשבון השירות לשיתוף הגיליון ----------
export async function setupGoogle() {
  need("GOOGLE_ACCESS_TOKEN", "FIREBASE_PROJECT_ID");
  const token = env("GOOGLE_ACCESS_TOKEN"), project = env("FIREBASE_PROJECT_ID");

  const cfgUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`;
  const cfg = await call("GET", cfgUrl, { token });
  const domain = env("DASHBOARD_DOMAIN", `${env("NETLIFY_DASHBOARD_SITE_NAME", "zamin24-inbox")}.netlify.app`);
  const domains = cfg.authorizedDomains || [];
  if (domains.includes(domain)) summary(`- \`${domain}\` כבר ברשימת הדומיינים המורשים`);
  else {
    await call("PATCH", `${cfgUrl}?updateMask=authorizedDomains`, { token, body: { authorizedDomains: [...domains, domain] } });
    summary(`- \`${domain}\` נוסף לדומיינים המורשים של Firebase Auth`);
  }

  await call("POST", `https://serviceusage.googleapis.com/v1/projects/${project}/services/sheets.googleapis.com:enable`, { token });
  summary("- Google Sheets API מופעל");

  const proj = await call("GET", `https://cloudresourcemanager.googleapis.com/v1/projects/${project}`, { token });
  summary(`- **לשתף את הגיליון** (הרשאת עריכה) עם: \`${proj.projectNumber}-compute@developer.gserviceaccount.com\``);
}

const STEPS = { netlify: setupNetlify, meta: setupMeta, google: setupGoogle };
if (import.meta.url === `file://${process.argv[1]}`) {
  const step = process.argv[2];
  if (!STEPS[step]) { console.error(`שלב לא מוכר: ${step}. אפשרויות: ${Object.keys(STEPS).join(", ")}`); process.exit(2); }
  summary(`### ${step}`);
  STEPS[step]().catch((err) => { summary(`- ✗ ${err.message}`); process.exit(1); });
}
