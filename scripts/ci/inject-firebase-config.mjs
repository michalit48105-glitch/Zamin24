// מכין עותק של הדשבורד לפריסה, עם ה-firebaseConfig של הפרויקט במקום PASTE_HERE.
//   node scripts/ci/inject-firebase-config.mjs <sdkconfig.json> <out-dir>
// sdkconfig.json הוא הפלט של: firebase apps:sdkconfig WEB --json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const [, , configPath, outDir] = process.argv;
const raw = JSON.parse(readFileSync(configPath, "utf8"));
const sdk = raw.result?.sdkConfig || raw.result || raw.sdkConfig || raw;
for (const key of ["apiKey", "authDomain", "projectId", "appId"]) {
  if (!sdk[key]) throw new Error(`firebaseConfig חסר את ${key}`);
}
const src = readFileSync(new URL("../../zamin24-bot/dashboard/index.html", import.meta.url), "utf8");
const block = /const firebaseConfig = \{[\s\S]*?\};/;
if (!block.test(src)) throw new Error("לא נמצא firebaseConfig בדשבורד");
const config = `const firebaseConfig = ${JSON.stringify({ apiKey: sdk.apiKey, authDomain: sdk.authDomain, projectId: sdk.projectId, appId: sdk.appId }, null, 2)};`;
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/index.html`, src.replace(block, config));
console.log(`dashboard built for project ${sdk.projectId}`);
