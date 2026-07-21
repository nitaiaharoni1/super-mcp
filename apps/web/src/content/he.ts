export const he = {
  meta: {
    title: "Super MCP — רשימת קניות לתוכנית קנייה אמינה",
    description:
      "תנו לסוכן AI רשימת קניות בעברית — וקבלו תוכנית קנייה מחנויות אמיתיות בישראל, עם שאלה לפני כל החלפה לא ודאית.",
  },
  header: {
    brand: "Super MCP",
    nav: [
      { href: "#example", label: "דוגמה" },
      { href: "#why", label: "למה" },
      { href: "#access", label: "גישה" },
    ],
    cta: "בקשו גישה <<",
  },
  hero: {
    eyebrow: "לסוכני AI · סופרמרקטים בישראל",
    title: "שולחים רשימת קניות. מקבלים תוכנית קנייה חכמה.",
    subtitle:
      "Super MCP מוצא את המוצרים הנכונים, משווה מחירים בין סופרים ומחזיר תוכנית שאפשר לסמוך עליה.",
    primaryCta: "בקשו גישה <<",
    secondaryCta: "ראו דוגמה",
    secondaryHref: "#example",
  },
  benefits: {
    id: "why",
    eyebrow: "למה זה עובד",
    title: "שלושה דברים שהופכים סל לתוכנית אמינה.",
    items: [
      {
        title: "מוצא את המוצר הנכון",
        body: "אותו מוצר מופיע בשמות שונים בכל רשת. אנחנו מאחדים אותו להשוואה אמיתית.",
        imageSrc: "/story-problem.webp",
        imageAlt: "אותו מוצר באריזות שונות",
      },
      {
        title: "משווה מחירים באמת",
        body: "מחירים לפי חנויות ליד המשתמש — לא קטלוג כללי בלי מיקום.",
        imageSrc: "/story-market-fresh.webp",
        imageAlt: "דוכן ירקות טריים בשוק",
      },
      {
        title: "שואל כשלא בטוח",
        body: "כשיש כמה אפשרויות דומות — הסוכן מקבל שאלה, לא החלפה שקטה.",
        imageSrc: "/story-safety.webp",
        imageAlt: "מדף משקאות דומים לבחירה",
      },
    ],
  },
  howItWorks: {
    id: "how",
    eyebrow: "איך זה עובד",
    title: "שלושה שלבים פשוטים.",
    steps: [
      {
        title: "שולחים רשימה",
        body: "רשימת קניות בעברית, עם מיקום או שכונה.",
      },
      {
        title: "בודקים מה לא ברור",
        body: "אם יש עמימות — שואלים לפני שממשיכים.",
      },
      {
        title: "מקבלים תוכנית",
        body: "חנות מומלצת, מחיר כולל, ומה חסר.",
      },
    ],
  },
  example: {
    id: "example",
    eyebrow: "דוגמה",
    title: "מרשימה לתוכנית — בלי ניחושים.",
    body: "דוגמה מסומנת לסל ברביקיו ליד נווה עמל, הרצליה.",
    sampleLabel: "דוגמה · לא חי",
    requestLabel: "הבקשה",
    clarifyLabel: "צריך לבחור מוצר",
    resultLabel: "התוכנית",
    storeLabel: "חנות מומלצת",
    totalLabel: "סה״כ",
    coverageLabel: "כיסוי",
    missingLabel: "חסרים",
    cta: "בקשו גישה <<",
  },
  safety: {
    id: "safety",
    eyebrow: "אמון",
    statement: "כשלא בטוחים — שואלים. לא מחליפים בשקט.",
    body: "זו ההבדלה המרכזית: הסוכן מקבל אפשרויות זמינות בקרבת מקום, ואז בוחר.",
    imageSrc: "/story-safety.webp",
    imageAlt: "מדף משקאות דומים — בחירה במקום החלפה שקטה",
  },
  access: {
    id: "access",
    eyebrow: "התחילו",
    title: "מוכנים לחבר סוכן?",
    body: "בקשו גישה למארח. נחזור אליכם עם מפתח והוראות חיבור קצרות.",
    primaryCta: "בקשו גישה <<",
    emailMissing:
      "NEXT_PUBLIC_ACCESS_EMAIL חסר. הגדירו כתובת בקשה ב־.env.local לפני פרסום.",
    alreadyHaveKey: "כבר יש לכם מפתח?",
    alreadyHaveKeyHint:
      "הדביקו את התבנית ל־mcp.json והחליפו את המציין. אל תדביקו סוד כאן.",
    selfHost: "אירוח עצמי",
    selfHostHint: "אפשר גם להריץ אצלכם — ראו את ה־README במאגר.",
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
    body: "הנתונים מגיעים מפידי שקיפות מחירים ישראליים. מחירים מדווחים עם זמן עדכון — לא מובטחים לנצח.",
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
