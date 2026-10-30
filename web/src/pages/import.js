import { html, useState, useMemo, useLoad, Loading, Field, toast, useBusy, fmtEUR } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { parseWorkbook } from "../lib/xlsx-import.js";
import { Figures } from "../lib/drawings.js";
import { parseDutySheet, matchSheetRow, matchGroup } from "../lib/duty-import.js";
import { personName, sortPeople } from "../lib/accounting.js";
import { fmtDate } from "../lib/dates.js";

export function ImportPage() {
  const [tab, setTab] = useState("duty");
  return html`
    <div class="page-head"><div><h1>Import spreadsheets</h1>
      <p>Move data over from the old Excel files. Nothing is saved until you confirm, and running an import again is safe.</p></div></div>
    <div class="tabs">
      <button class=${tab === "duty" ? "active" : ""} onClick=${() => setTab("duty")}>Kitchen duties</button>
      <button class=${tab === "accounting" ? "active" : ""} onClick=${() => setTab("accounting")}>Coffee accounting</button>
    </div>
    ${tab === "duty" ? html`<${DutySheetImport} />` : html`<${WorkbookImport} />`}`;
}

function WorkbookImport() {
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
    <p class="lede" style="margin-bottom:14px">One-time move from the old "Coffee Accounting" Excel file. Running it again updates people by name and replaces imported payments.</p>
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
      <${Figures} items=${[
        { label: "People", value: result.summary.people, sub: `${result.summary.active} active, ${result.summary.groups} groups` },
        { label: "Count sessions", value: result.summary.coffeeSessions + result.summary.drinksSessions, sub: `${result.summary.coffeeSessions} coffee, ${result.summary.drinksSessions} drinks` },
        { label: "Payments", value: result.summary.payments, sub: `Prices: ${result.payload.prices.map((p) => `${p.kind} ${fmtEUR(p.price)}`).join(", ") || "defaults"}` },
      ]} />
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

/** The old "Kitchen duties" sheet: people in the duty pool, their duty targets, availability and duties. */
function DutySheetImport() {
  const app = useApp();
  const ref = useLoad(async () => {
    const [people, groups] = await Promise.all([api.listPeople(), api.listGroups()]);
    return { people: sortPeople(people, "last"), groups };
  });
  const [sheet, setSheet] = useState(null);
  const [choice, setChoice] = useState({});
  const [opts, setOpts] = useState({ keepAnswers: true, freeWeeks: true, onlySheet: true });
  const [done, setDone] = useState(null);
  const [busy, run] = useBusy();

  const read = (f) => f && run(async () => {
    setDone(null);
    const s = await parseDutySheet(await f.arrayBuffer());
    const { people, groups } = ref.data;
    // Matched rows update the person; the rest are created (on the coffee list if active in the sheet).
    setChoice(Object.fromEntries(s.rows.map((r) => {
      const m = matchSheetRow(r, people);
      return [r.key, {
        target: m.personId || "new", how: m.how, sure: m.sure, pool: r.active,
        last: r.last, first: r.first, group: matchGroup(r.group, groups) ?? r.group, coffee: r.active, drinks: false,
      }];
    })));
    setSheet(s);
  });
  const set = (key, patch) => setChoice((c) => ({ ...c, [key]: { ...c[key], ...patch } }));

  const plan = useMemo(() => {
    if (!sheet || !ref.data) return null;
    const known = new Set(ref.data.groups.map((g) => g.name));
    const history = (r) => ({ done: r.done, scheduled: r.scheduled, answers: r.answers });
    const rounds = (r, c) => ({ active_duty: c.pool, duty_carryover: r.carryover, duty_rounds_before: r.roundsBefore });
    const rows = sheet.rows.map((r) => ({ r, c: choice[r.key] })).filter(({ c }) => c && c.target !== "skip");
    const create = rows.filter(({ c }) => c.target === "new").map(({ r, c }) => ({ key: r.key, history: history(r), person: {
      last_name: c.last, first_name: c.first, group_name: c.group || null, active_coffee: c.coffee, active_drinks: c.drinks, ...rounds(r, c),
    } }));
    const update = rows.filter(({ c }) => c.target !== "new").map(({ r, c }) => ({ id: c.target, patch: rounds(r, c), history: history(r) }));
    const twice = rows.filter(({ c }) => c.target !== "new").map(({ c }) => c.target).filter((id, i, a) => a.indexOf(id) !== i);
    // The sheet is the whole duty pool: everyone else leaves it, and would start owing from this round if added later.
    const inSheet = new Set(Object.values(choice).map((c) => c.target));
    const outside = ref.data.people.filter((p) => p.active_duty && !inSheet.has(p.id));
    if (opts.onlySheet) {
      for (const p of outside) {
        const fresh = !Number(p.duty_carryover) && !Number(p.duty_rounds_before) && sheet.round != null;
        update.push({ id: p.id, patch: { active_duty: false, ...(fresh ? { duty_rounds_before: sheet.round } : {}) }, history: { done: [], scheduled: [], answers: [] } });
      }
    }
    return {
      outside,
      groups: [...new Set(create.map((x) => x.person.group_name).filter((g) => g && !known.has(g)))],
      create, update, twice, freeWeeks: opts.freeWeeks ? sheet.freeWeeks : [], round: sheet.round,
    };
  }, [sheet, choice, opts, ref.data]);

  const doImport = () => run(async () => {
    const res = await api.importDutySheet(plan, { keepAnswers: opts.keepAnswers });
    setDone(res);
    toast("Kitchen duties imported");
    await app.refresh();
    ref.reload();
  });

  return html`
    <p class="lede" style="margin-bottom:14px">The "Kitchen duties" workbook: each person's availability (y / n), duties done (d) and scheduled (s),
      and the Carryover, Target and Active columns. No e-mails are sent.</p>
    <div class="card">
      <${Field} label="Workbook (.xlsx)"><input type="file" accept=".xlsx" onChange=${(e) => read(e.target.files[0])} /><//>
      ${busy && !sheet && html`<p class="muted">Reading workbook…</p>`}
    </div>
    <${Loading} state=${ref}>${({ people, groups }) => sheet && plan && html`
      <${Figures} items=${[
        { label: "People", value: sheet.rows.length, sub: `${plan.update.length} matched, ${plan.create.length} new` },
        { label: "Duties", value: sheet.rows.reduce((n, r) => n + r.done.length + r.scheduled.length, 0),
          sub: `${sheet.rows.reduce((n, r) => n + r.scheduled.length, 0)} still scheduled` },
        { label: "Round", value: sheet.round ?? "—", sub: `weeks ${fmtDate(sheet.weeks[0])} – ${fmtDate(sheet.weeks[sheet.weeks.length - 1])}` },
      ]} />
      <div class="card">
        <h2>Check before importing</h2>
        ${sheet.warnings.map((w) => html`<div class="notice warn small">${w}</div>`)}
        ${plan.twice.length > 0 && html`<div class="notice bad">Several rows point at the same person: ${plan.twice.map((id) => personName(people.find((p) => p.id === id))).join(", ")}. Change one of them.</div>`}
        <div class="grid" style="margin-bottom:14px">
          <label class="check"><input type="checkbox" checked=${opts.keepAnswers} onChange=${(e) => setOpts({ ...opts, keepAnswers: e.target.checked })} />
            Keep availability people already gave in the app (the sheet only fills in weeks they haven't answered)</label>
          ${plan.outside.length > 0 && html`<label class="check"><input type="checkbox" checked=${opts.onlySheet} onChange=${(e) => setOpts({ ...opts, onlySheet: e.target.checked })} />
            <span>Only people in the sheet are in the duty pool. ${plan.outside.length} other${plan.outside.length > 1 ? "s" : ""} leave it:
              <span class="muted">${plan.outside.map(personName).join(", ")}</span></span></label>`}
          ${sheet.freeWeeks.length > 0 && html`<label class="check"><input type="checkbox" checked=${opts.freeWeeks} onChange=${(e) => setOpts({ ...opts, freeWeeks: e.target.checked })} />
            No kitchen duty in the weeks the sheet skips: ${sheet.freeWeeks.map(fmtDate).join(", ")}</label>`}
        </div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>In the sheet</th><th class="num">Done / target</th><th>In the app</th><th class="center">Duty pool</th><th>New person</th></tr></thead>
          <tbody>${sheet.rows.map((r) => {
            const c = choice[r.key];
            const isNew = c.target === "new";
            return html`<tr key=${r.key} class=${c.target === "skip" ? "inactive" : ""}>
              <td>${r.last}, ${r.first}<div class="small muted">${[r.group, r.active ? "active" : "inactive"].filter(Boolean).join(" · ")}</div></td>
              <td class="num">${r.sheetDone} / ${r.sheetTarget ?? "—"}</td>
              <td><select style="width:auto;max-width:240px" value=${c.target} aria-label=${`App person for ${r.last}, ${r.first}`}
                  onChange=${(e) => set(r.key, { target: e.target.value, how: null, sure: true })}>
                  <option value="new">Create new person</option><option value="skip">Skip this row</option>
                  ${people.map((p) => html`<option value=${p.id}>${p.last_name}, ${p.first_name}${p.group_name ? ` (${p.group_name})` : ""}</option>`)}
                </select>
                ${c.how && html`<div class="small ${c.sure ? "muted" : "neg"}">${c.sure ? "✓ " : "check: "}${c.how}</div>`}</td>
              <td class="center"><input type="checkbox" aria-label="In the duty pool" checked=${c.pool} disabled=${c.target === "skip"} onChange=${(e) => set(r.key, { pool: e.target.checked })} /></td>
              <td>${isNew && html`<div class="grid" style="gap:6px">
                <div class="row" style="gap:6px;flex-wrap:nowrap">
                  <span>${c.last}, ${c.first}</span>
                  <button class="btn-text" title="Swap first and last name" onClick=${() => set(r.key, { last: c.first, first: c.last })}>⇄ swap</button></div>
                <select style="width:auto" value=${c.group || ""} aria-label="Group" onChange=${(e) => set(r.key, { group: e.target.value })}>
                  <option value="">No group</option>
                  ${c.group && !groups.some((g) => g.name === c.group) && html`<option value=${c.group}>${c.group} (new group)</option>`}
                  ${groups.map((g) => html`<option value=${g.name}>${g.name}</option>`)}
                </select>
                <div class="row" style="gap:10px">
                  <label class="check"><input type="checkbox" checked=${c.coffee} onChange=${(e) => set(r.key, { coffee: e.target.checked })} /> Coffee list</label>
                  <label class="check"><input type="checkbox" checked=${c.drinks} onChange=${(e) => set(r.key, { drinks: e.target.checked })} /> Drinks list</label></div>
              </div>`}</td>
            </tr>`;
          })}</tbody>
        </table></div>
        <div class="row end" style="margin-top:14px">
          ${done ? html`<span class="badge ok">Imported: ${done.people - (opts.onlySheet ? plan.outside.length : 0)} people (${done.created} new), ${done.duties} duties, ${done.answers} availability answers</span>`
            : html`<button class="btn primary" disabled=${busy || plan.twice.length > 0} onClick=${doImport}>
                Import ${sheet.rows.length} people</button>`}
        </div>
      </div>`}<//>`;
}
