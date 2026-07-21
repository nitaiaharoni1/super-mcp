export const he = {
  meta: {
    title: "Super MCP | מרשימת קניות לתוכנית קנייה חכמה",
    description:
      "חברו סוכן AI לסופרמרקטים בישראל: שולחים רשימת קניות בעברית ומקבלים השוואת מחירים אמיתית לפי חנויות קרובות, עם שאלה לפני כל החלפה.",
  },
  header: {
    brand: "Super MCP",
    nav: [
      { href: "#example", label: "דוגמה" },
      { href: "#how", label: "איך זה עובד" },
      { href: "#access", label: "גישה" },
    ],
    cta: "בקשו גישה",
  },
  hero: {
    eyebrow: "לסוכני AI · סופרמרקטים בישראל",
    title: "שולחים רשימת קניות. מקבלים תוכנית קנייה חכמה.",
    subtitle:
      "הסוכן מוצא את המוצרים הנכונים, משווה מחירים אמיתיים בחנויות שלידכם, ושואל לפני שהוא מחליף מוצר.",
    primaryCta: "בקשו גישה",
    secondaryCta: "ראו דוגמה אמיתית",
    secondaryHref: "#example",
  },
  benefits: {
    id: "why",
    title: "למה אפשר לסמוך על התוכנית",
    featured: {
      title: "מזהה את אותו מוצר בכל רשת",
      body: "אותו מוצר מופיע בשם אחר בכל מחירון רשת. אנחנו מאחדים את השמות לפריט אחד, כדי שההשוואה תהיה על אותו מוצר בדיוק.",
      imageSrc: "/story-problem.webp",
      imageAlt: "אותו מוצר באריזות שונות",
    },
    items: [
      {
        title: "מחירים מהחנויות שלידכם",
        body: "המחירים נמשכים מהמחירונים הרשמיים של הרשתות, לחנויות בסביבה שלכם. לא קטלוג ארצי כללי.",
        imageSrc: "/story-market-fresh.webp",
        imageAlt: "דוכן ירקות טריים בשוק",
      },
      {
        title: "אומר מה חסר",
        body: "פריט שלא מופיע במחירון, כמו בשר מהדלפק, מסומן כחסר. בלי לנחש מחיר ובלי להעלים אותו מהסל.",
      },
    ],
  },
  howItWorks: {
    id: "how",
    title: "מה קורה מאחורי הקלעים",
    intro: "מרשימה חופשית בעברית ועד תוכנית סגורה, בשלושה שלבים.",
    steps: [
      {
        title: "שולחים רשימה",
        body: "רשימת קניות חופשית בעברית, עם עיר או שכונה.",
      },
      {
        title: "הסוכן מברר",
        body: "כל מה שלא חד־משמעי חוזר כשאלה, לפני שממשיכים.",
      },
      {
        title: "מקבלים תוכנית",
        body: "חנות מומלצת, מחיר כולל, ורשימה של מה שחסר.",
      },
    ],
    explain: [
      {
        title: "מאיפה המחירים",
        body: "רשתות השיווק בישראל מפרסמות מחירונים מלאים לפי חוק שקיפות המחירים. אנחנו אוספים אותם, מאחדים מוצרים וחנויות, ושומרים מתי כל מחיר עודכן. מחירון רשמי של הרשת, לא גרידה מאפליקציות.",
        chips: ["מחירון רשמי", "חוק שקיפות המחירים", "חותמת עדכון לכל מחיר"],
      },
      {
        title: "איך מתחברים",
        body: "MCP הוא התקן שמחבר כלים לסוכני AI. מחברים את Claude או Cursor עם מפתח, והסוכן יודע לשלוח רשימה ולקבל תוכנית: התאמת מוצרים, השוואת מחירים ושאלות הבהרה. אותה שכבה זמינה גם כ־REST API.",
        chips: ["Claude", "Cursor", "REST API"],
      },
    ],
  },
  example: {
    id: "example",
    eyebrow: "שיחה אמיתית, בלי עריכה",
    title: "ככה נראית תוכנית קנייה אמיתית",
    body: "רשימת ברביקיו בנווה עמל, הרצליה: הסוכן השווה חנויות באזור, בחר את הזולה ופירט מחיר לכל פריט.",
    mapCaption: "השוואת חנויות סביב הכתובת. קארפור יצא הזול ביותר לסל הזה.",
    tableCaption: "פירוט מלא: 14 פריטים תומחרו, בשר טרי ושקית קרח סומנו כחסרים.",
    highlightStore: "קארפור קצנלסון 19, הרצליה",
    highlightTotal: "₪267",
    highlightNote: "סך הסל שתומחר, בלי בשר מהדלפק",
    cta: "בקשו גישה",
  },
  safety: {
    id: "safety",
    statement: "כשלא בטוח, שואל. לא מחליף בשקט.",
    body: "כשיש כמה מוצרים דומים, הסוכן מציג את האפשרויות הזמינות בקרבת מקום, והבחירה נשארת אצלכם.",
    imageSrc: "/story-safety.webp",
    imageAlt: "מדף משקאות דומים, בחירה במקום החלפה שקטה",
  },
  access: {
    id: "access",
    title: "מוכנים לחבר סוכן?",
    body: "שלחו בקשת גישה, ונחזור אליכם עם מפתח והוראות חיבור של שתי דקות.",
    primaryCta: "בקשו גישה",
    emailMissing:
      "NEXT_PUBLIC_ACCESS_EMAIL חסר. הגדירו כתובת בקשה ב־.env.local לפני פרסום.",
    alreadyHaveKey: "כבר יש לכם מפתח?",
    alreadyHaveKeyHint:
      "הדביקו את התבנית ל־mcp.json והחליפו את המציין. אל תדביקו סוד כאן.",
    selfHost: "אירוח עצמי",
    selfHostHint: "אפשר גם להריץ אצלכם. ראו את ה־README במאגר.",
    selfHostCta: "לתיעוד במאגר",
    copyJson: "העתקת JSON",
    copyUrl: "העתקת URL",
    imageSrc: "/story-access.webp",
    imageAlt: "אריזת מצרכים טריים",
  },
  developer: {
    id: "developers",
    summary: "פרטים למפתחים",
    title: "MCP ו־REST על אותה שכבה",
    body: "אותם כלים, מפתח אחד. החיבור דרך MCP או REST.",
    groups: [
      { title: "תכנון סל", tools: ["optimize_basket"] },
      {
        title: "מוצרים",
        tools: ["search_products", "resolve_products", "get_product", "suggest_substitutes"],
      },
      { title: "מחירים", tools: ["compare_prices"] },
      { title: "חנויות ומבצעים", tools: ["list_stores", "get_promotions"] },
    ],
  },
  trust: {
    id: "trust",
    title: "מקורות ושקיפות",
    body: "מחירים משתנים. כל מחיר אצלנו נושא מועד עדכון, ומה שלא מתומחר מסומן כחסר.",
    links: [
      {
        href: "https://github.com/nitaiaharoni1/super-mcp/blob/main/DATA.md",
        label: "מקורות נתונים",
      },
      {
        href: "https://github.com/nitaiaharoni1/super-mcp/blob/main/SECURITY.md",
        label: "אבטחה",
      },
      {
        href: "https://github.com/nitaiaharoni1/super-mcp/blob/main/README.md",
        label: "אירוח מול self-host",
      },
    ],
  },
  footer: {
    note: "Super MCP · תוכנית קנייה אמינה לסוכני AI",
  },
} as const;

export type HeContent = typeof he;
