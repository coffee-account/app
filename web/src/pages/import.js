import { html, useState, useMemo, useLoad, Loading, Field, toast, useBusy, fmtEUR } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { parseWorkbook } from "../lib/xlsx-import.js";
import { Figures } from "../lib/drawings.js";
import { parseDutySheet, matchSheetRow, matchGroup } from "../lib/duty-import.js";
import { personName, sortPeople, dutyRound } from "../lib/accounting.js";
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
        <h2>Check before applying</h2>
        <p class="lede" style="margin:-4px 0 12px">The sheet is compared with what is already in the app. Only what is new or different is applied:
          duties and answers the app already has are left alone, and nothing is removed.</p>
        ${r.errors.map((e) => html`<div class="notice bad">${e}</div>`)}
        ${r.duplicates.length > 0 && html`<div class="notice warn"><b>Listed twice in People</b> (only the first is used): ${r.duplicates.join(", ")}</div>`}
        ${r.unknownRows.length > 0 && html`<div class="notice warn"><b>Not found in People — these values will be skipped:</b>
          <ul>${r.unknownRows.map((x) => html`<li>${x}</li>`)}</ul>Fix the spelling in the spreadsheet (or add them to People) and choose the file again.</div>`}
        ${r.groupMerges.length > 0 && html`<div class="notice info"><b>Group spellings merged:</b> ${r.groupMerges.join("; ")}</div>`}
        ${r.warnings.map((w) => html`<div class="notice warn small">${w}</div>`)}
        ${r.balanceDiffs.length > 0 ? html`<div class="notice warn"><b>${r.balanceDiffs.length} balances differ from the spreadsheet's Balance sheet.</b> The app
            recalculates everything from the raw sheets with one consistent formula, so differences usually point at inconsistent formulas in the old Balance sheet.</div>
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
    const [people, groups, duties, freeWeeks] = await Promise.all([api.listPeople(), api.listGroups(), api.listAllDuties(), api.listDutyFreeWeeks()]);
    return { people: sortPeople(people, "last"), groups, duties, freeWeeks };
  });
  const [sheet, setSheet] = useState(null);
  const [answersInApp, setAnswersInApp] = useState([]); // availability already in the app for the sheet's weeks
  const [choice, setChoice] = useState({});
  const [opts, setOpts] = useState({ overwrite: false, freeWeeks: true, onlySheet: true });
  const [showSame, setShowSame] = useState(false);
  const [done, setDone] = useState(null);
  const [busy, run] = useBusy();
  const loadAnswers = (s) => (s.weeks.length ? api.listAvailability(s.weeks[0], s.weeks[s.weeks.length - 1]) : Promise.resolve([]));

  const read = (f) => f && run(async () => {
    setDone(null);
    const s = await parseDutySheet(await f.arrayBuffer());
    setAnswersInApp(await loadAnswers(s));
    setChoice(matchRows(s, ref.data.people, ref.data.groups));
    setSheet(s);
  });
  // Matched rows update the person; the rest are created (on the coffee list if active in the sheet).
  // `keep`: earlier choices to keep (after applying, only rows that created someone are matched again).
  const matchRows = (s, people, groups, keep = {}) => Object.fromEntries(s.rows.map((r) => {
    if (keep[r.key] && keep[r.key].target !== "new") return [r.key, keep[r.key]];
    const m = matchSheetRow(r, people);
    return [r.key, {
      target: m.personId || "new", how: m.how, sure: m.sure, pool: keep[r.key]?.pool ?? r.active,
      last: r.last, first: r.first, group: matchGroup(r.group, groups) ?? r.group, coffee: r.active, drinks: false,
    }];
  }));
  const set = (key, patch) => setChoice((c) => ({ ...c, [key]: { ...c[key], ...patch } }));

  // Compare the sheet with the app: only what is new or different is applied.
  const plan = useMemo(() => {
    if (!sheet || !ref.data) return null;
    const { people, groups, duties, freeWeeks } = ref.data;
    const known = new Set(groups.map((g) => g.name));
    const byId = new Map(people.map((p) => [p.id, p]));
    const dutyKey = new Set(duties.map((d) => `${d.person_id}|${d.week_start}`));
    const answerOf = new Map(answersInApp.map((a) => [`${a.person_id}|${a.week_start}`, a.status]));
    const rows = sheet.rows.map((r) => ({ r, c: choice[r.key] })).filter(({ c }) => c && c.target !== "skip");
    const changes = {}; // row key → { list: [text], count }
    const create = rows.filter(({ c }) => c.target === "new").map(({ r, c }) => {
      changes[r.key] = { count: 1 + r.done.length + r.scheduled.length + r.answers.length, list: [
        "new person", r.done.length + r.scheduled.length && `${r.done.length + r.scheduled.length} duties`, r.answers.length && `${r.answers.length} availability answers`,
      ].filter(Boolean) };
      return { key: r.key, history: { done: r.done, scheduled: r.scheduled, answers: r.answers }, person: {
        last_name: c.last, first_name: c.first, group_name: c.group || null, active_coffee: c.coffee, active_drinks: c.drinks,
        active_duty: c.pool, duty_carryover: r.carryover, duty_rounds_before: r.roundsBefore,
      } };
    });
    let differing = 0;
    const update = rows.filter(({ c }) => c.target !== "new").map(({ r, c }) => {
      const p = byId.get(c.target) || {};
      const patch = {};
      const list = [];
      if (!!p.active_duty !== c.pool) { patch.active_duty = c.pool; list.push(c.pool ? "joins the duty pool" : "leaves the duty pool"); }
      if (Number(p.duty_carryover || 0) !== r.carryover) { patch.duty_carryover = r.carryover; list.push(`duties before the app ${Number(p.duty_carryover || 0)} → ${r.carryover}`); }
      if (Number(p.duty_rounds_before || 0) !== r.roundsBefore) { patch.duty_rounds_before = r.roundsBefore; list.push(`target adjusted (rounds before joining ${Number(p.duty_rounds_before || 0)} → ${r.roundsBefore})`); }
      const fresh = (weeks) => weeks.filter((w) => !dutyKey.has(`${c.target}|${w}`));
      const done = fresh(r.done), scheduled = fresh(r.scheduled);
      if (done.length + scheduled.length) list.push(`${done.length + scheduled.length} new dut${done.length + scheduled.length === 1 ? "y" : "ies"}: ${[...done, ...scheduled].sort().map(fmtDate).join(", ")}`);
      const added = r.answers.filter((a) => !answerOf.has(`${c.target}|${a.week}`));
      const changed = r.answers.filter((a) => answerOf.has(`${c.target}|${a.week}`) && answerOf.get(`${c.target}|${a.week}`) !== a.status);
      differing += changed.length;
      if (added.length) list.push(`${added.length} new availability answer${added.length === 1 ? "" : "s"}`);
      if (changed.length) list.push(`${changed.length} answer${changed.length === 1 ? " differs" : "s differ"} from the app${opts.overwrite ? " (overwritten)" : " (kept as in the app)"}`);
      const answers = opts.overwrite ? [...added, ...changed] : added;
      changes[r.key] = { list, count: Object.keys(patch).length + done.length + scheduled.length + answers.length };
      return { id: c.target, patch, history: { done, scheduled, answers } };
    }).filter((u) => Object.keys(u.patch).length || u.history.done.length || u.history.scheduled.length || u.history.answers.length);
    const twice = rows.filter(({ c }) => c.target !== "new").map(({ c }) => c.target).filter((id, i, a) => a.indexOf(id) !== i);
    // The sheet is the whole duty pool: everyone else leaves it, and would start owing from this round if added later.
    const inSheet = new Set(Object.values(choice).map((c) => c.target));
    const outside = people.filter((p) => p.active_duty && !inSheet.has(p.id));
    if (opts.onlySheet) {
      for (const p of outside) {
        const fresh = !Number(p.duty_carryover) && !Number(p.duty_rounds_before) && sheet.round != null;
        update.push({ id: p.id, patch: { active_duty: false, ...(fresh ? { duty_rounds_before: sheet.round } : {}) }, history: { done: [], scheduled: [], answers: [] } });
      }
    }
    const haveFree = new Set(freeWeeks.map((f) => f.week_start));
    const newFree = sheet.freeWeeks.filter((w) => !haveFree.has(w));
    const round = sheet.round != null && sheet.round !== dutyRound(app.settings) ? sheet.round : null;
    const total = Object.values(changes).reduce((n, x) => n + x.count, 0) + (opts.onlySheet ? outside.length : 0)
      + (opts.freeWeeks ? newFree.length : 0) + (round != null ? 1 : 0);
    return {
      outside, changes, differing, newFree, total, unchanged: rows.filter(({ r }) => !changes[r.key]?.count && !changes[r.key]?.list.length).length,
      groups: [...new Set(create.map((x) => x.person.group_name).filter((g) => g && !known.has(g)))],
      create, update, twice, freeWeeks: opts.freeWeeks ? newFree : [], round,
    };
  }, [sheet, choice, opts, ref.data, answersInApp]);

  const doImport = () => run(async () => {
    const res = await api.importDutySheet(plan, { keepAnswers: false }); // answers are already limited to what should be written
    setDone(res);
    toast(`${plan.total} change${plan.total === 1 ? "" : "s"} applied`);
    await app.refresh();
    const [people, groups] = await Promise.all([api.listPeople(), api.listGroups()]);
    setChoice((c) => matchRows(sheet, sortPeople(people, "last"), groups, c));
    setAnswersInApp(await loadAnswers(sheet));
    await ref.reload();
  });
  const hasChanges = (r) => choice[r.key]?.target === "skip" || plan.changes[r.key]?.list.length > 0;

  return html`
    <p class="lede" style="margin-bottom:14px">The "Kitchen duties" workbook: each person's availability (y / n), duties done (d) and scheduled (s),
      and the Carryover, Target and Active columns. No e-mails are sent.</p>
    <div class="card">
      <${Field} label="Workbook (.xlsx)"><input type="file" accept=".xlsx" onChange=${(e) => read(e.target.files[0])} /><//>
      ${busy && !sheet && html`<p class="muted">Reading workbook…</p>`}
    </div>
    <${Loading} state=${ref}>${({ people, groups }) => sheet && plan && html`
      <${Figures} items=${[
        { label: "Changes", value: plan.total, tone: plan.total ? "pos" : "", sub: plan.total ? "new or different from the app" : "the app is up to date" },
        { label: "People", value: sheet.rows.length, sub: `${plan.create.length} new, ${plan.unchanged} unchanged` },
        { label: "Duties", value: sheet.rows.reduce((n, r) => n + r.done.length + r.scheduled.length, 0),
          sub: `${sheet.rows.reduce((n, r) => n + r.scheduled.length, 0)} still scheduled` },
        { label: "Round", value: sheet.round ?? "—", sub: `weeks ${fmtDate(sheet.weeks[0])} – ${fmtDate(sheet.weeks[sheet.weeks.length - 1])}` },
      ]} />
      <div class="card">
        <h2>Check before applying</h2>
        <p class="lede" style="margin:-4px 0 12px">The sheet is compared with what is already in the app. Only what is new or different is applied:
          duties and answers the app already has are left alone, and nothing is removed.</p>
        ${sheet.warnings.map((w) => html`<div class="notice warn small">${w}</div>`)}
        ${plan.twice.length > 0 && html`<div class="notice bad">Several rows point at the same person: ${plan.twice.map((id) => personName(people.find((p) => p.id === id))).join(", ")}. Change one of them.</div>`}
        <div class="grid" style="margin-bottom:14px">
          ${plan.differing > 0 && html`<label class="check"><input type="checkbox" checked=${opts.overwrite} onChange=${(e) => setOpts({ ...opts, overwrite: e.target.checked })} />
            Overwrite ${plan.differing} availability answer${plan.differing === 1 ? " that differs" : "s that differ"} from what is in the app (otherwise the app's answers stay)</label>`}
          ${plan.round != null && html`<div class="small">Round: ${dutyRound(app.settings)} in the app → <b>${plan.round}</b> from the sheet.</div>`}
          ${plan.outside.length > 0 && html`<label class="check"><input type="checkbox" checked=${opts.onlySheet} onChange=${(e) => setOpts({ ...opts, onlySheet: e.target.checked })} />
            <span>Only people in the sheet are in the duty pool. ${plan.outside.length} other${plan.outside.length > 1 ? "s" : ""} leave
              it: <span class="muted">${plan.outside.map(personName).join(", ")}</span></span></label>`}
          ${plan.newFree.length > 0 && html`<label class="check"><input type="checkbox" checked=${opts.freeWeeks} onChange=${(e) => setOpts({ ...opts, freeWeeks: e.target.checked })} />
            No kitchen duty in the weeks the sheet skips: ${plan.newFree.map(fmtDate).join(", ")}</label>`}
        </div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>In the sheet</th><th class="num">Done / target</th><th>In the app</th><th class="center">Duty pool</th><th>Changes</th></tr></thead>
          <tbody>${sheet.rows.filter((r) => showSame || hasChanges(r)).map((r) => {
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
              <td>${!isNew && c.target !== "skip" && (plan.changes[r.key]?.list.length
                  ? html`<ul class="change-list">${plan.changes[r.key].list.map((t) => html`<li>${t}</li>`)}</ul>`
                  : html`<span class="muted small">no changes</span>`)}
                ${isNew && html`<div class="grid" style="gap:6px">
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
        ${plan.unchanged > 0 && html`<button class="btn-text" style="margin-top:8px" onClick=${() => setShowSame(!showSame)}>
          ${showSame ? "Hide" : "Show"} the ${plan.unchanged} row${plan.unchanged === 1 ? "" : "s"} without changes</button>`}
        <div class="row end" style="margin-top:14px">
          ${done && html`<span class="badge ok">Applied: ${done.created} new ${done.created === 1 ? "person" : "people"}, ${done.duties} dut${done.duties === 1 ? "y" : "ies"}, ${done.answers} availability answer${done.answers === 1 ? "" : "s"}</span>`}
          <button class="btn primary" disabled=${busy || plan.twice.length > 0 || !plan.total} onClick=${doImport}>
            ${plan.total ? `Apply ${plan.total} change${plan.total === 1 ? "" : "s"}` : "Nothing new to apply"}</button>
        </div>
      </div>`}<//>`;
}
