/**
 * All page copy and every published figure in one place.
 *
 * Every number below was measured, not estimated. The catalog counts come from
 * the production catalog on 26.7.2026 (last feed ingest 21.7.2026). The basket
 * and the ledger come from one real `optimize_basket` call near Dizengoff
 * Center that compared 68 stores.
 *
 * Three rules for editing this file:
 *   1. No claim without a number behind it, and no number we cannot re-measure.
 *   2. Say what the reader gets, not how we built it. Architecture words earn
 *      their place only in the connect section, where the reader came for them.
 *   3. No em dashes or en dashes. This copy is public. The Hebrew maqaf is fine.
 */

/** The measured basket that the hero and the ledger both draw from. */
const measurement = {
  measuredOn: "26.7.2026",
  ingestedOn: "21.7.2026",
  storesCompared: 68,
  origin: "דיזנגוף סנטר, תל אביב",
  radiusKm: 5,
} as const;

/** MCP clients we name. Ordered by how established their MCP support is. */
const clients = ["Claude", "Cursor", "ChatGPT", "Gemini"] as const;

export const he = {
  meta: {
    title: "Super MCP | מחירי הסופרמרקטים בישראל, בתוך העוזר שלכם",
    description:
      "שרת MCP שמחבר את Claude, Cursor, ChatGPT או Gemini למחירונים הרשמיים של 10 רשתות בישראל. רשימת קניות בעברית נכנסת, תוכנית קנייה מתומחרת יוצאת: איפה לקנות, כמה זה עולה, ומה שחסר מסומן כחסר.",
  },

  header: {
    brand: "Super MCP",
    nav: [
      { href: "#ledger", label: "ההשוואה" },
      { href: "#coverage", label: "הנתונים" },
      { href: "#connect", label: "חיבור" },
    ],
    cta: "בקשו מפתח",
  },

  hero: {
    eyebrow: "שרת MCP · מחירי סופרמרקט בישראל",
    titleLines: ["אותו מוצר.", "שני מחירים."],
    titleAccent: "אנחנו אומרים איזה.",
    subtitle:
      "מחברים את Super MCP לעוזר שאתם כבר עובדים איתו, כותבים רשימת קניות בעברית, ומקבלים תוכנית קנייה אמיתית: איפה לקנות, כמה זה עולה, ומה שאין במחירון מסומן כחסר במקום להיעלם.",
    primaryCta: "בקשו מפתח",
    secondaryCta: "איך מתחברים",
    secondaryHref: "#connect",
    clientsLabel: "עובד בכל לקוח שתומך ב־MCP",
    clients,

    /*
     * The hero artifact is one real exchange: what a person typed, the tool the
     * assistant reached for, and what came back. The tool call is shown on
     * purpose. It is the clearest way to say "this is an MCP server" without a
     * paragraph explaining what an MCP server is.
     */
    chat: {
      userLabel: "אתם",
      userMessage:
        "תכנן לי קנייה שבועית ליד דיזנגוף סנטר: חלב 3% פעמיים, לחם פרוס, ביצים L, קוטג׳ 5% פעמיים, קילו עגבניות, קילו מלפפונים, קילו בננות, ארבעה יוגורטים, אורז ושתי חבילות פסטה.",
      toolServer: "super-mcp",
      toolName: "optimize_basket",
      toolMeta: `10 פריטים · ${measurement.storesCompared} חנויות`,
      replyLead: "הכי משתלם לסל הזה:",
      planStore: "יוחננוף יד אליהו",
      planDistance: "2.14 ק״מ",
      planDistancePrecision: "מדויק לכתובת הסניף",
      planTotal: "₪99.96",
      planCoverage: "9 מתוך 10 תומחרו",
      planMissingLabel: "חסר במחירון",
      planMissing: "מלפפונים",
      footnote: `נמדד ${measurement.measuredOn}`,
    },
  },

  ledger: {
    id: "ledger",
    eyebrow: "אותו מוצר, שתי חנויות",
    title: "החנות שמתחת לבית גובה 13.7% יותר",
    body: "השווינו רק מוצרים שבשתי החנויות הם אותו פריט בדיוק: אותו שם, אותה אריזה, אותו יצרן. בכל אחד מהם חוץ מהחלב, הסניף הקרוב יותר יקר יותר.",
    columns: {
      item: "מוצר",
      /** Full store names head the legend; the short forms head the table on narrow screens. */
      near: "שופרסל דיל תל אביב",
      nearShort: "שופרסל",
      nearMeta: "0.08 ק״מ",
      far: "יוחננוף יד אליהו",
      farShort: "יוחננוף",
      farMeta: "2.14 ק״מ",
      delta: "פער",
    },
    rows: [
      { item: "חלב 3% מהדרין שקית 1 ליטר", qty: "×2", far: "12.82", near: "12.82", delta: "0.00" },
      { item: "לחם פרוס אחיד 750 גרם", qty: "×1", far: "8.20", near: "8.38", delta: "0.18" },
      { item: "קוטג׳ 5% שומן 250 גרם", qty: "×2", far: "13.40", near: "14.20", delta: "0.80" },
      { item: "יוגורט דנונה ביו לבן 0% 200 גרם", qty: "×4", far: "15.60", near: "18.80", delta: "3.20" },
      { item: "אורז בסמטי מובחר דאווט 1 ק״ג", qty: "×1", far: "13.90", near: "17.50", delta: "3.60" },
    ],
    totals: { label: "חמישה מוצרים זהים", far: "₪63.92", near: "₪72.70", delta: "₪8.78" },
    deltaHeadline: "13.7%",
    deltaCaption: "יותר על אותם חמישה מוצרים, בשביל לחסוך 2 ק״מ הליכה",
    footnote: `סל אחד שנמדד ב־${measurement.measuredOn} מול מחירונים שנטענו ב־${measurement.ingestedOn}. זו מדידה אחת, לא הבטחת חיסכון. מחירים זזים, ולכן כל מחיר אצלנו נושא את המועד שבו נראה לאחרונה.`,
  },

  integrity: {
    id: "integrity",
    title: "למה אפשר לסמוך על המספר הזה",
    lead: "השוואת מחירים נשברת בשלוש נקודות, ובכל אחת מהן קל להחליק ניחוש שנראה כמו תשובה. בחרנו להגיד מה אנחנו לא יודעים.",
    question: {
      label: "שאלה אמיתית שהסוכן החזיר",
      text: "יש קולה בבקבוק 1.5 ליטר וגם בשישיית פחיות ליד הכתובת. מה להשוות?",
      caption: "כשכמה מוצרים מתאימים, הסוכן שואל. הוא לא מחליף בשקט ומקווה שלא תשימו לב.",
    },
    points: [
      {
        title: "מוצר זהה, לא מוצר דומה",
        body: "אותו פריט מופיע בשם אחר בכל מחירון רשת. אנחנו מאחדים אותם לפריט אחד ומוודאים שהקטגוריה, הווריאנט וגודל האריזה תואמים. בשר טחון לא מושווה לקציצה צמחית, וקוטג׳ 5% לא מושווה ל־3%.",
      },
      {
        title: "חסר נשאר חסר",
        body: "פריט שלא מופיע במחירון הסניף מסומן כחסר, והתוכנית אומרת כמה שורות תומחרו מתוך כמה. חנות לא תיראה זולה רק מפני שהיא לא מוכרת את הפריט היקר.",
      },
      {
        title: "מרחק שנמדד, לא מרחק שנוח לנו",
        body: "לסניף עם כתובת מלאה יש מרחק מדויק. סניף שפורסם עם שם עיר בלבד מסומן כמשוער ונושא את טווח אי הוודאות שלו, במקום להתחזות לחנות שנמצאת ליד הבית.",
      },
    ],
  },

  coverage: {
    id: "coverage",
    eyebrow: "הנתונים",
    title: "כל המחירונים הרשמיים, במקום אחד",
    body: "רשתות השיווק בישראל מחויבות לפרסם מחירונים מלאים לפי חוק שקיפות המחירים. אנחנו טוענים אותם כל יום, מאחדים מוצרים וסניפים, ושומרים לכל מחיר את המועד שבו נראה לאחרונה. מחירון רשמי של הרשת, לא גרידה מאפליקציות.",
    stats: [
      { value: "10", label: "רשתות" },
      { value: "880", label: "סניפים" },
      { value: "156", label: "עיירות וערים" },
      { value: "122,575", label: "מוצרים" },
      { value: "6.7M", label: "מחירי סניף" },
      { value: "1.07M", label: "מבצעים" },
    ],
    statsFootnote: `נמדד ${measurement.measuredOn}. המחירונים נטענו לאחרונה ב־${measurement.ingestedOn}.`,
    chainsLabel: "הרשתות שנטענות היום",
    chains: [
      "שופרסל",
      "רמי לוי",
      "קרפור",
      "יוחננוף",
      "טיב טעם",
      "אושר עד",
      "פרשמרקט",
      "קשת טעמים",
      "סטופ מרקט",
      "סלח דבאח",
    ],
  },

  connect: {
    id: "connect",
    eyebrow: "חיבור",
    title: "שתי דקות, בלי SDK",
    body: "Super MCP הוא שרת MCP מרוחק. מדביקים בלוק אחד לקובץ ההגדרות של הלקוח, מחליפים את המפתח, והעוזר מקבל את הכלים. אין ספרייה להתקין ואין קוד לכתוב. אותה שכבה זמינה גם כ־REST.",
    clientsLabel: "נבדק מול",
    clients,
    clientsNote: "וכל לקוח אחר שמדבר MCP.",
    jsonLabel: "mcp.json",
    urlLabel: "כתובת השרת",
    copyJson: "העתקת JSON",
    copyUrl: "העתקת כתובת",
    secretWarning: "אל תדביקו כאן מפתח אמיתי. הבלוק מגיע עם מציין להחלפה.",
    toolsLabel: "שמונה כלים, מפתח אחד",
    toolsHint: "רשימה שלמה נכנסת בקריאה אחת ל־optimize_basket. שאר הכלים לשורות בודדות ולבירורים.",
    groups: [
      { title: "תכנון סל", tools: ["optimize_basket"] },
      { title: "מוצרים", tools: ["search_products", "resolve_products", "get_product", "suggest_substitutes"] },
      { title: "מחירים", tools: ["compare_prices"] },
      { title: "חנויות ומבצעים", tools: ["list_stores", "get_promotions"] },
    ],
    proofCaption: "שיחה אמיתית בקלוד, בלי עריכה: 14 פריטים תומחרו, וחמישה סומנו כחסרים במקום להיעלם מהסל.",
    proofImageSrc: "/example-chat-table.webp",
    proofImageAlt: "צילום מסך מקלוד: טבלת מחירים לכל פריט ורשימת פריטים שסומנו כחסרים",
    rateLimit: "מגבלת קצב הוגנת לכל מפתח, שמספיקה לשימוש אישי ולפיתוח.",
  },

  access: {
    id: "access",
    title: "חברו את זה לעוזר שלכם",
    body: "השאירו אימייל ונחזור אליכם עם מפתח והוראות חיבור, תוך יום עסקים.",
    form: {
      emailLabel: "אימייל",
      emailPlaceholder: "you@example.com",
      useCaseLabel: "איך תשתמשו בזה? (לא חובה)",
      useCasePlaceholder: "למשל: סוכן קניות לבית ב־Claude",
      submit: "בקשו מפתח",
      submitting: "שולחים...",
      successTitle: "הבקשה התקבלה",
      successBody: "נחזור אליכם עם מפתח והוראות חיבור תוך יום עסקים.",
      error: "משהו השתבש בשליחה. נסו שוב עוד רגע.",
      rateLimited: "נשלחו יותר מדי בקשות מכתובת זו. נסו שוב בעוד שעה.",
    },
    selfHost: "אירוח עצמי",
    selfHostHint: "הפרויקט פתוח. אפשר להריץ עותק משלכם עם הנתונים שלכם.",
    selfHostCta: "לתיעוד במאגר",
  },

  faq: {
    id: "faq",
    title: "שאלות נפוצות",
    items: [
      {
        q: "באילו עוזרים זה עובד?",
        a: "בכל לקוח שתומך בפרוטוקול MCP. בדקנו מול Claude, Cursor, ChatGPT ו־Gemini. אם ללקוח שלכם יש קובץ הגדרות של שרתי MCP, הבלוק שבסעיף החיבור מספיק. מי שמעדיף לא לעבור דרך MCP יכול לקרוא לאותם כלים ב־REST.",
      },
      {
        q: "כמה זה עולה?",
        a: "בשלב הזה הגישה חינמית למשתמשים מוקדמים. כשנוסיף תוכניות בתשלום, מי שכבר מחובר יקבל הודעה מראש ותקופת מעבר.",
      },
      {
        q: "עד כמה המחירים מעודכנים?",
        a: "המחירונים הרשמיים נטענים כל יום, וכל מחיר נושא חותמת עדכון. שימו לב שיש הבדל בין המועד שבו ראינו את הפריט לאחרונה לבין המועד שבו הרשת שינתה את המחיר. מחיר שלא השתנה שבועות הוא מחיר יציב, לא מחיר מיושן.",
      },
      {
        q: "מה עם מחירי מועדון וקופונים?",
        a: "שורה שמתומחרת במחיר מועדון או בקופון מסומנת ככזו, והתוכנית אומרת כמה שורות תלויות בתנאי. אפשר גם לבקש תמחור בלי מועדון ובלי קופונים, כדי לקבל מחיר שכל אחד משלם.",
      },
      {
        q: "מה קורה עם רשימת הקניות שלי?",
        a: "הרשימה משמשת רק לבניית התוכנית. אנחנו שומרים לוגים תפעוליים לשיפור הדיוק, לא מוכרים נתונים ולא בונים פרופיל פרסומי.",
      },
      {
        q: "אפשר להריץ לבד במקום להתחבר לשרת שלכם?",
        a: "כן. הפרויקט פתוח, וה־README במאגר מסביר איך מריצים עותק עצמאי עם הנתונים שלכם.",
      },
    ],
  },

  footer: {
    note: "Super MCP · מחירי הסופרמרקטים בישראל, דרך MCP",
    disclosure: "כל מחיר נושא את המועד שבו נראה לאחרונה במחירון הרשת. מה שלא תומחר מסומן כחסר.",
    links: [
      { href: "https://github.com/nitaiaharoni1/super-mcp/blob/main/DATA.md", label: "מקורות נתונים" },
      { href: "https://github.com/nitaiaharoni1/super-mcp/blob/main/SECURITY.md", label: "אבטחה" },
      { href: "https://github.com/nitaiaharoni1/super-mcp/blob/main/README.md", label: "אירוח עצמי" },
    ],
  },
} as const;

export type HeContent = typeof he;
