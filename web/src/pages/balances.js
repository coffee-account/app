import { html, useState, useLoad, Loading, Modal, Field, toast, fmtEUR, useBusy, downloadBlob, loadExcelJS, usePersisted } from "../lib/ui.js";
import { Figures } from "../lib/drawings.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { computeLedger, personName, sortPeople } from "../lib/accounting.js";
import { fmtDate, isoDate } from "../lib/dates.js";

const COLUMNS = [
  ["last_name", "Last name", (r) => r.person.last_name],
  ["first_name", "First name", (r) => r.person.first_name],
  ["group", "Group", (r) => r.person.group_name || ""],
  ["coffees", "Coffees", (r) => r.coffees, true],
  ["drinks", "Drinks", (r) => r.drinks, true],
  ["paid", "Paid", (r) => r.paid, true],
  ["balance", "Balance", (r) => r.balance, true],
];

export function BalancesPage() {
  const app = useApp();
  const group = app.isAdmin ? null : app.managedGroup;
  const state = useLoad(async () => {
    const [ledger, settings] = await Promise.all([api.loadLedgerData(undefined, group), app.isAdmin ? api.loadSettings() : {}]);
    return { ...ledger, paypal: settings.paypal_balance || null }; // PayPal balance: last import or set by hand, plus manual entries since
  });
  const [show, setShow] = usePersisted("balances.show", "active");
  const [sort, setSort] = usePersisted("balances.sort", ["balance", true]);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState(null);
  const [editPaypal, setEditPaypal] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [busy, run] = useBusy();
  const low = Number(app.settings.balance?.low_threshold ?? -10);

  return html`
    <div class="page-head"><div><h1>Balances</h1><p>Starting balance plus payments, minus everything counted at the price of its date.</p></div>
      ${state.data && html`<div class="row">
        <button class="btn" onClick=${() => setReminding(true)}>Low-balance reminders…</button>
        <button class="btn" disabled=${busy} onClick=${() => run(() => exportCsv(state.data))}>Export CSV</button>
        <button class="btn" disabled=${busy} onClick=${() => run(() => exportXlsx(state.data, app.settings))}>Export Excel</button></div>`}
    </div>
    <${Loading} state=${state}>${(data) => {
      const ledger = computeLedger(data);
      let rows = [...ledger.values()].filter((r) => {
        if (q && !personName(r.person).toLowerCase().includes(q.toLowerCase())) return false;
        if (show === "active") return r.person.active_coffee || r.person.active_drinks;
        if (show === "low") return r.balance < low;
        if (show === "nonzero") return Math.abs(r.balance) >= 0.01;
        return true;
      });
      const col = COLUMNS.find((c) => c[0] === sort[0]) || COLUMNS[6];
      rows = sortPeople(rows.map((r) => ({ ...r.person, _r: r })), "group").map((p) => p._r);
      rows.sort((a, b) => {
        const x = col[2](a), y = col[2](b);
        const c = typeof x === "number" ? x - y : String(x).localeCompare(String(y), "de");
        return sort[1] ? c : -c;
      });
      const all = [...ledger.values()];
      const lowCount = all.filter((r) => r.balance < low && (r.person.active_coffee || r.person.active_drinks)).length;
      // What everyone has topped up and not used yet (credit), less what people owe; compare with the PayPal balance.
      const sum = (f) => Math.round(all.reduce((s, r) => s + f(r.balance), 0) * 100) / 100;
      const credit = sum((b) => Math.max(b, 0));
      const owed = sum((b) => Math.max(-b, 0));
      return html`
        <${Figures} items=${[
          ...(app.isAdmin ? [paypalFigure(data.paypal, true, () => setEditPaypal(true))] : []),
          { label: group ? `Balances in ${group}` : "Members' balances", value: fmtEUR(credit - owed), tone: credit - owed < 0 ? "neg" : "",
            sub: `${fmtEUR(credit)} topped up and unused · ${fmtEUR(owed)} owed` },
          { label: `Below ${fmtEUR(low)}`, value: lowCount, tone: lowCount ? "neg" : "", sub: "active people to remind" },
        ]} />
        <div class="toolbar">
          <input data-search placeholder="Search name  /" aria-label="Search name" value=${q} onInput=${(e) => setQ(e.target.value)} />
          <select value=${show} onChange=${(e) => setShow(e.target.value)} aria-label="Show">
            <option value="active">On a list</option><option value="low">Below ${fmtEUR(low)}</option>
            <option value="nonzero">Non-zero balance</option><option value="all">Everyone</option></select>
          <span class="count">${rows.length} of ${all.length} people · click a row for details</span>
        </div>
        <div class="table-wrap"><table class="data">
          <thead><tr>${COLUMNS.map(([k, l, , num]) => html`<th scope="col" class="sortable ${num ? "num" : ""}" aria-sort=${sort[0] === k ? (sort[1] ? "ascending" : "descending") : "none"}
            onClick=${() => setSort([k, sort[0] === k ? !sort[1] : true])}>${l}${sort[0] === k ? (sort[1] ? " ▲" : " ▼") : ""}</th>`)}</tr></thead>
          <tbody>${rows.map((r) => html`<tr style="cursor:pointer" tabindex="0" onClick=${() => setDetail(r)}
              onKeyDown=${(e) => e.key === "Enter" && setDetail(r)} class=${r.person.active_coffee || r.person.active_drinks ? "" : "inactive"}>
            <td>${r.person.last_name}</td><td>${r.person.first_name}</td><td>${r.person.group_name || ""}</td>
            <td class="num ${r.coffees ? "" : "zero"}">${r.coffees}</td><td class="num ${r.drinks ? "" : "zero"}">${r.drinks}</td>
            <td class="num ${r.paid ? "" : "zero"}">${fmtEUR(r.paid)}</td>
            <td class="num ${r.balance < 0 ? "neg" : r.balance > 0 ? "pos" : "zero"}" style="font-weight:600">${fmtEUR(r.balance)}</td></tr>`)}</tbody>
          <tfoot><tr><td colspan="3">Total (${rows.length})</td>
            <td class="num">${rows.reduce((n, r) => n + r.coffees, 0)}</td><td class="num">${rows.reduce((n, r) => n + r.drinks, 0)}</td>
            <td class="num">${fmtEUR(rows.reduce((n, r) => n + r.paid, 0))}</td><td class="num">${fmtEUR(rows.reduce((n, r) => n + r.balance, 0))}</td></tr></tfoot>
        </table></div>
        ${editPaypal && html`<${PaypalBalanceModal} paypal=${data.paypal} onClose=${() => setEditPaypal(false)}
          onSaved=${() => { setEditPaypal(false); state.reload(); }} />`}
        ${reminding && html`<${LowBalanceModal} rows=${all} low=${low} onClose=${() => setReminding(false)} onSent=${state.reload} />`}
        ${detail && html`<${DetailModal} row=${detail} label=${app.settings.balance?.starting_label} onClose=${() => setDetail(null)} />`}`;
    }}<//>`;
}

