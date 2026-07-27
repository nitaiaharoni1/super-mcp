/**
 * All page copy and every published figure in one place.
 *
 * Audience: a regular Israeli shopper who already talks to Claude or ChatGPT and
 * is tired of guessing which supermarket is cheaper. NOT a developer. That
 * decision drives the whole file.
 *
 * Four rules for editing:
 *   1. Plain Hebrew. If a word only makes sense to someone who builds software
 *      ("שרת", "SDK", "endpoint", "לקוח" in the API sense), it does not belong
 *      above the developer disclosure in the connect section.
 *   2. No claim without a number behind it, and no number we cannot re-measure.
 *   3. Say what the reader gets, not how we built it.
 *   4. No em dashes or en dashes. This copy is public. The Hebrew maqaf is fine.
 *
 * Every number below was measured on the production catalog on 26.7.2026 (last
 * feed ingest 21.7.2026). The basket and the ledger come from one real
 * `optimize_basket` call near Dizengoff Center that compared 68 stores.
 */

/** The measured basket that the hero and the ledger both draw from. */
const measurement = {
  measuredOn: "26.7.2026",
  ingestedOn: "21.7.2026",
  storesCompared: 68,
  origin: "דיזנגוף סנטר, תל אביב",
  radiusKm: 5,
} as const;

/** The assistants this works inside, named the way a shopper would say them. */
const assistants = ["Claude", "ChatGPT", "Gemini", "Cursor"] as const;

