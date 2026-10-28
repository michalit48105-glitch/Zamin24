# זמין24 בוט — מדריך הקמה מא' עד ת'

הבוט רץ על **Meta Cloud API (רשמי, חינם) + Firebase Functions + Firestore** — אותו פרויקט Firebase שאתה כבר מכיר.

## מה הבוט עושה (גרסה 1)
- לקוח כותב לראשונה → מקבל ברכה + תפריט (1/2/3)
- **1** → איסוף פרטי ליד → נשמר ב-Firestore (`wa_leads`) → **אתה מקבל התראת וואטסאפ מיידית**
- **2** → מחירון מלא
- **3** → מעבר לנציג (גם נאסף כליד)
- זוכר את מצב השיחה של כל לקוח ב-`wa_conversations`

---

## שלב 1: הקמה במטא (~30 דקות, חד־פעמי)

1. היכנס ל-https://developers.facebook.com → **Create App** → סוג **Business**
2. בתוך האפליקציה: **Add Product → WhatsApp → Set up**
3. מטא נותנת לך אוטומטית **מספר טסט חינמי** — מעולה לפיתוח! שמור:
   - **Phone Number ID** (מזהה מספרי)
   - **Temporary Access Token** (לפיתוח; בהמשך מייצרים קבוע דרך System User)
4. במסך הטסט: הוסף את המספר האישי שלך כ-Recipient מורשה (עד 5 בטסט)

> **מספר אמיתי לפרודקשן:** מוסיפים מספר ייעודי שלא רשום בוואטסאפ (Add phone number), מאמתים ב-SMS. את זה עושים אחרי שהבוט עובד בטסט.

## שלב 2: פריסת הפונקציה

```bash
cd zamin24-bot
firebase login
firebase use lifebalancce-97409   # או פרויקט חדש נפרד — מומלץ נפרד לעסק
cd functions && npm install && cd ..

# הגדרת סודות (יתבקשו אינטראקטיבית):
firebase functions:secrets:set WA_TOKEN          # ה-Access Token ממטא
firebase functions:secrets:set VERIFY_TOKEN      # מחרוזת שאתה ממציא, למשל: zamin24-secret-2026
firebase functions:secrets:set PHONE_NUMBER_ID   # ה-Phone Number ID ממטא
firebase functions:secrets:set APP_SECRET        # App Secret: באפליקציה במטא → App settings → Basic → Show

firebase deploy --only functions,firestore:rules
```

בסוף הפריסה תקבל URL כמו:
`https://europe-west1-XXXX.cloudfunctions.net/whatsappWebhook`

## שלב 3: חיבור ה-Webhook במטא

1. באפליקציה במטא: **WhatsApp → Configuration → Webhook → Edit**
2. **Callback URL:** ה-URL מהפריסה
3. **Verify Token:** אותה מחרוזת שהגדרת ב-VERIFY_TOKEN
4. לחץ **Verify and Save** (הפונקציה עונה לאימות אוטומטית)
5. תחת **Webhook fields** → עשה Subscribe ל-**messages**

## שלב 4: בדיקה

1. עדכן ב-`index.js` את `ownerPhone` למספר שלך (פורמט: 9725XXXXXXXX)
2. פרוס שוב: `firebase deploy --only functions`
3. שלח "היי" מהנייד שלך למספר הטסט → אמור לחזור תפריט
4. עבור את כל הזרימה: 1 → שם ועסק → ודא שקיבלת התראת ליד למספר שלך
5. בדוק ב-Firebase Console → Firestore → `wa_leads` שהליד נשמר

## שלב 5: מעבר לפרודקשן (כשמוכנים)

- [ ] הוספת מספר אמיתי ייעודי + אימות
- [ ] יצירת **Permanent Token**: Business Settings → System Users → Add → הרשאת whatsapp_business_messaging → Generate Token
- [ ] עדכון הסוד: `firebase functions:secrets:set WA_TOKEN` מחדש + פריסה
- [ ] אימות העסק ב-Business Manager (נדרש להיקפים גדולים)

---

## עלויות — בפועל
| רכיב | עלות |
|---|---|
| Cloud API — מענה ללקוח תוך 24 שעות מהודעתו | **חינם, ללא הגבלה** |
| Firebase Functions + Firestore בהיקף הזה | חינם (Spark) / שקלים בודדים (Blaze) |
| הודעות יזומות (תזכורות/שיווק, מחוץ לחלון) | לפי תעריף מטא — רלוונטי רק בהמשך |

> הערה: Functions דורש תוכנית Blaze (כרטיס אשראי), אבל בהיקפים שלנו החיוב בפועל ~0.

## איך משכפלים ללקוח (המודל העסקי)
1. כל לקוח = מסמך קונפיגורציה (בהמשך נעביר את `BUSINESS_CONFIG` ל-Firestore: `businesses/{id}`)
2. מספר וואטסאפ ייעודי ללקוח באותה אפליקציית מטא (עד 2 מספרים בלי אימות עסק, יותר — עם)
3. אותו קוד, אותה פונקציה — רק config שונה. עלות שולית ללקוח: כמעט אפס

