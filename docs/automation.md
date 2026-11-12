# אוטומציה: פריסה והקמה דרך GitHub Actions

אחרי הקמה חד-פעמית של כ-30 דקות, כל שינוי שנדחף לענף `main` נפרס לבד: האתר ל-Netlify, הבוט וחוקי Firestore ל-Firebase, והדשבורד ל-Netlify. החיבורים בין השירותים (webhooks, תבנית ההתראה, דומיין מורשה) מוקמים בלחיצה אחת.

**מה רץ איפה:**

| קובץ | מתי רץ | מה עושה |
|---|---|---|
| `.github/workflows/deploy.yml` | בכל דחיפה ל-`main`, או ידנית | בדיקת סנכרון → אתר → פונקציות וחוקים → דשבורד |
| `.github/workflows/setup.yml` | ידנית בלבד | סודות ב-Firebase, אפליקציית ווב לדשבורד, Google, Netlify, Meta |
| `scripts/ci/setup.mjs` | מתוך setup.yml | הקריאות ל-Netlify, Meta ו-Google. כל שלב בודק מה כבר קיים, אז אפשר להריץ שוב. |

כל חלק בפריסה **מדלג לבד** אם הסודות שלו עוד לא הוגדרו, וכותב בסיכום של הריצה מה חסר.

---

## שלב 1: מה שרק אתה יכול לעשות (פעם אחת)

### Google / Firebase (כ-10 דקות)
1. https://console.firebase.google.com → **Add project** → שם, למשל `zamin24`. שמור את **Project ID**.
2. **Upgrade** לתוכנית **Blaze** (דורש כרטיס אשראי. בהיקף של זמין24 החיוב בפועל קרוב לאפס).
3. **Authentication → Sign-in method → Google → Enable.** (את זה אי אפשר להפעיל דרך API בלי ליצור לקוח OAuth ידנית, ולחיצה אחת כאן פשוטה יותר.)
4. חשבון שירות לפריסה: https://console.cloud.google.com/iam-admin/serviceaccounts → **Create service account** → שם `github-deploy` → תפקידים:
   - Firebase Admin
   - Service Account User
   - Secret Manager Admin
   - Service Usage Admin
   - Cloud Functions Admin
5. בחשבון שנוצר → **Keys → Add key → JSON**. הקובץ יורד למחשב. אל תשמור אותו בריפו.

### Meta (כ-15 דקות, ואימות העסק לוקח יותר)
1. https://developers.facebook.com → **Create App** → Business → **Add product: WhatsApp**.
2. שמור: **App ID**, **App Secret** (App settings → Basic), **WhatsApp Business Account ID**, **Phone Number ID**.
3. טוקן קבוע: Business Settings → **System users** → Add → הרשאות `whatsapp_business_messaging` ו-`whatsapp_business_management` → **Generate token**.
4. מספר טלפון לפרודקשן ואימות העסק — בתוך WhatsApp Manager.

### Netlify (2 דקות)
1. https://app.netlify.com → User settings → **Applications → Personal access tokens → New access token**.

### החלטות
- מחרוזת אקראית ארוכה ל-`VERIFY_TOKEN` ואחת ל-`NETLIFY_WEBHOOK_SECRET` (למשל 32 תווים כל אחת).

---

## שלב 2: להכניס הכול ל-GitHub (5 דקות)

בריפו: **Settings → Secrets and variables → Actions**.

**Secrets** (מוצפנים, לא נראים אחרי השמירה):

| שם | מה זה |
|---|---|
| `GCP_SA_KEY` | כל התוכן של קובץ ה-JSON מ-Google |
| `NETLIFY_AUTH_TOKEN` | הטוקן מ-Netlify |
| `WA_TOKEN` | הטוקן הקבוע של ה-System user במטא |
| `APP_SECRET` | App Secret של האפליקציה במטא |
| `PHONE_NUMBER_ID` | Phone Number ID של מספר הבוט |
| `VERIFY_TOKEN` | המחרוזת האקראית הראשונה |
| `NETLIFY_WEBHOOK_SECRET` | המחרוזת האקראית השנייה |

**Variables** (לא סודיים):

| שם | ערך | חובה? |
|---|---|---|
| `FIREBASE_PROJECT_ID` | ה-Project ID | כן |
| `META_APP_ID` | App ID | כן |
| `META_WABA_ID` | WhatsApp Business Account ID | כן |
| `OWNER_EMAIL` | המייל שאליו יגיעו התראות על הטופס | מומלץ |
| `SHEET_ID` | מזהה גיליון הלידים (שלב 4) | לא |
| `NETLIFY_SITE_NAME` | שם האתר ב-Netlify. ברירת מחדל: `zamin24` | לא |
| `NETLIFY_DASHBOARD_SITE_NAME` | שם אתר הדשבורד. ברירת מחדל: `zamin24-inbox` | לא |
| `DASHBOARD_DOMAIN` | אם לדשבורד יש דומיין משלו | לא |
| `OWNER_ALERT_TEMPLATE` | שם תבנית ההתראה. ברירת מחדל: `zamin24_alert` | לא |

---

## שלב 3: להריץ, בסדר הזה

1. **Actions → Setup → Run workflow → `all`**
   מגדיר את סודות הבוט ב-Firebase, יוצר אפליקציית ווב לדשבורד, מוסיף את דומיין הדשבורד לדומיינים המורשים, מפעיל Google Sheets API, יוצר את שני האתרים ב-Netlify ומחבר את הטופס (התראת מייל + webhook ל-`netlifyLead`).
2. **Actions → Deploy → Run workflow**
   פורס את הכול. בסיכום של הריצה תופיע כתובת ה-Webhook של הבוט.
3. **Actions → Setup → Run workflow → `meta`**
   שולח לאישור את תבנית ההתראה `zamin24_alert`, מחבר את ה-Webhook של האפליקציה לבוט ומנוי את חשבון ה-WhatsApp. רץ רק אחרי הפריסה, כי מטא בודקת מיד שהכתובת עונה.

בסוף כל ריצה, בעמוד הריצה, יש **Summary** בעברית: מה הוקם, מה כבר היה קיים ומה חסר.

## שלב 4 (לא חובה): גיליון לידים
1. צור גיליון "זמין24 - לידים" עם הכותרות: `תאריך | שם | טלפון | סוג עסק | מקור | סטטוס | הערות`.
2. שתף אותו בהרשאת עריכה עם הכתובת שמופיעה בסיכום של שלב `google` (נראית כמו `123456789-compute@developer.gserviceaccount.com`).
3. הוסף את המזהה שלו כ-Variable בשם `SHEET_ID`, והרץ Deploy.

(חשבון שירות לא יכול ליצור גיליון משלו בדרייב, ולכן את הגיליון יוצרים ידנית.)

## פריסה אוטומטית
`deploy.yml` רץ על כל דחיפה ל-`main`. העבודה כרגע בענף `claude/affectionate-hamilton-ajys43`, אז צריך למזג אותו ל-`main` (או להריץ Deploy ידנית).

## אבטחה
- כל הסודות נשמרים רק ב-GitHub Secrets ו-Firebase Secret Manager. הם לא בקוד ולא מודפסים ללוג.
- חשבון השירות `github-deploy` מוגבל לפרויקט אחד. אפשר לבטל את המפתח בכל רגע ב-Google Cloud.
- אם ריצה נכשלת על הרשאה, הלוג מציין איזה תפקיד חסר לחשבון השירות.
