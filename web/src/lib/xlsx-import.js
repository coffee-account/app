// Reads the old "Coffee Accounting" workbook (sheets People, Coffee, Drinks, Contributions, Balance)
// into an import payload, plus a report of everything that looks inconsistent.

import { loadExcelJS } from "./ui.js";
import { computeLedger, round2 } from "./accounting.js";

const legacyId = (last, first) => `${String(last ?? "").trim()}.${String(first ?? "").trim()}`.toLowerCase();

/** Cell value with formulas resolved to their cached result. */
function val(cell) {
  let v = cell?.value;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) v = v.result;
    else if ("richText" in v) v = v.richText.map((t) => t.text).join("");
    else if ("text" in v) v = v.text;
  }
  return v ?? null;
}

const isoUTC = (d) => d.toISOString().slice(0, 10);
const num = (v) => (typeof v === "number" ? v : Number(String(v ?? "").replace(",", ".")) || 0);
const str = (v) => (v == null ? "" : String(v).trim());

function headerIndex(ws) {
  const out = {};
  ws.getRow(1).eachCell((cell, col) => { out[str(val(cell)).toLowerCase()] = col; });
  return out;
}

/** Date columns of a matrix sheet (Coffee / Drinks / Contributions). */
function dateColumns(ws) {
  const cols = [];
  ws.getRow(1).eachCell((cell, col) => {
    const v = val(cell);
    if (v instanceof Date) cols.push({ col, date: isoUTC(v) });
  });
  return cols;
}

function matrixRows(ws) {
  const out = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const last = str(val(row.getCell(1)));
    const first = str(val(row.getCell(2)));
    if (!last && !first) return;
    out.push({ id: legacyId(last, first), last, first, row });
  });
  return out;
}

