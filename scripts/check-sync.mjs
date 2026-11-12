// בודק שהגדרות שכתובות בכמה קבצים זהות בכולם. מריצים מתיקיית הריפו:
//   node scripts/check-sync.mjs
// יוצא עם קוד 1 אם משהו לא תואם.
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const files = {
  site: read("zamin24/index.html"),
  thanks: read("zamin24/thanks.html"),
  privacy: read("zamin24/privacy.html"),
  bot: read("zamin24-bot/functions/index.js"),
  rules: read("zamin24-bot/firestore.rules"),
  dashboard: read("zamin24-bot/dashboard/index.html"),
  offer: read("zamin24/01-הצעה-ומחירון.md"),
};
let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};
const all = (needle, keys) => keys.filter((k) => !files[k].includes(needle));

for (const price of ["₪790", "₪1,690", "₪149"]) {
  const missing = all(price, ["site", "bot", "offer"]);
  check(`מחיר ${price} מופיע באתר, בבוט ובהצעה`, !missing.length, missing.length ? `חסר ב: ${missing.join(", ")}` : "");
}

const owner = files.bot.match(/ownerPhone:\s*"(\d+)"/)?.[1];
const waLinks = (txt) => [...txt.matchAll(/wa\.me\/(\d+)/g)].map((m) => m[1]);
const linked = [...new Set([...waLinks(files.site), ...waLinks(files.thanks), ...waLinks(files.privacy)])];
check("מספר הוואטסאפ זהה באתר, בדף התודה, במדיניות ובבוט (ownerPhone)", linked.length === 1 && linked[0] === owner,
  `בוט: ${owner} · קישורים: ${linked.join(", ") || "אין"}`);

const agents = (files.bot.match(/ALLOWED_AGENTS\s*=\s*\[([^\]]*)\]/)?.[1] || "").match(/[\w.+-]+@[\w.-]+/g) || [];
const ruleAgents = (files.rules.match(/token\.email in \[([^\]]*)\]/)?.[1] || "").match(/[\w.+-]+@[\w.-]+/g) || [];
const same = agents.length > 0 && agents.length === ruleAgents.length && agents.every((a) => ruleAgents.includes(a));
check("המיילים ב-ALLOWED_AGENTS זהים למיילים ב-firestore.rules", same, `${agents.length} בקוד · ${ruleAgents.length} בחוקים`);

const region = "europe-west1";
check(`אזור Firebase ${region} זהה בבוט ובדשבורד`, files.bot.includes(`region: "${region}"`) && files.dashboard.includes(`"${region}"`));

console.log(failed ? `\n${failed} בדיקות נכשלו` : "\nהכול תואם");
process.exit(failed ? 1 : 0);
