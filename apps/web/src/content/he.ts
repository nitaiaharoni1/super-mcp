/**
 * All page copy and every published figure in one place.
 *
 * Audience: a regular Israeli shopper who already talks to Claude or ChatGPT and
 * is tired of guessing which supermarket is cheaper. NOT a developer. That
 * decision drives the whole file.
 *
 * Product surface: online delivery (`optimize_delivery` / `/mcp`).
 * Physical drive-to-store is not mounted.
 *
 * Four rules for editing:
 *   1. Plain Hebrew. If a word only makes sense to someone who builds software
 *      ("שרת", "SDK", "endpoint", "לקוח" in the API sense), it does not belong
 *      above the developer disclosure in the connect section.
 *   2. No claim without a number behind it, and no number we cannot re-measure.
 *   3. Say what the reader gets, not how we built it.
 *   4. No em dashes or en dashes. This copy is public. The Hebrew maqaf is fine.
 *
 * Ledger figures were measured on the production catalog on 26.7.2026 (last feed
 * ingest 21.7.2026) from one real shelf-price comparison near Dizengoff Center.
 * The hero chat is a labeled delivery mock so the product surface matches what
 * clients actually connect to; it is not that measured run.
 */

/** Measured shelf-price comparison used by the ledger and coverage footnotes. */
const measurement = {
  measuredOn: "26.7.2026",
  ingestedOn: "21.7.2026",
  storesCompared: 68,
  origin: "דיזנגוף סנטר, תל אביב",
  radiusKm: 5,
} as const;