> **למה APP_SECRET:** מטא חותמת כל בקשה ל-Webhook. הבוט בודק את החתימה ודוחה (401) כל בקשה שלא הגיעה ממטא. בלי הסוד הפריסה תיכשל, ואם הסוד שגוי הבוט לא יענה לאף הודעה. אם הבוט שותק אחרי הפריסה, הדבר הראשון לבדוק הוא את הסוד הזה ואת לוג הפונקציה ("Webhook rejected").

## הגדרות לכל עסק בלי לגעת בקוד (גרסה 3)

הטקסטים של הבוט נטענים ממסמך ב-Firestore, ואם אין מסמך — מברירת המחדל שבקוד (`DEFAULT_CONFIG`).

1. Firebase Console → Firestore → אוסף `businesses` → מסמך שהמזהה שלו הוא ה-Phone Number ID של המספר.
2. מוסיפים רק את השדות שרוצים לשנות: `name`, `ownerPhone`, `greeting`, `menu`, `pricing`, `humanHandoff`, `leadAsk`, `leadDone`, `fallback`, `unsupported`, `backToBot`.
3. ב-`leadDone` כותבים `{name}` במקום שבו יופיע שם הלקוח.
4. שינוי נקלט תוך דקה, בלי פריסה.

## מה נוסף בגרסה 3
- אימות חתימה על כל בקשה ל-Webhook (APP_SECRET).
- הודעה שמגיעה פעמיים (מטא שולחת שוב כשלא קיבלה אישור בזמן) מטופלת פעם אחת בלבד. המזהים נשמרים ב-`wa_processed`.
- כפתורים ותפריטים אינטראקטיביים נקראים כטקסט. הודעה קולית, תמונה, מסמך וכו' מקבלות תשובה מנומסת ונרשמות בשיחה, ובמצב נציג הבוט שותק.
- `lastCustomerAt` בכל שיחה, והדשבורד מתריע כשעברו 24 שעות מההודעה האחרונה של הלקוח.
- לשונית **לידים** בדשבורד, עם עדכון סטטוס (חדש, נוצר קשר, נסגר, לא רלוונטי).

## גרסה 2 (אחרי הלקוח הראשון)
- כפתורים אינטראקטיביים במקום "כתבו 1" (Interactive Buttons של ה-API)
- חיבור Google Calendar — הצגת שעות פנויות וסגירת תור אמיתית
- תזכורת אוטומטית 24 שעות לפני תור (הודעת תבנית מאושרת)
- חיבור Claude API לשיחה חופשית

## ⚠️ משימות שרק אתה יכול לעשות
1. יצירת האפליקציה במטא (חשבון פייסבוק שלך)
2. `ownerPhone` בקוד — המספר שלך להתראות
3. הפריסה עצמה (firebase login מהמחשב שלך)
4. החלטה: פרויקט Firebase נפרד לזמין24 (ההמלצה שלי) או שימוש בקיים

---

# גרסה 2 — בוט + נציג אנושי (Human Takeover)

## מה נוסף
- **היסטוריית שיחה מלאה ב-Firestore** — כל הודעה (לקוח/בוט/נציג) נשמרת
- **מצב שיחה:** `bot` (הבוט עונה) / `human` (הבוט שותק, אתה עונה)
- **מעבר אוטומטי לנציג:** הלקוח מקיש 3, או שהבוט לא הבין פעמיים ברצף → אתה מקבל התראה בוואטסאפ
- **דשבורד** (`dashboard/index.html`): רשימת שיחות חיה, צפייה בשיחה בזמן אמת, שליחת תשובות כנציג, כפתור "קח שליטה / החזר לבוט"
- **שליחת הודעה מהדשבורד = השתלטות אוטומטית** על השיחה

## הקמת הדשבורד
1. Firebase Console → Authentication → Sign-in method → הפעל **Google**
2. Project settings → Your apps → הוסף Web app → העתק את `firebaseConfig` והדבק ב-`dashboard/index.html` (חפש `PASTE_HERE`)
3. עדכן את המייל שלך בשני מקומות:
   - `functions/index.js` → `ALLOWED_AGENTS`
   - `firestore.rules` → הפונקציה `isAgent`
4. פרוס את החוקים: `firebase deploy --only firestore:rules`
5. פרוס את הדשבורד לנטליפיי (אתר נפרד, למשל `zamin24-inbox.netlify.app`) — גרירה של תיקיית dashboard
6. Firebase Console → Authentication → Settings → **Authorized domains** → הוסף את הדומיין של הדשבורד

## זרימת עבודה יומית שלך
1. לקוח כותב → הבוט עונה ואוסף ליד
2. אם ביקש נציג / הבוט נתקע → קיבלת וואטסאפ "🙋 שיחה עברה לנציג"
3. פותח את הדשבורד בנייד → רואה את כל השיחה → עונה
4. סיימת? "החזר לבוט" — והבוט ממשיך לתפעל

## נקודת מכירה ללקוחות שלך
"הבוט עונה כשאת עסוקה — ואת נכנסת לשיחה בלחיצה אחת כשאת פנויה. הלקוחה שלך לא מרגישה את ההבדל, הכל באותה שיחת וואטסאפ."
