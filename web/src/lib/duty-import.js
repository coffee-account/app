// Reads the old "Kitchen duties" workbook (sheet "Availabilities"): one row per person, one column per week
// (Monday's date in row 1), cells y / n (available or not), d (did duty), s (scheduled). Its rounds columns
// (Carryover, Target, Active) and the round counter above Target become the app's duty-pool settings.

import { loadExcelJS } from "./ui.js";
import { normName } from "./paypal.js";
import { addDays } from "./dates.js";

function val(cell) {
  let v = cell?.value;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) v = v.result;
    else if ("richText" in v) v = v.richText.map((t) => t.text).join("");
    else if ("text" in v) v = v.text;
  }
  return v ?? null;
}
const str = (v) => (v == null ? "" : String(v).trim());
const isoUTC = (d) => d.toISOString().slice(0, 10);
const LABELS = {
  last: ["surname", "last name", "nachname"], first: ["name", "first name", "vorname"], group: ["group", "gruppe"],
  active: ["active", "aktiv"], carryover: ["carryover"], target: ["target"],
};

/** { round, weeks, freeWeeks, rows: [{ last, first, group, active, carryover, roundsBefore, sheetDone, sheetTarget, done, scheduled, answers }], warnings } */
export async function parseDutySheet(arrayBuffer) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  const ws = wb.worksheets.find((w) => /availab/i.test(w.name)) || wb.worksheets[0];
  const warnings = [];

  // Labels sit in row 1 or 2; week columns have a date in row 1.
  const col = {};
  const weekCols = [];
  for (const r of [1, 2]) {
    ws.getRow(r).eachCell((cell, c) => {
      const v = val(cell);
      if (v instanceof Date) { if (r === 1) weekCols.push({ c, week: isoUTC(v) }); return; }
      const label = str(v).toLowerCase();
      for (const [k, names] of Object.entries(LABELS)) if (!col[k] && names.includes(label)) col[k] = c;
    });
  }
  if (!col.last || !col.first || !weekCols.length) {
    throw new Error(`Sheet "${ws.name}" doesn't look like the kitchen-duty list: it needs Surname and Name columns and one date per week in the first row.`);
  }
  const round = col.target ? Number(val(ws.getRow(1).getCell(col.target))) : NaN;
  if (!Number.isFinite(round)) warnings.push("No round counter found above the Target column; the round stays as it is in the app.");

  // Weeks the sheet skips (e.g. Christmas) are weeks without kitchen duty.
  const freeWeeks = [];
  for (let i = 1; i < weekCols.length; i++) {
    for (let w = addDays(weekCols[i - 1].week, 7); w < weekCols[i].week; w = addDays(w, 7)) freeWeeks.push(w);
  }

  const rows = [];
  const odd = new Map();
  ws.eachRow((row, r) => {
    if (r <= 2) return;
    const last = str(val(row.getCell(col.last)));
    const first = str(val(row.getCell(col.first)));
    if (!last && !first) return;
    const num = (k) => (col[k] ? Number(val(row.getCell(col[k]))) || 0 : 0);
    // Target is "=F1 - n" (n rounds before joining); read n from the formula, since a cached 0 isn't stored.
    const raw = col.target ? row.getCell(col.target).value : null;
    const offset = /^\s*\$?[A-Z]+\$?1\s*(?:-\s*(\d+))?\s*$/i.exec(raw?.formula ?? "");
    const target = offset && Number.isFinite(round) ? round - Number(offset[1] || 0) : col.target ? Number(val(row.getCell(col.target))) : NaN;
    const out = {
      key: `r${r}`, line: r, last, first, group: col.group ? str(val(row.getCell(col.group))) : "",
      active: col.active ? num("active") > 0 : true,
      carryover: num("carryover"),
      roundsBefore: Number.isFinite(round) && Number.isFinite(target) ? Math.max(0, round - target) : 0,
      sheetTarget: Number.isFinite(target) ? target : null,
      done: [], scheduled: [], answers: [],
    };
    for (const { c, week } of weekCols) {
      const v = str(val(row.getCell(c))).toLowerCase();
      if (!v) continue;
      if (v === "y") out.answers.push({ week, status: "available" });
      else if (v === "n") out.answers.push({ week, status: "unavailable" });
      else if (v === "d" || v === "s") {
        (v === "d" ? out.done : out.scheduled).push(week);
        out.answers.push({ week, status: "available" });
      } else odd.set(v, (odd.get(v) || 0) + 1);
    }
    out.sheetDone = out.carryover + out.done.length;
    rows.push(out);
  });
  if (odd.size) warnings.push(`Skipped unknown cell values: ${[...odd].map(([v, n]) => `"${v}" ×${n}`).join(", ")}.`);
  return { sheet: ws.name, round: Number.isFinite(round) ? round : null, weeks: weekCols.map((w) => w.week), freeWeeks, rows, warnings };
}

// ── Matching sheet rows to people ──
const compact = (s) => normName(s).replace(/ /g, "");
const tokens = (s) => normName(s).split(" ").filter(Boolean);

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
const similarLast = (a, b) => {
  const x = compact(a), y = compact(b);
  return x && y && (x === y || (Math.min(x.length, y.length) >= 5 && editDistance(x, y) <= 2));
};
// "Jan Frederik" ~ "Jan-F.", "Anwai" ~ "Anwai": a shared word, or the same first three letters.
const similarFirst = (a, b) => {
  const x = tokens(a), y = tokens(b);
  return x.some((t) => y.includes(t)) || (x[0] && y[0] && x[0].slice(0, 3) === y[0].slice(0, 3));
};

/** { personId, how, sure } for a sheet row; the sheet sometimes has first and last name swapped. */
export function matchSheetRow(row, people) {
  const orders = [[row.last, row.first], [row.first, row.last]];
  for (const [l, f] of orders) {
    const hit = people.filter((p) => normName(p.last_name) === normName(l) && normName(p.first_name) === normName(f));
    if (hit.length === 1) return { personId: hit[0].id, how: l === row.last ? "same name" : "same name (first and last swapped)", sure: true };
  }
  let several = false;
  for (const [l, f] of orders) {
    const hit = people.filter((p) => similarLast(p.last_name, l) && similarFirst(p.first_name, f));
    if (hit.length === 1) return { personId: hit[0].id, how: "similar spelling", sure: false };
    // Imported before: the one who already carries this row's numbers.
    const same = hit.filter((p) => p.active_duty !== undefined && Number(p.duty_carryover) === row.carryover && row.carryover > 0);
    if (same.length === 1) return { personId: same[0].id, how: "similar spelling, imported before", sure: false };
    several ||= hit.length > 1;
  }
  return { personId: null, how: several ? "several similar people, choose one" : null, sure: false };
}

/** The app's spelling of a sheet group ("de Vries" for "De Vries", "Bießbarth" for "Beissbarth"), or null. */
export function matchGroup(name, groups) {
  const n = compact(name);
  return n ? groups.find((g) => compact(g.name) === n)?.name ?? null : null;
}