/**
 * Low-balance reminders go out only when an admin sends them. Suggested (ticked): people on a list whose balance
 * is below the threshold and who weren't reminded in the last 7 days; the admin decides who gets one.
 */
function LowBalanceModal({ rows, low, onClose, onSent }) {
  const recent = new Date(Date.now() - 7 * 864e5).toISOString();
  const onList = (p) => p.active_coffee || p.active_drinks;
  const list = rows.filter((r) => r.balance < low).map((r) => {
    const p = r.person;
    const reminded = p.low_balance_reminded_at || null;
    return { r, p, reminded, suggest: onList(p) && !(reminded && reminded > recent) };
  }).sort((a, b) => b.suggest - a.suggest || a.r.balance - b.r.balance);
  const [picked, setPicked] = useState(() => new Set(list.filter((x) => x.suggest).map((x) => x.p.id)));
  const [result, setResult] = useState(null);
  const [busy, run] = useBusy();
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const send = () => run(async () => {
    const items = list.filter((x) => picked.has(x.p.id)).map((x) => ({ person_id: x.p.id, balance: Math.round(x.r.balance * 100) / 100 }));
    const res = await api.sendLowBalanceReminders(items);
    setResult(res);
    toast(`${res.sent} low-balance reminder${res.sent === 1 ? "" : "s"} sent`);
    onSent();
  });
  const nameOf = (id) => personName(list.find((x) => x.p.id === id)?.p);
  return html`<${Modal} title="Low-balance reminders" onClose=${onClose} wide>
    <p class="lede" style="margin:6px 0 14px">Everyone below ${fmtEUR(low)} (the threshold in Settings). Suggested (ticked): people on a list who
      weren't reminded in the last 7 days. Each e-mail gives their balance and how to pay; the text is under <a href="#/emails">E-mails</a>.</p>
    ${result ? html`<div class="notice ok">${result.sent} reminder${result.sent === 1 ? "" : "s"} sent.</div>
        ${result.skipped?.length > 0 && html`<div class="notice warn">Not sent: <ul>${result.skipped.map((x) => html`<li>${nameOf(x.person_id)}: ${x.reason}</li>`)}</ul></div>`}
        <div class="row end"><button class="btn primary" onClick=${onClose}>Close</button></div>`
      : list.length === 0 ? html`<div class="notice ok">Nobody is below ${fmtEUR(low)}. No reminders needed.</div>`
      : html`<div class="toolbar">
          <button class="btn-text" onClick=${() => setPicked(new Set(list.filter((x) => x.suggest).map((x) => x.p.id)))}>Pick the suggested</button>
          <button class="btn-text" onClick=${() => setPicked(new Set(list.map((x) => x.p.id)))}>Pick everyone listed</button>
          <button class="btn-text" onClick=${() => setPicked(new Set())}>Pick nobody</button>
          <span class="count">${list.filter((x) => x.suggest).length} suggested · ${list.length} below ${fmtEUR(low)}</span>
        </div>
        <div class="table-wrap" style="max-height:50vh;overflow-y:auto"><table class="data">
          <thead><tr><th></th><th>Name</th><th>Group</th><th class="num">Balance</th><th>Last reminded</th></tr></thead>
          <tbody>${list.map(({ r, p, reminded }) => html`<tr key=${p.id} class=${onList(p) ? "" : "inactive"}>
            <td><input type="checkbox" aria-label=${`Remind ${personName(p)}`} checked=${picked.has(p.id)} onChange=${() => toggle(p.id)} /></td>
            <td>${personName(p)}${!onList(p) && html` <span class="badge">not on a list</span>`}</td>
            <td>${p.group_name || ""}</td>
            <td class="num neg" style="font-weight:600">${fmtEUR(r.balance)}</td>
            <td class="small ${reminded ? "" : "muted"}">${reminded ? fmtDate(reminded.slice(0, 10)) : "never"}</td>
          </tr>`)}</tbody>
        </table></div>
        <div class="row" style="margin-top:14px">
          <span class="small muted">${picked.size ? `${picked.size} picked` : "Nobody picked."}</span>
          <span class="spacer"></span>
          <button class="btn-text" onClick=${onClose}>Cancel</button>
          <button class="btn primary" disabled=${busy || !picked.size} onClick=${send}>Send ${picked.size} reminder${picked.size === 1 ? "" : "s"}</button>
        </div>`}
  <//>`;
}

