export const copy = {
  brand: "Super MCP",
  brandSubtitle: "נתוני סופרמרקטים לסוכני AI",
  cta: "התחבר",
  navConnectHref: "#connect",
  hero: {
    headline: "מחירים אמיתיים מהסופר. ישירות לסוכן שלך.",
    subtext: "מחיר, מבצע וסל אופטימלי ליד הבית - ב-Cursor וב-Claude.",
  },
  proof: ["רשתות ישראליות", "ערים ושכונות", "מחירים עם רעננות"],
  jobs: [
    { title: "חפש מוצר", body: "שאילתות בעברית עם ברקוד ושם קנוני." },
    { title: "השווה מחירים", body: "אותו מוצר, כמה רשתות, מחיר ליחידה אמין." },
    { title: "אופטימיזציית סל", body: "רשימת קניות ליד הבית עם אישור כשצריך." },
    { title: "הסבר מבצעים", body: "מכניקת הנחה ברורה לסוכן, לא רק מחיר סופי." },
  ],
  basketStory: {
    title: "סל ברביקיו ליד הרצליה",
    steps: [
      "שולחים רשימה עם כמויות טבעיות (20 פיתות, 1.5 ק״ג).",
      "אם צריך, הסוכן עונה על שאלות אישור קצרות.",
      "מקבלים חנות מומלצת ליד נווה עמל עם כיסוי ומחיר.",
    ],
  },
  connect: {
    title: "התחבר ל-MCP",
    urlLabel: "כתובת MCP",
    openCursor: "פתח ב-Cursor",
    copyUrl: "העתק כתובת",
    copyJson: "העתק JSON",
    stepsTitle: "בשלושה צעדים",
    steps: [
      "לחצו פתח ב-Cursor, או העתיקו את כתובת ה-MCP.",
      "אם אין Cursor: העתיקו את ה-JSON להגדרות MCP ב-Claude או Cursor.",
      "בקשו מהסוכן לבצע אופטימיזציית סל ליד הרצליה.",
    ],
  },
  tools: [
    { name: "optimize_basket", label: "אופטימיזציית סל" },
    { name: "search_products", label: "חיפוש מוצרים" },
    { name: "compare_prices", label: "השוואת מחירים" },
    { name: "suggest_substitutes", label: "תחליפים" },
    { name: "resolve_products", label: "זיהוי מוצרים" },
    { name: "list_stores", label: "חנויות" },
    { name: "get_promotions", label: "מבצעים" },
    { name: "get_product", label: "פרטי מוצר" },
  ],
  footer: {
    note: "Super MCP - שכבת מחירים לסוכני AI בישראל",
  },
} as const;
