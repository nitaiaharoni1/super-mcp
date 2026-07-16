const IL_TIME_ZONE = "Asia/Jerusalem";

/**
 * Returns the UTC offset of Asia/Jerusalem (e.g. "+02:00" or "+03:00" during DST)
 * for the given wall-clock components. Israeli transparency feeds publish local
 * Israel time with no offset, so we must attach the correct one before constructing
 * a Date — otherwise the runtime timezone (UTC on Cloud Run) silently shifts every
 * timestamp by 2–3h.
 */
export function ilOffset(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string {
  // Interpret the wall-clock as if it were UTC, then ask what Asia/Jerusalem calls
  // that instant; the difference is the offset in effect at that local time.
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: IL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(asUtc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let hourVal = get("hour");
  if (hourVal === 24) hourVal = 0; // Intl can emit "24" for midnight
  const localAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hourVal, get("minute"));
  const offsetMin = Math.round((localAsUtc - asUtc) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${sign}${oh}:${om}`;
}

/** Build a Date from Israel-local wall-clock components (no offset in the source). */
export function dateFromIlWallClock(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const offset = ilOffset(year, month, day, hour, minute);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return new Date(
    `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${offset}`,
  );
}