function DetailModal({ row, label, onClose }) {
  let running = Number(row.person.starting_balance || 0);
  const lines = row.entries.map((e) => ({ ...e, after: (running += e.amount) }));
  return html`<${Modal} title=${personName(row.person)} onClose=${onClose} wide>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Date</th><th>What</th><th class="num">Amount</th><th class="num">Balance after</th></tr></thead>
      <tbody>
        <tr><td></td><td>${label || "Starting balance"}</td><td class="num">${fmtEUR(row.person.starting_balance)}</td><td class="num">${fmtEUR(row.person.starting_balance)}</td></tr>
        ${lines.map((e) => html`<tr><td>${fmtDate(e.date)}</td>
          <td>${e.kind === "payment" ? `Payment${e.note ? ` (${e.note})` : ""}` : `${e.quantity} × ${e.kind} at ${fmtEUR(e.unit)}`}</td>
          <td class="num ${e.amount < 0 ? "neg" : "pos"}">${fmtEUR(e.amount)}</td><td class="num">${fmtEUR(e.after)}</td></tr>`)}
      </tbody>
    </table></div>
  <//>`;
}

/**
 * Figure for the PayPal balance ({ amount, as_of, source?, adjusted_at? } from settings, or null): set by the
 * last PayPal import or by hand, then kept up to date by PayPal payments and payouts recorded by hand.
 */
