// PayPal "Activity download" CSV: parsing (English or German export) and matching payers to people.

// ── CSV ──
export function parseCsv(text) {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.indexOf("\n") >>> 0);
  const delim = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

// Column names in English and German PayPal exports (lower-case).
const COLUMNS = {
  date: ["date", "datum"],
  time: ["time", "uhrzeit"],
  name: ["name"],
  type: ["type", "typ", "beschreibung", "description"],
  status: ["status"],
  currency: ["currency", "währung", "waehrung"],
  gross: ["gross", "brutto"],
  fee: ["fee", "gebühr", "gebuehr", "entgelt"],
  net: ["net", "netto"],
  from: ["from email address", "absender e-mail-adresse", "absender-e-mail-adresse"],
  to: ["to email address", "empfänger e-mail-adresse", "empfänger-e-mail-adresse"],
  id: ["transaction id", "transaktionscode", "transaktions-id"],
  note: ["note", "hinweis", "subject", "betreff", "nachricht", "message"],
  impact: ["balance impact", "auswirkung auf guthaben"],
};

function columnIndex(header) {
  const h = header.map((x) => x.trim().toLowerCase());
  const idx = {};
  for (const [key, names] of Object.entries(COLUMNS)) idx[key] = h.findIndex((x) => names.includes(x));
  return idx;
}

/** "1.234,56" / "1,234.56" / "20,00" / "20.00" / "-5" → number */
export function parseAmount(s) {
  let t = String(s ?? "").replace(/[\s €$]/g, "");
  if (!t) return NaN;
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  if (lastComma > lastDot) t = t.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma && lastComma >= 0) t = t.replace(/,/g, "");
  else if (lastComma < 0 && /^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  return Number(t);
}

/** Works out the date format from all date cells, then converts to YYYY-MM-DD. */
function dateParser(values) {
  const parts = values.map((v) => v.trim().split(/[./-]/).map(Number)).filter((p) => p.length === 3);
  const iso = values.some((v) => /^\d{4}-\d{2}-\d{2}/.test(v.trim()));
  const dotted = values.some((v) => /^\d{1,2}\.\d{1,2}\.\d{4}/.test(v.trim()));
  // Slashes: day first if any first part is > 12, month first if any second part is > 12, else day first.
  const monthFirst = !dotted && !parts.some((p) => p[0] > 12) && parts.some((p) => p[1] > 12);
  const pad = (n) => String(n).padStart(2, "0");
  return (v) => {
    const s = v.trim();
    if (iso) return s.slice(0, 10);
    const p = s.split(/[./-]/).map(Number);
    if (p.length !== 3 || p.some(Number.isNaN)) return null;
    const [d, m] = monthFirst ? [p[1], p[0]] : [p[0], p[1]];
    const y = p[2] < 100 ? 2000 + p[2] : p[2];
    return `${y}-${pad(m)}-${pad(d)}`;
  };
}

const COMPLETED = new Set(["completed", "abgeschlossen", "erhalten", "received", ""]);
const DEBIT = new Set(["debit", "soll", "belastung"]);

/**
 * Reads a PayPal activity CSV and returns the incoming euro payments.
 * { payments: [{ id, date, name, email, note, amount, type }], skipped: { reason: count }, columnsMissing: [] }
 */
export function readStatement(text) {
  const rows = parseCsv(text);
  const headerAt = rows.findIndex((r) => columnIndex(r).gross >= 0 && columnIndex(r).date >= 0);
  if (headerAt < 0) throw new Error("This doesn't look like a PayPal activity download: no Date/Datum and Gross/Brutto columns found.");
  const idx = columnIndex(rows[headerAt]);
  const missing = ["id", "name", "from"].filter((k) => idx[k] < 0);
  if (idx.id < 0) throw new Error("The file has no Transaction ID / Transaktionscode column, which is needed to avoid double bookings. Download the CSV with all columns.");
  const data = rows.slice(headerAt + 1);
  const toDate = dateParser(data.map((r) => r[idx.date] || ""));
  const get = (r, k) => (idx[k] >= 0 ? (r[idx[k]] || "").trim() : "");
  const skipped = {};
  const skip = (reason) => { skipped[reason] = (skipped[reason] || 0) + 1; };
  const payments = [];
  for (const r of data) {
    const amount = parseAmount(get(r, "gross"));
    const currency = get(r, "currency").toUpperCase();
    const status = get(r, "status").toLowerCase();
    if (!(amount > 0) || DEBIT.has(get(r, "impact").toLowerCase())) { skip("outgoing payments, fees and withdrawals"); continue; }
    if (currency && currency !== "EUR") { skip("not in euro"); continue; }
    if (!COMPLETED.has(status)) { skip("not completed (pending, refunded, …)"); continue; }
    if (!get(r, "name") && !get(r, "from")) { skip("no sender (e.g. bank top-ups)"); continue; }
    const date = toDate(get(r, "date"));
    if (!date) { skip("unreadable date"); continue; }
    payments.push({
      id: get(r, "id"), date, amount: Math.round(amount * 100) / 100,
      name: get(r, "name"), email: get(r, "from").toLowerCase(), note: get(r, "note"), type: get(r, "type"),
    });
  }
  return { payments, skipped, columnsMissing: missing };
}

// ── Matching ──
export const normName = (s) => String(s || "")
  .toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z\s-]/g, " ").replace(/[-\s]+/g, " ").trim();
const tokens = (s) => normName(s).split(" ").filter(Boolean);

/**
 * Finds the person behind a PayPal payment.
 * Returns { personId, how, confident }: confident matches are pre-selected for booking,
 * the rest only suggest a person for the admin to confirm.
 */
export function matchPayer(p, people, aliases) {
  const byId = new Map(people.map((x) => [x.id, x]));
  const alias = (kind, value) => aliases.find((a) => a.kind === kind && a.value === value && byId.has(a.person_id));
  if (p.email) {
    const a = alias("email", p.email);
    if (a) return { personId: a.person_id, how: "remembered PayPal e-mail", confident: true };
    const direct = people.filter((x) => x.email && x.email.toLowerCase() === p.email);
    if (direct.length === 1) return { personId: direct[0].id, how: "same e-mail as in People", confident: true };
  }
  const name = normName(p.name);
  if (name) {
    const a = alias("name", name);
    if (a) return { personId: a.person_id, how: "remembered PayPal name", confident: true };
    const full = people.filter((x) => {
      const f = normName(x.first_name), l = normName(x.last_name);
      return name === `${f} ${l}` || name === `${l} ${f}`;
    });
    if (full.length === 1) return { personId: full[0].id, how: "same name", confident: true };
    const t = new Set(tokens(p.name));
    const partial = people.filter((x) => tokens(x.last_name).every((w) => t.has(w)) && tokens(x.first_name).some((w) => t.has(w)));
    if (partial.length === 1) return { personId: partial[0].id, how: "similar name", confident: false };
    const lastOnly = people.filter((x) => tokens(x.last_name).length && tokens(x.last_name).every((w) => t.has(w)));
    if (lastOnly.length === 1) return { personId: lastOnly[0].id, how: "same last name", confident: false };
  }
  return { personId: null, how: null, confident: false };
}
