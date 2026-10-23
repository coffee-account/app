import { html, useState, useLoad, Loading, Modal, fmtEUR, useBusy, downloadBlob, loadExcelJS } from "../lib/ui.js";
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
  const state = useLoad(() => api.loadLedgerData());
  const [show, setShow] = useState("active");
  const [sort, setSort] = useState(["balance", true]);
  const [detail, setDetail] = useState(null);
  const [busy, run] = useBusy();
  const low = Number(app.settings.balance?.low_threshold ?? -10);

  return html`
    <div class="page-head"><div><h1>Balances</h1><p>Starting balance + payments − (coffees and drinks at the price valid on each count date).</p></div>
      ${state.data && html`<div class="row">
        <button class="btn" disabled=${busy} onClick=${() => run(() => exportCsv(state.data))}>Export CSV</button>
        <button class="btn" disabled=${busy} onClick=${() => run(() => exportXlsx(state.data, app.settings))}>Export Excel</button></div>`}
    </div>
    <${Loading} state=${state}>${(data) => {
      const ledger = computeLedger(data);
      let rows = [...ledger.values()].filter((r) => {
        if (show === "active") return r.person.active_coffee || r.person.active_drinks;
        if (show === "low") return r.balance < low;
        if (show === "nonzero") return Math.abs(r.balance) >= 0.01;
        return true;
      });
      const col = COLUMNS.find((c) => c[0] === sort[0]);
      rows = sortPeople(rows.map((r) => ({ ...r.person, _r: r })), "group").map((p) => p._r);
      rows.sort((a, b) => {
        const x = col[2](a), y = col[2](b);
        const c = typeof x === "number" ? x - y : String(x).localeCompare(String(y), "de");
        return sort[1] ? c : -c;
      });
      const all = [...ledger.values()];
      const sum = (f) => all.reduce((s, r) => s + f(r), 0);
      const lowCount = all.filter((r) => r.balance < low && (r.person.active_coffee || r.person.active_drinks)).length;
      return html`
        <div class="grid cols-3" style="margin-bottom:6px">
          <div class="card"><div class="stat-label">Sum of all balances</div><div class="stat">${fmtEUR(sum((r) => r.balance))}</div>
            <div class="small muted">Positive = credit members hold</div></div>
          <div class="card"><div class="stat-label">Paid in / consumed</div><div class="stat">${fmtEUR(sum((r) => r.paid))}</div>
            <div class="small muted">${fmtEUR(sum((r) => r.coffeeCost + r.drinksCost))} consumed</div></div>
          <div class="card"><div class="stat-label">Active people below ${fmtEUR(low)}</div><div class="stat ${lowCount ? "neg" : ""}">${lowCount}</div></div>
        </div>
        <div class="row" style="margin-bottom:10px">
          <select style="max-width:240px" value=${show} onChange=${(e) => setShow(e.target.value)}>
            <option value="active">On a list</option><option value="low">Below ${fmtEUR(low)}</option>
            <option value="nonzero">Non-zero balance</option><option value="all">Everyone</option></select>
          <span class="small muted">${rows.length} people · click a row for details</span>
        </div>
        <div class="table-wrap"><table class="data">
          <thead><tr>${COLUMNS.map(([k, l, , num]) => html`<th class="sortable ${num ? "num" : ""}" aria-sort=${sort[0] === k ? (sort[1] ? "ascending" : "descending") : "none"}
            onClick=${() => setSort([k, sort[0] === k ? !sort[1] : true])}>${l}${sort[0] === k ? (sort[1] ? " ▲" : " ▼") : ""}</th>`)}</tr></thead>
          <tbody>${rows.map((r) => html`<tr style="cursor:pointer" onClick=${() => setDetail(r)} class=${r.person.active_coffee || r.person.active_drinks ? "" : "inactive"}>
            <td>${r.person.last_name}</td><td>${r.person.first_name}</td><td>${r.person.group_name || ""}</td>
            <td class="num">${r.coffees}</td><td class="num">${r.drinks}</td><td class="num">${fmtEUR(r.paid)}</td>
            <td class="num ${r.balance < low ? "neg" : r.balance < 0 ? "" : "pos"}"><b>${fmtEUR(r.balance)}</b></td></tr>`)}</tbody>
        </table></div>
        ${detail && html`<${DetailModal} row=${detail} label=${app.settings.balance?.starting_label} onClose=${() => setDetail(null)} />`}`;
    }}<//>`;
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
          <td>${e.kind === "payment" ? `Payment${e.note ? ` (${e.note})` : ""}` : `${e.quantity} × ${e.kind} à ${fmtEUR(e.unit)}`}</td>
          <td class="num ${e.amount < 0 ? "neg" : "pos"}">${fmtEUR(e.amount)}</td><td class="num">${fmtEUR(e.after)}</td></tr>`)}
      </tbody>
    </table></div>
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