export function paypalFigure(paypal, linked = true, onEdit = null) {
  const imp = linked ? html`<a href="#/payments?tab=import">PayPal import</a>` : "PayPal import";
  const edit = onEdit && html` · <button class="btn-text" onClick=${onEdit}>Edit</button>`;
  if (!paypal) return { label: "PayPal balance", value: "—", sub: html`appears after the first ${imp}${onEdit ? " or once you set it" : ""}${edit || ""}` };
  const from = paypal.source === "manual" ? "set by hand" : html`from the last ${imp}`;
  const since = paypal.adjusted_at && paypal.adjusted_at.slice(0, 10) >= paypal.as_of ? ", plus entries recorded since" : "";
  return { label: "PayPal balance", value: fmtEUR(paypal.amount), tone: paypal.amount < 0 ? "neg" : "",
    sub: html`on ${fmtDate(paypal.as_of)}, ${from}${since}${edit || ""}` };
}

/** Sets the PayPal balance by hand, e.g. after checking the account. */
function PaypalBalanceModal({ paypal, onClose, onSaved }) {
  const [amount, setAmount] = useState(paypal ? String(paypal.amount).replace(".", ",") : "");
  const [asOf, setAsOf] = useState(isoDate());
  const [busy, run] = useBusy();
  const save = () => run(async () => {
    const value = Number(String(amount).replace(",", "."));
    if (!Number.isFinite(value) || amount.trim() === "") throw new Error("Enter the balance in euros");
    await api.setPaypalBalance(Math.round(value * 100) / 100, asOf);
    toast("PayPal balance saved");
    onSaved();
  });
  return html`<${Modal} title="PayPal balance" onClose=${onClose}>
    <p class="lede" style="margin:4px 0 14px">The balance as shown on paypal.com. PayPal payments and payouts you record by hand
      keep it up to date from here on; the next PayPal import sets it from the statement again.</p>
    <div class="form-grid">
      <${Field} label="Balance (€)"><input inputmode="decimal" value=${amount} onInput=${(e) => setAmount(e.target.value)} /><//>
      <${Field} label="As of"><input type="date" value=${asOf} onInput=${(e) => setAsOf(e.target.value)} /><//>
    </div>
    <div class="row end" style="margin-top:16px;gap:16px">
      <button class="btn-text" onClick=${onClose}>Cancel</button>
      <button class="btn primary" disabled=${busy} onClick=${save}>Save</button>
    </div>
  <//>`;
}