export const he = {
  meta: {
    title: "SuperMCP | אותם מוצרים, מחיר אחר בכל חנות",
    description:
      "כותבים רשימת קניות בעברית לקלוד או ל־ChatGPT, ומקבלים תשובה ברורה: באיזו חנות לידכם הקנייה הזאת הכי זולה, כמה כל פריט עולה, ומה שאין בחנות מסומן. המחירים מגיעים מהמחירונים הרשמיים של 10 רשתות בישראל.",
  },

  header: {
    brand: "SuperMCP",
    nav: [
      { href: "#ledger", label: "ההשוואה" },
      { href: "#coverage", label: "המחירים" },
      { href: "#connect", label: "איך מחברים" },
    ],
    cta: "התחילו עכשיו",
  },

  hero: {
    eyebrow: "השוואת מחירי סופר, בתוך העוזר שאתם כבר מדברים איתו",
    titleLines: ["אותו מוצר.", "שני מחירים."],
    titleAccent: "אנחנו אומרים איזה.",
    subtitle:
      "כותבים רשימת קניות בעברית ומקבלים תשובה ברורה: באיזו חנות לידכם הסל הזה הכי זול, כמה כל פריט עולה, ומה שאין בחנות מסומן במקום להיעלם.",
    primaryCta: "התחילו עכשיו",
    /*
     * The button says "now" and the truth is "within a business day", so the
     * gap gets closed here rather than left for the reader to discover in the
     * form. It also answers the first question anyone asks: what does it cost.
     */
    ctaReassurance: "חינם. שולחים לכם הוראות חיבור תוך יום עסקים.",
    secondaryCta: "תראו השוואה אמיתית",
    secondaryHref: "#ledger",
    assistantsLabel: "עובד בתוך העוזרים שאתם כבר משתמשים בהם",
    assistants,

    /*
     * The hero artifact is one real exchange: what a person typed, what the
     * assistant went and checked, and what came back. The plain sentence leads;
     * the tool name sits underneath it in small type, because a shopper does not
     * need to read it but seeing a real tool run is what makes the page credible.
     */
    chat: {
      userMessage:
        "תכנן לי קנייה שבועית ליד דיזנגוף סנטר: חלב 3% פעמיים, לחם פרוס, ביצים L, קוטג׳ 5% פעמיים, קילו עגבניות, קילו מלפפונים, קילו בננות, ארבעה יוגורטים, אורז ושתי חבילות פסטה.",
      toolLabel: `בודק את 10 הפריטים ב־${measurement.storesCompared} חנויות ליד הכתובת`,
      toolName: "super-mcp · optimize_basket",
      replyLead: "הכי זול לסל הזה:",
      planStore: "יוחננוף יד אליהו",
      planDistance: "2.14 ק״מ",
      planDistancePrecision: "לפי כתובת הסניף",
      planTotal: "₪99.96",
      planCoverage: "9 מתוך 10 פריטים תומחרו",
      planMissingLabel: "לא נמצא בחנות",
      planMissing: "מלפפונים",
      footnote: `נמדד ${measurement.measuredOn}`,
    },
  },

  ledger: {
    id: "ledger",
    eyebrow: "אותו מוצר, שתי חנויות",
    title: "החנות שמתחת לבית גובה 13.7% יותר",
    body: "השווינו רק מוצרים שבשתי החנויות הם בדיוק אותו דבר: אותו שם, אותה אריזה, אותו יצרן. בכל אחד מהם חוץ מהחלב, החנות הקרובה יותר יקרה יותר.",
    columns: {
      item: "מוצר",
      /** Full store names head the legend; short forms head the table on narrow screens. */
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
    footnote: `סל אחד שנמדד ב־${measurement.measuredOn} מול מחירונים שנטענו ב־${measurement.ingestedOn}. זו מדידה אחת ולא הבטחת חיסכון. מחירים זזים, ולכן כל מחיר אצלנו נושא את המועד שבו נראה לאחרונה.`,
  },

  integrity: {
    id: "integrity",
    title: "למה אפשר לסמוך על המספר הזה",
    lead: "השוואת מחירים נשברת בשלוש נקודות, ובכל אחת מהן קל להחליק ניחוש שנראה כמו תשובה. בחרנו להגיד מה אנחנו לא יודעים.",
    question: {
      label: "שאלה אמיתית שחזרה מהעוזר",
      text: "יש קולה בבקבוק 1.5 ליטר וגם בשישיית פחיות ליד הכתובת. מה להשוות?",
      caption: "כשכמה מוצרים מתאימים לרשימה, שואלים אתכם. לא מחליפים בשקט ומקווים שלא תשימו לב.",
    },
    points: [
      {
        title: "אותו מוצר, לא מוצר דומה",
        body: "אותו פריט מופיע בשם אחר בכל רשת. אנחנו מחברים אותם לפריט אחד ובודקים שזה אותו סוג מוצר, אותו טעם ואותו גודל אריזה. בשר טחון לא מושווה לקציצה צמחית, וקוטג׳ 5% לא מושווה ל־3%.",
      },
      {
        title: "מה שחסר נשאר חסר",
        body: "פריט שלא מופיע במחירון של החנות מסומן כחסר, והתשובה אומרת כמה פריטים תומחרו מתוך כמה. חנות לא תיראה זולה רק מפני שהיא לא מוכרת את הפריט היקר.",
      },
      {
        title: "מרחק אמיתי, לא מרחק שנוח לנו",
        body: "לחנות עם כתובת מלאה יש מרחק מדויק. חנות שהרשת פרסמה עם שם עיר בלבד מקבלת מרחק משוער ואנחנו אומרים את זה, במקום להציג אותה כאילו היא ליד הבית.",
      },
    ],
  },

  coverage: {
    id: "coverage",
    eyebrow: "המחירים",
    title: "כל המחירונים הרשמיים, במקום אחד",
    body: "רשתות השיווק בישראל חייבות לפרסם את המחירונים המלאים שלהן לפי חוק שקיפות המחירים. אנחנו טוענים אותם כל יום, מחברים בין אותם מוצרים בין הרשתות, ושומרים לכל מחיר את המועד שבו ראינו אותו. זה המחירון הרשמי של הרשת, לא מה שמישהו העתיק מאפליקציה.",
    stats: [
      { value: "10", label: "רשתות" },
      { value: "880", label: "סניפים" },
      { value: "156", label: "עיירות וערים" },
      { value: "122,575", label: "מוצרים" },
      { value: "6.7M", label: "מחירים" },
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
    eyebrow: "איך מחברים",
    title: "שלושה צעדים, פעם אחת",
    body: "מחברים פעם אחת, ומאז פשוט כותבים רשימת קניות לעוזר כמו שכותבים לחבר. אין מה להתקין ואין באיזו אפליקציה חדשה להתרגל.",
    steps: [
      {
        title: "משאירים אימייל",
        body: "אנחנו שולחים לכם קוד חיבור אישי והוראות, תוך יום עסקים.",
      },
      {
        title: "מדביקים פעם אחת",
        body: "ההוראות הן העתק־הדבק לתוך ההגדרות של קלוד או ChatGPT. לוקח שתי דקות, ולא צריך לדעת לתכנת.",
      },
      {
        title: "כותבים רשימה",
        body: "״תכנן לי קנייה ליד הבית״, בעברית רגילה. התשובה חוזרת עם חנות, מחיר לכל פריט, ומה שחסר.",
      },
    ],
    assistantsLabel: "נבדק בתוך",
    assistants,
    assistantsNote: "ובכל עוזר אחר שיודע להתחבר לכלים חיצוניים.",
    proofCaption: "שיחה אמיתית, בלי עריכה: 14 פריטים תומחרו, וחמישה סומנו כחסרים במקום להיעלם מהסל.",
    proofImageSrc: "/example-chat-table.webp",
    proofImageAlt: "צילום מסך של שיחה: טבלת מחירים לכל פריט ורשימת פריטים שסומנו כחסרים",

    /*
     * Everything technical lives behind one disclosure. A shopper never opens it;
     * someone wiring this into their own tooling finds it immediately.
     */
    dev: {
      summary: "למפתחים: MCP, REST והרצה עצמאית",
      body: "SuperMCP הוא שרת MCP מרוחק. מדביקים את הבלוק לקובץ ההגדרות, מחליפים את המפתח, והכלים זמינים. אותה שכבה חשופה גם כ־REST, והפרויקט פתוח.",
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
      rateLimit: "מגבלת קצב הוגנת לכל מפתח, שמספיקה לשימוש אישי ולפיתוח.",
      selfHost: "אירוח עצמי",
      selfHostHint: "אפשר להריץ עותק משלכם עם הנתונים שלכם.",
      selfHostCta: "להוראות ההרצה",
    },
  },

  access: {
    id: "access",
    title: "רוצים לנסות על הקנייה הבאה?",
    body: "משאירים אימייל, ואנחנו חוזרים אליכם עם קוד חיבור והוראות פשוטות, תוך יום עסקים.",
    form: {
      emailLabel: "אימייל",
      emailPlaceholder: "you@example.com",
      useCaseLabel: "איפה אתם קונים בדרך כלל? (לא חובה)",
      useCasePlaceholder: "למשל: שופרסל בהרצליה, קנייה שבועית למשפחה",
      submit: "שלחו לי הוראות",
      submitting: "שולחים...",
      reassurance: "חינם. בלי כרטיס אשראי, ואפשר להפסיק מתי שתרצו.",
      successTitle: "קיבלנו, תודה",
      successBody: "נחזור אליכם במייל עם קוד חיבור והוראות, תוך יום עסקים.",
      error: "משהו השתבש בשליחה. נסו שוב עוד רגע.",
      rateLimited: "נשלחו יותר מדי בקשות מכתובת זו. נסו שוב בעוד שעה.",
    },
  },

  faq: {
    id: "faq",
    title: "שאלות נפוצות",
    items: [
      {
        q: "צריך לדעת לתכנת?",
        a: "לא. החיבור הוא העתקה של בלוק אחד לתוך ההגדרות של העוזר, ואנחנו שולחים לכם בדיוק מה להעתיק ולאן. מהרגע הזה מדברים בעברית רגילה.",
      },
      {
        q: "עם אילו עוזרים זה עובד?",
        a: "בדקנו בתוך Claude, ChatGPT, Gemini ו־Cursor. באופן כללי זה עובד בכל עוזר שיודע להתחבר לכלים חיצוניים. אם לעוזר שלכם יש מסך של חיבורים או כלים, זה יעבוד.",
      },
      {
        q: "כמה זה עולה?",
        a: "בשלב הזה חינם למשתמשים הראשונים. אם נוסיף בעתיד תוכניות בתשלום, מי שכבר מחובר יקבל הודעה מראש ותקופת מעבר.",
      },
      {
        q: "המחירים באמת מעודכנים?",
        a: "המחירונים הרשמיים נטענים כל יום, וכל מחיר נושא את המועד שבו ראינו אותו. שימו לב שיש הבדל בין המועד שראינו את הפריט לבין המועד שבו הרשת שינתה את המחיר: מחיר שלא השתנה שבועות הוא מחיר יציב, לא מחיר מיושן.",
      },
      {
        q: "מה עם מחירי מועדון וקופונים?",
        a: "פריט שהמחיר שלו תלוי בכרטיס מועדון או בקופון מסומן, והתשובה אומרת כמה פריטים תלויים בתנאי כזה. אפשר גם לבקש מחיר בלי מועדון ובלי קופונים, כדי לראות מה כל אחד משלם בקופה.",
      },
      {
        q: "מה קורה עם רשימת הקניות שלי?",
        a: "היא משמשת רק כדי לבנות לכם את התשובה. אנחנו שומרים רשומות תפעוליות כדי לשפר את הדיוק, לא מוכרים נתונים ולא בונים עליכם פרופיל פרסומי.",
      },
    ],
  },

  footer: {
    note: "SuperMCP · השוואת מחירי סופר לעוזרי AI",
    disclosure: "כל מחיר נושא את המועד שבו נראה לאחרונה במחירון הרשת. מה שלא תומחר מסומן כחסר.",
    links: [
      { href: "https://github.com/nitaiaharoni1/super-mcp/blob/main/DATA.md", label: "מאיפה המחירים" },
      { href: "https://github.com/nitaiaharoni1/super-mcp/blob/main/SECURITY.md", label: "אבטחה ופרטיות" },
      { href: "https://github.com/nitaiaharoni1/super-mcp/blob/main/README.md", label: "למפתחים" },
    ],
  },
} as const;

export type HeContent = typeof he;
