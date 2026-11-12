# חיבור Google Sheets — משימות הכנה

מטרה: גיליון אחד שאליו נאספות כל הפניות — גם מטופס האתר וגם מהבוט.

**הקוד כבר מוכן** (גרסה 4 של `functions/index.js`):
- כל ליד מהבוט נכתב לגיליון.
- הפונקציה `netlifyLead` מקבלת כל שליחה של טופס האתר מנטליפיי, שומרת אותה ב-`wa_leads` (כך שהיא מופיעה גם בלשונית **לידים** בדשבורד) וכותבת אותה לגיליון.
- בלי `SHEET_ID` הכול ממשיך לעבוד, רק בלי הגיליון.

נשארו שלוש משימות קצרות שרק אתה יכול לעשות. **אין צורך ליצור Service Account ולהוריד מפתח JSON** — הפונקציות כותבות לגיליון עם חשבון השירות שכבר יש להן.

---

## משימה 1: יצירת הגיליון (5 דקות)

1. היכנס ל-https://sheets.google.com
2. צור גיליון חדש → שם: **זמין24 - לידים**
3. בשורה הראשונה, כתוב את הכותרות (עמודה בכל תא, מימין לשמאל):
   `תאריך` | `שם` | `טלפון` | `סוג עסק` | `מקור` | `סטטוס` | `הערות`
4. העתק את ה-ID מה-URL — החלק שבין `/d/` ל-`/edit`:
   `https://docs.google.com/spreadsheets/d/`**`XXXXXXXXX`**`/edit`

## משימה 2: שיתוף הגיליון עם הפונקציות (3 דקות)

1. אחרי הפריסה הראשונה: Google Cloud Console → **Cloud Run** (פונקציות v2 רצות שם) → בחר את `whatsappWebhook` → לשונית **Security** → העתק את **Service account**.
   בדרך כלל זו כתובת כמו `123456789-compute@developer.gserviceaccount.com`.
2. בגיליון → **Share / שיתוף** → הדבק את הכתובת → הרשאת **Editor / עריכה** → שלח.
3. Google Cloud Console → **APIs & Services** → **Enable APIs** → חפש **Google Sheets API** → **Enable**.

## משימה 3: הגדרת מזהה הגיליון (2 דקות)

1. צור קובץ `zamin24-bot/functions/.env` עם שורה אחת:
   ```
   SHEET_ID=XXXXXXXXX
   ```
2. פרוס: `firebase deploy --only functions`

## משימה 4: חיבור טופס האתר (5 דקות)

1. את הסוד `NETLIFY_WEBHOOK_SECRET` הגדרת כבר בהקמה הראשונה (`README-הקמה.md`, שלב 2) — הפריסה לא עוברת בלעדיו. אם עוד לא:
   ```bash
   firebase functions:secrets:set NETLIFY_WEBHOOK_SECRET   # מחרוזת אקראית ארוכה, למשל 32 תווים
   firebase deploy --only functions
   ```
2. העתק מהפלט של הפריסה את ה-URL של `netlifyLead`.
3. בנטליפיי: Site configuration → **Forms** → **Form notifications** → **Add notification** → **Outgoing webhook**:
   - Event: **New form submission**, טופס: `leads`
   - URL: ה-URL של `netlifyLead`
   - **JWS secret token**: אותה מחרוזת סודית מסעיף 1
4. שלח טופס בדיקה מהאתר ובדוק שהשורה הופיעה בגיליון ושהליד מופיע בדשבורד.

---

## הערה על אבטחה
- את המחרוזת הסודית שומרים רק בנטליפיי וב-Firebase secrets — לא בקוד ולא בגיטהאב.
- `netlifyLead` דוחה (401) כל בקשה שלא חתומה במחרוזת הזו.
- קובץ `.env` מכיל רק את מזהה הגיליון, שאינו סוד. בכל זאת אין צורך להעלות אותו לגיטהאב.

## תזכורת — מה עובד בינתיים
פניות מטופס האתר נאספות גם בנטליפיי → האתר → לשונית **Forms**, ונשלחות במייל אם הגדרת התראה.
