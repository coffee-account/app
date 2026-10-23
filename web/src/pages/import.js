import { html, useState, Field, toast, useBusy, fmtEUR } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { parseWorkbook } from "../lib/xlsx-import.js";

export function ImportPage() {
  const app = useApp();
  const [file, setFile] = useState(null);
  const [drinksActive, setDrinksActive] = useState("same");
  const [result, setResult] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, run] = useBusy();

  const analyse = (f = file, mode = drinksActive) => f && run(async () => {
    setDone(null);
    setResult(await parseWorkbook(await f.arrayBuffer(), { drinksActive: mode }));
  });

  const doImport = () => run(async () => {
    const res = await api.importWorkbook(result.payload);
    if (result.summary.startLabel) {
      await api.saveSetting("balance", { ...app.settings.balance, starting_label: result.summary.startLabel });
    }
    setDone(res);
    toast("Import finished");
    app.refresh();
  });

  const r = result?.report;
  return html`
    <div class="page-head"><div><h1>Import spreadsheet</h1>
      <p>One-time move from the old "Coffee Accounting" Excel file. Nothing is saved until you confirm. Running it again updates people by name and replaces imported payments, so it is safe to repeat.</p></div></div>
    <div class="card">
      <div class="form-grid">
        <${Field} label="Workbook (.xlsx)"><input type="file" accept=".xlsx" onChange=${(e) => { const f = e.target.files[0]; setFile(f); setResult(null); analyse(f); }} /><//>
        <${Field} label="Who goes on the drinks list?" hint="The old sheet has one Active column for both lists.">
          <select value=${drinksActive} onChange=${(e) => { setDrinksActive(e.target.value); analyse(file, e.target.value); }}>
            <option value="same">Same as Active</option>
            <option value="used">Active and has ever had a drink</option>
            <option value="none">Nobody (set later)</option>
          </select><//>
      </div>
      ${busy && !result && html`<p class="muted">Reading workbook…</p>`}
    </div>
    ${result && html`
      <div class="grid cols-3">
        <div class="card"><div class="stat-label">People</div><div class="stat">${result.summary.people}</div><div class="small muted">${result.summary.active} active, ${result.summary.groups} groups</div></div>
        <div class="card"><div class="stat-label">Count sessions</div><div class="stat">${result.summary.coffeeSessions + result.summary.drinksSessions}</div>
          <div class="small muted">${result.summary.coffeeSessions} coffee, ${result.summary.drinksSessions} drinks</div></div>
        <div class="card"><div class="stat-label">Payments</div><div class="stat">${result.summary.payments}</div>
          <div class="small muted">Prices: ${result.payload.prices.map((p) => `${p.kind} ${fmtEUR(p.price)}`).join(", ") || "defaults"}</div></div>
      </div>
      <div class="card">
        <h2>Check before importing</h2>
        ${r.errors.map((e) => html`<div class="notice bad">${e}</div>`)}
        ${r.duplicates.length > 0 && html`<div class="notice warn"><b>Listed twice in People</b> (only the first is used): ${r.duplicates.join(", ")}</div>`}
        ${r.unknownRows.length > 0 && html`<div class="notice warn"><b>Not found in People — these values will be skipped:</b>
          <ul>${r.unknownRows.map((x) => html`<li>${x}</li>`)}</ul>Fix the spelling in the spreadsheet (or add them to People) and choose the file again.</div>`}
        ${r.groupMerges.length > 0 && html`<div class="notice info"><b>Group spellings merged:</b> ${r.groupMerges.join("; ")}</div>`}
        ${r.warnings.map((w) => html`<div class="notice warn small">${w}</div>`)}
        ${r.balanceDiffs.length > 0 ? html`<div class="notice warn"><b>${r.balanceDiffs.length} balances differ from the spreadsheet's Balance sheet.</b>
            The app recalculates everything from the raw sheets with one consistent formula, so differences usually point at inconsistent formulas in the old Balance sheet.</div>
          <div class="table-wrap" style="max-height:320px;overflow-y:auto"><table class="data">
            <thead><tr><th>Person</th><th class="num">Old sheet</th><th class="num">Recalculated</th><th class="num">Difference</th></tr></thead>
            <tbody>${r.balanceDiffs.map((d) => html`<tr><td>${d.name}</td><td class="num">${fmtEUR(d.sheet)}</td><td class="num">${fmtEUR(d.computed)}</td>
              <td class="num">${fmtEUR(d.computed - d.sheet)}</td></tr>`)}</tbody></table></div>`
          : html`<div class="notice ok">All balances match the spreadsheet.</div>`}
        <div class="row end" style="margin-top:14px">
          ${done ? html`<span class="badge ok">Imported: ${done.people} people, ${done.sessions} sessions, ${done.counts} counts, ${done.payments} payments</span>`
            : html`<button class="btn primary" disabled=${busy} onClick=${doImport}>Import now</button>`}
        </div>
      </div>`}`;
}