export async function parseWorkbook(arrayBuffer, options = { drinksActive: "same" }) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  const sheet = (name) => wb.worksheets.find((w) => w.name.toLowerCase() === name.toLowerCase());
  const report = { errors: [], warnings: [], groupMerges: [], unknownRows: [], balanceDiffs: [], duplicates: [] };

  // People
  const ps = sheet("People");
  if (!ps) throw new Error('The workbook has no "People" sheet.');
  const h = headerIndex(ps);
  const colOf = (...names) => names.map((n) => h[n]).find(Boolean);
  const cLast = colOf("last name") || 1;
  const cFirst = colOf("first name") || 2;
  const cGroup = colOf("group") || 3;
  const cActive = colOf("active") || 5;
  const startKey = Object.keys(h).find((k) => k.startsWith("starting balance"));
  const cStart = startKey ? h[startKey] : 6;
  const startLabel = startKey ? str(val(ps.getRow(1).getCell(cStart))) : "Starting balance";

  const rawGroups = new Map(); // lower → Map(form → count)
  const people = [];
  const seen = new Set();
  ps.eachRow((row, i) => {
    if (i === 1) return;
    const last = str(val(row.getCell(cLast)));
    const first = str(val(row.getCell(cFirst)));
    if (!last && !first) return;
    const id = legacyId(last, first);
    if (seen.has(id)) { report.duplicates.push(`${first} ${last}`); return; }
    seen.add(id);
    const group = str(val(row.getCell(cGroup)));
    if (group) {
      const k = group.toLowerCase();
      if (!rawGroups.has(k)) rawGroups.set(k, new Map());
      rawGroups.get(k).set(group, (rawGroups.get(k).get(group) || 0) + 1);
    }
    const a = val(row.getCell(cActive));
    const active = a === true || /^(true|yes|ja|1|x)$/i.test(str(a));
    people.push({ legacy_id: id, last_name: last, first_name: first, group_raw: group, active, starting_balance: round2(num(val(row.getCell(cStart)))) });
  });

  // Normalise group spelling: use the most common form for case variants.
  const groupName = new Map();
  for (const [k, forms] of rawGroups) {
    const best = [...forms.entries()].sort((a, b) => b[1] - a[1])[0][0];
    groupName.set(k, best);
    if (forms.size > 1) report.groupMerges.push(`${[...forms.keys()].join(" / ")} → ${best}`);
  }
  for (const p of people) p.group_name = p.group_raw ? groupName.get(p.group_raw.toLowerCase()) : null;

  // Counts and contributions
  const ids = new Set(people.map((p) => p.legacy_id));
  const sessions = [];
  const payments = [];
  const usedDrinks = new Set();
  for (const [name, kind] of [["Coffee", "coffee"], ["Drinks", "drinks"], ["Contributions", "payment"]]) {
    const ws = sheet(name);
    if (!ws) { report.warnings.push(`No "${name}" sheet found — skipped.`); continue; }
    const dates = dateColumns(ws);
    const rows = matrixRows(ws);
    const bySession = dates.map((d) => ({ kind, date: d.date, counts: {} }));
    for (const r of rows) {
      let any = false;
      dates.forEach((d, i) => {
        const v = num(val(r.row.getCell(d.col)));
        if (!v) return;
        any = true;
        if (kind === "payment") payments.push({ legacy_id: r.id, date: d.date, amount: round2(v) });
        else {
          if (!Number.isInteger(v)) report.warnings.push(`${name}: ${r.first} ${r.last} has a non-whole count (${v}) on ${d.date}; it will be rounded.`);
          bySession[i].counts[r.id] = (bySession[i].counts[r.id] || 0) + v;
          if (kind === "drinks") usedDrinks.add(r.id);
        }
      });
      if (any && !ids.has(r.id)) report.unknownRows.push(`${name}: ${r.first} ${r.last}`);
    }
    if (kind !== "payment") sessions.push(...bySession.filter((s) => Object.keys(s.counts).length));
  }

  for (const p of people) {
    p.active_coffee = p.active;
    p.active_drinks = options.drinksActive === "used" ? p.active && usedDrinks.has(p.legacy_id) : options.drinksActive === "none" ? false : p.active;
  }

  // Prices from the Balance sheet (I2 / J2 in the old layout)
  const prices = [];
  const bs = sheet("Balance");
  const expected = new Map();
  if (bs) {
    const bh = headerIndex(bs);
    const pc = num(val(bs.getRow(2).getCell(bh["coffee price"] || 9)));
    const pd = num(val(bs.getRow(2).getCell(bh["drinks price"] || 10)));
    if (pc) prices.push({ kind: "coffee", price: pc, valid_from: "2000-01-01" });
    if (pd) prices.push({ kind: "drinks", price: pd, valid_from: "2000-01-01" });
    bs.eachRow((row, i) => {
      if (i === 1) return;
      const id = legacyId(val(row.getCell(1)), val(row.getCell(2)));
      const b = val(row.getCell(bh.balance || 8));
      if (id !== "." && typeof b === "number") expected.set(id, round2(b));
    });
  } else {
    report.warnings.push('No "Balance" sheet — prices default to 0.40 € (coffee) and 1.00 € (drinks).');
  }

  const groups = [...new Set(people.map((p) => p.group_name).filter(Boolean))].sort();
  const payload = {
    groups,
    people: people.map(({ group_raw, active, ...p }) => p),
    prices,
    sessions,
    payments,
  };

  // Compare with the spreadsheet's own balances.
  const fake = payload.people.map((p) => ({ ...p, id: p.legacy_id }));
  const fakeSessions = sessions.map((s, i) => ({ id: `s${i}`, kind: s.kind, session_date: s.date }));
  const counts = sessions.flatMap((s, i) => Object.entries(s.counts).map(([pid, q]) => ({ session_id: `s${i}`, person_id: pid, quantity: Math.round(q) })));
  const pricesForCalc = prices.length ? prices : [{ kind: "coffee", price: 0.4, valid_from: "2000-01-01" }, { kind: "drinks", price: 1, valid_from: "2000-01-01" }];
  const ledger = computeLedger({ people: fake, sessions: fakeSessions, counts, payments: payments.map((p) => ({ person_id: p.legacy_id, amount: p.amount, paid_on: p.date })), prices: pricesForCalc });
  for (const [id, exp] of expected) {
    const r = ledger.get(id);
    if (r && Math.abs(r.balance - exp) > 0.005) {
      report.balanceDiffs.push({ name: `${r.person.first_name} ${r.person.last_name}`, sheet: exp, computed: r.balance });
    }
  }

  const summary = {
    people: people.length,
    active: people.filter((p) => p.active).length,
    coffeeSessions: sessions.filter((s) => s.kind === "coffee").length,
    drinksSessions: sessions.filter((s) => s.kind === "drinks").length,
    payments: payments.length,
    groups: groups.length,
    startLabel,
  };
  return { payload, report, summary, ledger };
}