export const he = {
  meta: {
    title: "SuperMCP | קניות סופר עם משלוח דרך AI",
    description:
      "כותבים רשימת קניות בעברית ל־Claude או ל־ChatGPT ומגלים מאיזו רשת הכי משתלם להזמין לכתובת שלכם, כולל דמי משלוח, מחיר לכל פריט ומה חסר.",
  },

  header: {
    brand: "SuperMCP",
    nav: [
      { href: "#ledger", label: "ההשוואה" },
      { href: "#coverage", label: "המחירים" },
      { href: "#connect", label: "איך מחברים" },
    ],
    cta: "התחילו בחינם",
  },

  hero: {
    eyebrow: "השוואת מחירי סופר עם משלוח, בתוך כלי ה־AI שאתם כבר משתמשים בהם",
    titleLines: ["הסל הכי משתלם,"],
    titleAccent: "עם AI!",
    subtitle:
      "כותבים רשימת קניות בעברית ומגלים מאיזו רשת הכי משתלם להזמין, כולל משלוח, מחיר לכל פריט ומה חסר.",
    primaryCta: "התחילו בחינם",
    secondaryCta: "תראו מדידה אמיתית",
    secondaryHref: "#ledger",
    assistantsLabel: "עובד עם כלי ה־AI שאתם כבר משתמשים בהם",
    imageAlt: "סל קניות מלא במוצרי סופר, לצד מדבקות מחיר בירוק ובסגול",

    /*
     * Delivery-shaped mock of the live product surface. Totals here are labeled
     * illustrative so we do not pretend a shelf-price measurement is a
     * deliveredTotal. The ledger below keeps the measured catalogue comparison.
     */
    chat: {
      userMessage:
        "תכנן לי קנייה שבועית למשלוח למנדלסון 1, תל אביב: חלב 3% פעמיים, לחם פרוס, ביצים L, קוטג׳ 5% פעמיים, קילו עגבניות, קילו מלפפונים, קילו בננות, ארבעה יוגורטים, אורז ושתי חבילות פסטה.",
      toolLabel: "בודק אילו רשתות משלחות לכתובת, כולל דמי משלוח ומינימום הזמנה",
      toolName: "super-mcp · optimize_delivery",
      replyLead: "הכי משתלם כולל משלוח:",
      planStore: "שופרסל אונליין",
      planDistance: "דמי משלוח מאומתים",
      planDistancePrecision: "סל + משלוח",
      planTotal: "₪129.86",
      planCoverage: "נמצאו מחירים ל־9 מתוך 10 פריטים",
      planMissingLabel: "לא נמצא באתר",
      planMissing: "מלפפונים",
    },
  },

  /*
   * The ticker between the hero and the ledger. Short promises only, each one
   * already made and sourced elsewhere on the page. No numbers here: the
   * measured figures live in the ledger and coverage sections.
   */
  marquee: {
    items: [
      "הסל הכי משתלם",
      "עם AI",
      "משווים מחירים",
      "בוחרים את הרשת",
      "מה שחסר מסומן",
      "לכל מחיר מצוין מתי נראה לאחרונה",
      "המחירונים הרשמיים של הרשתות",
      "המחירונים מתעדכנים כל יום",
    ],
  },

  ledger: {
    id: "ledger",
    eyebrow: "אותו מוצר, שני מחירונים",
    title: "אותם חמישה מוצרים עולים 13.7% יותר במחירון אחד",
    body: "השווינו רק מוצרים שבשני המחירונים הם בדיוק אותו דבר: אותו שם, אותה אריזה, אותו יצרן. זו דוגמה ממחירוני מדף. בהזמנה עם משלוח, מחירי האתרים ודמי המשלוח מחושבים בנפרד.",
    columns: {
      item: "מוצר",
      /** Full store names head the legend; short forms head the table on narrow screens. */
      near: "שופרסל דיל תל אביב",
      nearShort: "שופרסל",
      nearMeta: "מחירון רשמי",
      far: "יוחננוף יד אליהו",
      farShort: "יוחננוף",
      farMeta: "מחירון רשמי",
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
    deltaCaption: "יותר על אותם חמישה מוצרים בדיוק",
    footnote: `סל אחד שנמדד ב־${measurement.measuredOn}, ברדיוס ${measurement.radiusKm} ק״מ סביב ${measurement.origin}, מול מחירונים שנטענו ב־${measurement.ingestedOn}. זו מדידה אחת ולא הבטחת חיסכון. מחירים זזים, ולכן כל מחיר אצלנו נושא את המועד שבו נראה לאחרונה.`,
  },

  integrity: {
    id: "integrity",
    title: "למה אפשר לסמוך על המספר הזה",
    lead: "בהשוואת מחירים קל להציג ניחוש כאילו הוא עובדה. לכן אנחנו מסמנים מה חסר, מה לא ודאי ומתי כל מחיר נראה לאחרונה.",
    question: {
      label: "שאלה אמיתית שה־AI שאל",
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
        body: "פריט שלא מופיע במחירון של החנות מסומן כחסר, והתשובה מציינת לכמה פריטים נמצא מחיר. חנות לא תיראה זולה רק מפני שהיא לא מוכרת את הפריט היקר.",
      },
      {
        title: "דמי משלוח רק כשיש לנו ביטחון",
        body: "כשהרשת מפרסמת תנאי משלוח ברורים, אנחנו מצטטים אותם עם מועד אימות. כשאין מספר מאומת, אנחנו לא ממציאים דמי משלוח ולא מציגים ניחוש כאילו זה המחיר שתשלמו.",
      },
    ],
  },

  visuals: {
    shelfAlt: "מדפי סופר צבעוניים עם מדבקות מחיר בירוק ובסגול ומחירים בשקלים",
    stickersAlt: "מדבקות מחיר בירוק ובסגול עם מחירים בשקלים על שפת המדף",
  },

  coverage: {
    id: "coverage",
    eyebrow: "המחירים",
    title: "מחירונים רשמיים מ־10 רשתות, במקום אחד",
    body: "רשתות השיווק בישראל חייבות לפרסם מחירונים לפי חוק שקיפות המחירים. אנחנו טוענים אותם כל יום, מזהים את אותו מוצר ברשתות שונות ושומרים לכל מחיר את המועד שבו ראינו אותו. המחירים מגיעים ישירות מהמחירונים הרשמיים, לא מהעתקה באפליקציה.",
    stats: [
      { value: "10", label: "רשתות" },
      { value: "880", label: "סניפים" },
      { value: "156", label: "יישובים" },
      { value: "122,575", label: "מוצרים" },
      { value: "6.7M", label: "מחירים" },
      { value: "1.07M", label: "מבצעים" },
    ],
    statsFootnote: `נתוני הקטלוג נכונים ל־${measurement.measuredOn}. המחירונים נטענו לאחרונה ב־${measurement.ingestedOn}.`,
    chainsLabel: "הרשתות שאנחנו מכסים",
    /*
     * Ten chains, two equal rows of five. Logos live in `public/chains/`
     * (official / Wikimedia marks). Names stay for alt text and screen readers.
     */
    chains: [
      { name: "שופרסל", slug: "shufersal" },
      { name: "רמי לוי", slug: "rami-levy" },
      { name: "קרפור", slug: "carrefour" },
      { name: "יוחננוף", slug: "yohananof" },
      { name: "טיב טעם", slug: "tiv-taam" },
      { name: "אושר עד", slug: "osher-ad" },
      { name: "פרשמרקט", slug: "freshmarket" },
      { name: "קשת טעמים", slug: "keshet-teamim" },
      { name: "סטופ מרקט", slug: "stop-market" },
      { name: "סלח דבאח", slug: "salah-dabah" },
    ],
  },

  connect: {
    id: "connect",
    eyebrow: "איך מחברים",
    title: "שלושה צעדים, פעם אחת",
    body: "מחברים פעם אחת, ומאז פשוט כותבים רשימת קניות ל־AI כמו שכותבים לחבר. לא צריך להתקין אפליקציה חדשה או ללמוד להשתמש במערכת חדשה.",
    steps: [
      {
        title: "משאירים אימייל",
        body: "אנחנו שולחים לכם קוד חיבור אישי והוראות, תוך יום עסקים.",
      },
      {
        title: "מדביקים פעם אחת",
        body: "ההוראות הן העתק־הדבק לתוך ההגדרות של Claude או ChatGPT. לוקח שתי דקות, ולא צריך לדעת לתכנת.",
      },
      {
        title: "כותבים רשימה",
        body: "״תכנן לי קנייה למשלוח לכתובת שלי״, בעברית רגילה. התשובה מראה מאיזו רשת הכי משתלם להזמין, את מחיר הסל כולל משלוח, את המחיר לכל פריט ומה חסר.",
      },
    ],
    assistantsLabel: "נבדק עם",
    assistantsNote: "אמור לעבוד גם עם כלי AI אחרים שמאפשרים חיבור לשירותים חיצוניים.",
    proofCaption: "שיחה אמיתית, בלי עריכה: נמצאו מחירים ל־14 פריטים, וחמישה סומנו כחסרים במקום להיעלם מהסל.",
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
      toolsLabel: "שישה כלים, מפתח אחד",
      toolsHint: "רשימה שלמה נכנסת בקריאה אחת ל־optimize_delivery. שאר הכלים לשורות בודדות ולבירורים.",
      groups: [
        { title: "משלוח", tools: ["optimize_delivery", "list_delivery_options", "get_delivery_terms"] },
        { title: "מוצרים", tools: ["search_products", "get_product"] },
        { title: "מבצעים", tools: ["get_promotions"] },
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
      reassurance: "חינם. בלי כרטיס אשראי, ואפשר להפסיק להשתמש בשירות מתי שתרצו.",
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
        a: "לא. החיבור הוא העתקה של בלוק אחד לתוך ההגדרות של כלי ה־AI, ואנחנו שולחים לכם בדיוק מה להעתיק ולאן. מהרגע הזה מדברים בעברית רגילה.",
      },
      {
        q: "עם אילו כלי AI זה עובד?",
        a: "בדקנו עם Claude, ChatGPT, Gemini ו־Cursor. זה אמור לעבוד גם עם כלי AI אחרים שמאפשרים חיבור לשירותים חיצוניים. אם אינכם בטוחים לגבי כלי ה־AI שלכם, כתבו לנו ונבדוק.",
      },
      {
        q: "כמה זה עולה?",
        a: "בשלב הזה חינם למשתמשים הראשונים. אם נוסיף בעתיד תוכניות בתשלום, מי שכבר מחובר יקבל הודעה מראש ותקופת מעבר.",
      },
      {
        q: "המחירים באמת מעודכנים?",
        a: "המחירונים הרשמיים מתעדכנים כל יום, ולכל מחיר מצוין מתי ראינו אותו לאחרונה. שימו לב שיש הבדל בין המועד שראינו את הפריט לבין המועד שבו הרשת שינתה את המחיר: מחיר שלא השתנה שבועות הוא מחיר יציב, לא מחיר מיושן.",
      },
      {
        q: "מה עם מחירי מועדון וקופונים?",
        a: "פריט שהמחיר שלו תלוי בכרטיס מועדון או בקופון מסומן, והתשובה אומרת כמה פריטים תלויים בתנאי כזה. אפשר גם לבקש השוואה בלי מועדון ובלי קופונים, כדי לראות את המחיר הרגיל.",
      },
      {
        q: "מה קורה עם רשימת הקניות שלי?",
        a: "היא משמשת רק כדי לבנות לכם את התשובה. אנחנו שומרים רשומות תפעוליות כדי לשפר את הדיוק, לא מוכרים נתונים ולא בונים עליכם פרופיל פרסומי.",
      },
    ],
  },

  footer: {
    note: "SuperMCP · השוואת מחירי סופר עם AI",
    disclosure: "לכל מחיר מצוין מתי נראה לאחרונה במחירון הרשת. פריט ללא מחיר מסומן כחסר.",
    links: [
      { href: "https://github.com/nitaiaharoni1/super-mcp/blob/main/DATA.md", label: "מאיפה המחירים" },
      { href: "https://github.com/nitaiaharoni1/super-mcp/blob/main/SECURITY.md", label: "אבטחה ופרטיות" },
      { href: "https://github.com/nitaiaharoni1/super-mcp/blob/main/README.md", label: "למפתחים" },
    ],
  },
} as const;

export type HeContent = typeof he;