export function exportCsv(data) {
  const ledger = computeLedger(data);
  const esc = (v) => (/[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [["Last name", "First name", "Group", "Coffee list", "Drinks list", "Starting balance", "Coffees", "Drinks", "Paid", "Balance"].join(";")];
  for (const r of sortPeople([...ledger.values()].map((r) => ({ ...r.person, _r: r })), "group").map((p) => p._r)) {
    const p = r.person;
    lines.push([p.last_name, p.first_name, p.group_name || "", p.active_coffee ? "yes" : "no", p.active_drinks ? "yes" : "no",
      Number(p.starting_balance).toFixed(2).replace(".", ","), r.coffees, r.drinks, r.paid.toFixed(2).replace(".", ","),
      r.balance.toFixed(2).replace(".", ",")].map(esc).join(";"));
  }
  downloadBlob(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `balances-${isoDate()}.csv`);
}

/** Same layout as the old spreadsheet: Balance, Coffee, Drinks, Contributions, People. */
export async function exportXlsx(data, settings) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ledger = computeLedger(data);
  const people = sortPeople(data.people, "group");
  const money = "#,##0.00 €";
  const header = (ws) => { ws.getRow(1).font = { bold: true }; ws.views = [{ state: "frozen", ySplit: 1, xSplit: 3 }]; };

  const bal = wb.addWorksheet("Balance");
  bal.columns = [
    { header: "Last name", width: 20 }, { header: "First name", width: 16 }, { header: "Group", width: 16 },
    { header: "Coffees", width: 10 }, { header: "Drinks", width: 10 }, { header: "Paid", width: 12, style: { numFmt: money } },
    { header: "Balance", width: 12, style: { numFmt: money } },
  ];
  for (const p of people) {
    const r = ledger.get(p.id);
    bal.addRow([p.last_name, p.first_name, p.group_name || "", r.coffees, r.drinks, r.paid, r.balance]);
  }
  header(bal);

  for (const kind of ["coffee", "drinks"]) {
    const ws = wb.addWorksheet(kind === "coffee" ? "Coffee" : "Drinks");
    const sessions = data.sessions.filter((s) => s.kind === kind).sort((a, b) => a.session_date.localeCompare(b.session_date));
    ws.addRow(["Last name", "First name", "Group", ...sessions.map((s) => s.session_date)]);
    const key = new Map(data.counts.map((c) => [`${c.session_id}|${c.person_id}`, c.quantity]));
    for (const p of people) ws.addRow([p.last_name, p.first_name, p.group_name || "", ...sessions.map((s) => key.get(`${s.id}|${p.id}`) || 0)]);
    ws.columns.forEach((c, i) => { c.width = i < 3 ? 18 : 11; });
    header(ws);
  }

  const con = wb.addWorksheet("Contributions");
  const dates = [...new Set(data.payments.map((p) => p.paid_on))].sort();
  con.addRow(["Last name", "First name", "Group", ...dates]);
  for (const p of people) {
    con.addRow([p.last_name, p.first_name, p.group_name || "", ...dates.map((d) =>
      data.payments.filter((x) => x.person_id === p.id && x.paid_on === d).reduce((s, x) => s + Number(x.amount), 0))]);
  }
  con.columns.forEach((c, i) => { c.width = i < 3 ? 18 : 11; if (i >= 3) c.numFmt = money; });
  header(con);

  const ppl = wb.addWorksheet("People");
  ppl.addRow(["Last name", "First name", "Group", "E-mail", "Coffee list", "Drinks list", settings.balance?.starting_label || "Starting balance"]);
  for (const p of people) ppl.addRow([p.last_name, p.first_name, p.group_name || "", p.email || "", p.active_coffee, p.active_drinks, Number(p.starting_balance)]);
  ppl.getColumn(7).numFmt = money;
  ppl.columns.forEach((c) => { c.width = 18; });
  header(ppl);

  const prices = wb.addWorksheet("Prices");
  prices.addRow(["List", "Price", "Valid from"]);
  for (const p of data.prices) prices.addRow([p.kind, Number(p.price), p.valid_from]);
  prices.getColumn(2).numFmt = money;
  header(prices);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  downloadBlob(blob, `Coffee Accounting ${isoDate()}.xlsx`);
  return blob;
}
