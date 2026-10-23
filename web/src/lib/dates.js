// Dates are handled as "YYYY-MM-DD" strings in local time. Weeks start on Monday.

export function isoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export function mondayOf(s = isoDate()) {
  const d = parseDate(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDate(d);
}

export function isoWeek(s) {
  const d = parseDate(s);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

/** The `count` Mondays starting with the week containing `from` (default: this week). */
export function weeksFrom(count, from = isoDate()) {
  const start = mondayOf(from);
  return Array.from({ length: count }, (_, i) => addDays(start, i * 7));
}

const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const long = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function fmtDate(s) {
  return s ? long.format(parseDate(s)) : "";
}

export function weekRange(weekStart) {
  return `${short.format(parseDate(weekStart))} – ${short.format(parseDate(addDays(weekStart, 6)))}`;
}

export function weekLabel(weekStart) {
  return `Week ${isoWeek(weekStart)} · ${weekRange(weekStart)}`;
}
