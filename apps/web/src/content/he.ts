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
    /** Browser tab + og:title. Matches the thumbnail headline. */
    title: "SuperMCP | הסל הכי משתלם, עם AI!",
    /** Short line under the title in WhatsApp/Slack/X. Matches the thumbnail subtext. */
    subtitle: "השוואת מחירי סופר עם בינה מלאכותית",
    /** Longer SEO / link-preview body when a crawler wants more than the subtitle. */
    description:
      "כותבים רשימת קניות בעברית ל־Claude או ל־ChatGPT ומגלים מאיזו רשת הכי משתלם להזמין לכתובת שלכם, כולל דמי משלוח, מחיר לכל פריט ומה חסר.",
  },

  header: {
    brand: "SuperMCP",
    /* Rooted at "/" so the header still works from /privacy. On the home page the
       browser treats "/#ledger" as a same-document fragment, so nothing reloads. */
    nav: [
      { href: "/#ledger", label: "ההשוואה" },
      { href: "/#coverage", label: "המחירים" },
      { href: "/#connect", label: "איך מחברים" },
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
        title: "מחברים בלחיצה",
        body: "בוחרים למטה את כלי ה־AI שלכם ולוחצים. ב־Cursor וב־VS Code זו לחיצה אחת, ובשאר מדביקים שורה אחת שאנחנו מעתיקים לכם. בלי הרשמה, בלי כרטיס אשראי ובלי קוד חיבור.",
      },
      {
        title: "כותבים רשימה",
        body: "״תכנן לי קנייה למשלוח לכתובת שלי״, בעברית רגילה. לוקח פחות מדקה, ולא צריך לדעת לתכנת.",
      },
      {
        title: "מזמינים",
        body: "התשובה מראה מאיזו רשת הכי משתלם להזמין, את מחיר הסל כולל משלוח, את המחיר לכל פריט ומה חסר. את ההזמנה עצמה משלימים באתר של הרשת.",
      },
    ],
    /*
     * The install grid. `keyNote` only appears when NEXT_PUBLIC_MCP_REQUIRES_KEY=1,
     * so the page never tells a shopper to paste a key into a server that does not
     * ask for one. Assistant names stay in Latin script: that is how they appear
     * in the menus the reader is about to open.
     */
    install: {
      title: "בחרו את כלי ה־AI שלכם",
      body: "לוחצים על הכלי שאתם משתמשים בו, וזהו. ב־Cursor וב־VS Code ההתקנה נפתחת אצלכם בלחיצה אחת, ובשאר מעתיקים שורה אחת ומדביקים.",
      keyNote: "אחרי החיבור מחליפים את המציין במפתח שקיבלתם במייל.",
      otherTools: "עובד גם עם כלי AI אחרים שמאפשרים חיבור לשירותים חיצוניים. אם שלכם לא ברשימה, כתבו לנו.",
      docsLabel: "מדריך",
      settingsLabel: "פתיחת ההגדרות",
      stepsLabel: "צעד אחר צעד",
      copiedLabel: "הועתק",
      copyFailedLabel: "ההעתקה נכשלה",
      targets: {
        cursor: { action: "התקנה בלחיצה", hint: "נפתח אצלכם ב־Cursor ומוסיף את השרת." },
        vscode: { action: "התקנה בלחיצה", hint: "נפתח אצלכם ב־VS Code ומוסיף את השרת." },
        "claude-code": { action: "העתקת הפקודה", hint: "מדביקים בטרמינל ומריצים." },
        claude: {
          action: "העתקת הכתובת",
          hint: "בהגדרות של Claude נכנסים ל־Connectors, לוחצים Add custom connector ומדביקים את הכתובת.",
        },
        /*
         * The only card that needs more than a sentence. ChatGPT hides custom MCP
         * servers behind a toggle in a different settings pane from the one you add
         * them in, so a reader who is told only "add a connector" finds no button at
         * all. Menu names are the ones on screen in August 2026: the pane was renamed
         * Apps and then Plugins, and the developer toggle lives under Security and
         * login, not with the plugins.
         */
        chatgpt: {
          action: "העתקת הכתובת",
          hint: "צריך קודם להפעיל Developer mode בהגדרות של ChatGPT, ורק אז אפשר להוסיף את הכתובת.",
          steps: [
            "בהגדרות ChatGPT נכנסים ל־Security and login ומפעילים את Developer mode.",
            "עוברים ל־Plugins ולוחצים על הפלוס כדי ליצור אפליקציה חדשה.",
            "מדביקים את כתובת השרת, בוחרים Streaming HTTP, ובאימות בוחרים No authentication.",
            "בשיחה לוחצים על הפלוס, נכנסים ל־Developer mode ומסמנים את SuperMCP.",
          ],
          note: "עובד רק בדפדפן, לא באפליקציה בטלפון, ורק בחשבון בתשלום (Plus, Pro, Business, Enterprise או Edu). בחשבון עסקי מנהל צריך להפעיל את Developer mode. ChatGPT מסמן את המצב הזה כמסוכן כי הוא פותח גם כלים שכותבים ומוחקים; ששת הכלים שלנו הם קריאה בלבד.",
        },
        "gemini-cli": { action: "העתקת הפקודה", hint: "מדביקים בטרמינל ומריצים." },
      },
    },

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
      /** Shown instead of `body` when the server takes no credential. */
      bodyKeyless: "SuperMCP הוא שרת MCP מרוחק. מדביקים את הבלוק לקובץ ההגדרות והכלים זמינים. אותה שכבה חשופה גם כ־REST, והפרויקט פתוח.",
      jsonLabel: "mcp.json",
      urlLabel: "כתובת השרת",
      copyJson: "העתקת JSON",
      copyUrl: "העתקת כתובת",
      secretWarning: "אל תדביקו כאן מפתח אמיתי. הבלוק מגיע עם מציין להחלפה.",
      toolsLabel: "שישה כלים, מפתח אחד",
      /** Shown instead of `toolsLabel` when the server takes no credential. */
      toolsLabelKeyless: "שישה כלים, בלי מפתח",
      toolsHint: "רשימה שלמה נכנסת בקריאה אחת ל־optimize_delivery. שאר הכלים לשורות בודדות ולבירורים.",
      groups: [
        { title: "משלוח", tools: ["optimize_delivery", "list_delivery_options", "get_delivery_terms"] },
        { title: "מוצרים", tools: ["search_products", "get_product"] },
        { title: "מבצעים", tools: ["get_promotions"] },
      ],
      rateLimit: "מגבלת קצב הוגנת לכל מפתח, שמספיקה לשימוש אישי ולפיתוח.",
      /** Shown instead of `rateLimit` when the server takes no credential. */
      rateLimitKeyless: "מגבלת קצב הוגנת לכל משתמש, שמספיקה לשימוש אישי ולפיתוח.",
      selfHost: "אירוח עצמי",
      selfHostHint: "אפשר להריץ עותק משלכם עם הנתונים שלכם.",
      selfHostCta: "להוראות ההרצה",
    },
  },

  /*
   * Not a gate. The server takes no credential, so there is nothing to request
   * and nothing to wait for: this block exists only to hear from shoppers and to
   * tell them when a chain or a capability is added. Every string here has to
   * survive the fact that the repo has no mailer at all, so it must not promise
   * a reply, a code, or a deadline.
   */
  access: {
    id: "access",
    title: "רוצים לשמוע מה מתחדש?",
    body: "השירות כבר פתוח וחינם, אין על מה להירשם ואין למה לחכות. אם בא לכם לדעת כשנוסיף רשתות או יכולות, השאירו אימייל.",
    form: {
      emailLabel: "אימייל",
      emailPlaceholder: "you@example.com",
      useCaseLabel: "איפה אתם קונים בדרך כלל? (לא חובה)",
      useCasePlaceholder: "למשל: שופרסל בהרצליה, קנייה שבועית למשפחה",
      submit: "עדכנו אותי",
      submitting: "שולחים...",
      reassurance: "רק עדכונים על השירות. לא נמסור את הכתובת לאף אחד.",
      successTitle: "קיבלנו, תודה",
      successBody: "נעדכן אתכם כשיהיה משהו חדש. בינתיים אפשר להתחבר ולהתחיל, זה כבר עובד.",
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
        a: "לא. הכפתורים כאן באתר עושים את החיבור בשבילכם: ב־Cursor וב־VS Code זו לחיצה אחת, ובשאר מעתיקים בלוק אחד לתוך ההגדרות של כלי ה־AI. מהרגע הזה מדברים בעברית רגילה.",
      },
      {
        q: "עם אילו כלי AI זה עובד?",
        a: "בדקנו עם Claude, ChatGPT, Gemini ו־Cursor. זה אמור לעבוד גם עם כלי AI אחרים שמאפשרים חיבור לשירותים חיצוניים. אם אינכם בטוחים לגבי כלי ה־AI שלכם, כתבו לנו ונבדוק.",
      },
      {
        q: "כמה זה עולה?",
        a: "חינם, בלי הרשמה ובלי כרטיס אשראי. אם נוסיף בעתיד תוכניות בתשלום, מי שכבר מחובר יקבל הודעה מראש ותקופת מעבר.",
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

  /*
   * Hosted privacy policy, required by the Anthropic connector submission and by
   * anyone who wants to know what happens to their address.
   *
   * Every sentence here is checkable against the code, and that is the point:
   *   - geocodeCache.ts HMACs the address and stores only the digest
   *   - analytics/metadata.ts is metadata-only by construction ("Never include
   *     free-text queries, product names, GTINs, cities, or coordinates")
   *   - usage_event holds api_key_id, route, status_code, latency_ms and nothing else
   *   - continuation.ts signs the basket back to the caller instead of storing it
   *   - semantic_query_embedding DOES persist normalized_query, the search phrase
   *     itself, which is why "מילון החיפוש" exists and why the section above says
   *     the list is not kept AS A LIST rather than claiming nothing is kept
   * If any of those change, this page is wrong and has to change with them.
   *
   * The two 90-day claims describe a job, not an intention: the nightly ingest runs
   * purgeOldUsageEvents and purgeIdleQueryEmbeddings, gated on
   * SUPER_MCP_USAGE_RETENTION_DAYS / SUPER_MCP_QUERY_CACHE_RETENTION_DAYS. Unset those
   * env vars, or re-pin the ingest job to an image without the sweeps, and these two
   * sentences become false. See docs/DEPLOY.md.
   *
   * updatedOn is the date the text was last true, not the last time the file moved.
   */
  privacy: {
    slug: "/privacy",
    title: "פרטיות",
    updatedLabel: "עודכן",
    updatedOn: "8.8.2026",
    intro:
      "SuperMCP עונה על שאלה אחת: מאיזו רשת הכי משתלם להזמין את הרשימה שלכם לכתובת שלכם. כדי לענות עליה צריך את הרשימה ואת הכתובת. הדף הזה מסביר בדיוק מה קורה איתן.",
    sections: [
      {
        heading: "מה אתם שולחים לנו",
        body: "רשימת הקניות והכתובת או העיר למשלוח. זה מגיע אלינו מתוך כלי ה־AI שאתם מדברים איתו, בכל פעם שאתם מבקשים השוואה.",
      },
      {
        heading: "מה אנחנו עושים עם זה",
        body: "מתרגמים את הכתובת לנקודה על המפה, מתאימים כל שורה ברשימה למוצרים אמיתיים, ומחשבים כמה יעלה הסל בכל רשת כולל משלוח. התשובה חוזרת אליכם ובזה נגמר השימוש.",
      },
      {
        heading: "מה לא נשמר אצלנו",
        body: "הרשימה שלכם, כרשימה, לא נשמרת ולא נקשרת אליכם. הכתובת לא נשמרת. כשאנחנו זוכרים תוצאה של כתובת כדי לא לחשב אותה שוב, נשמרת רק טביעת אצבע מוצפנת חד־כיוונית שלה, שאי אפשר להפוך בחזרה לכתובת. כשצריך שאלת הבהרה באמצע, מצב הסל חוזר אליכם חתום ולא יושב אצלנו.",
      },
      {
        heading: "מה כן נשמר",
        body: "שורת שימוש טכנית לכל בקשה: איזה מפתח, איזה נתיב, קוד תשובה וכמה זמן זה לקח. אין בה שום פריט, כתובת או תוכן. היא קיימת כדי לזהות תקלות ועומסים, ונמחקת אחרי 90 יום.",
      },
      {
        heading: "מילון החיפוש",
        body: "כשמחפשים ביטוי שלא נראה כאן קודם, הביטוי עצמו נשמר פעם אחת במילון משותף יחד עם הייצוג המספרי שלו, כדי שהחיפוש הבא על אותו ביטוי יהיה מיידי. במילון הזה אין כתובת, אין מי חיפש ואין קשר בין ביטוי אחד לשני, ולכן אי אפשר להרכיב ממנו בחזרה את הרשימה של אף אחד. כל ערך נמחק אחרי 90 יום, גם אם מחפשים אותו הרבה.",
      },
      {
        heading: "מי עוד רואה משהו",
        body: "שירות המפות OpenStreetMap Nominatim מקבל את הכתובת עצמה כדי להפוך אותה לנקודה, כי בלי זה אי אפשר לדעת מי מחלק אליכם. שירות הניתוח PostHog באירופה מקבל מדדים טכניים בלבד: איזה כלי הופעל, מאיזה סוג עוזר AI, כמה פריטים היו, כמה זמן לקח, האם הייתה כתובת והאם זה הצליח. אף פעם לא את הפריטים עצמם ולא את הכתובת. כדי לספור מבקרים חוזרים בלי לדעת מי אתם, נלווה לזה מזהה מעורפל שנגזר חד־כיוונית מפרטי החיבור, ואינו שם, אימייל או כתובת. אין מכירה של מידע ואין פרופיל פרסומי.",
      },
      {
        heading: "אם השארתם אימייל",
        body: "טופס בקשת הגישה שומר את כתובת האימייל ואת מה שכתבתם על השימוש, ושולח לנו התראה דרך שירות הדואר Resend, שרואה את הכתובת בדרך. זה נשמר עד שתבקשו למחוק.",
      },
      {
        heading: "מחיקה ושאלות",
        body: "כותבים לנו ומוחקים. אותה כתובת גם לכל שאלה על הדף הזה.",
        contactEmail: "nitaiaharoni1@gmail.com",
      },
      {
        heading: "מחירים",
        body: "המחירים מגיעים ממחירוני השקיפות שהרשתות מחויבות לפרסם. הם לא מידע עליכם, והם מוצגים תמיד עם התאריך שבו נראו לאחרונה.",
      },
    ],
    backLabel: "חזרה לדף הבית",
  },

  footer: {
    note: "SuperMCP · השוואת מחירי סופר עם AI",
    disclosure: "לכל מחיר מצוין מתי נראה לאחרונה במחירון הרשת. פריט ללא מחיר מסומן כחסר.",
    links: [
      { href: "https://github.com/nitaiaharoni1/super-mcp/blob/main/DATA.md", label: "מאיפה המחירים" },
      { href: "/privacy", label: "פרטיות" },
      { href: "https://github.com/nitaiaharoni1/super-mcp/blob/main/SECURITY.md", label: "אבטחה" },
      { href: "https://github.com/nitaiaharoni1/super-mcp/blob/main/README.md", label: "למפתחים" },
    ],
  },
} as const;

export type HeContent = typeof he;
