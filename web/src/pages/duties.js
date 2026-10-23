import { html, useState, useMemo, useLoad, Loading, Modal, toast, useBusy } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { personName, sortPeople, availabilityRules } from "../lib/accounting.js";
import { weeksFrom, weekLabel, mondayOf, addDays, isoWeek, isoDate } from "../lib/dates.js";
import { STATUS } from "./availability.js";

const STATUS_ORDER = { available: 0, if_needed: 1, undefined: 2, unavailable: 3 };
const statusLabel = Object.fromEntries(STATUS);

export function DutiesPage() {
  const app = useApp();
  const manager = app.canManageDuties;
  const [span, setSpan] = useState(12);
  const [tab, setTab] = useState("schedule");
  const weeks = weeksFrom(span, addDays(mondayOf(), -7));
  const state = useLoad(async () => {
    const [people, duties, availability] = await Promise.all([
      api.listDirectory(),
      manager ? api.listAllDuties() : api.listDuties(weeks[0], weeks[weeks.length - 1]),
      manager ? api.listAvailability(weeks[0], weeks[weeks.length - 1]) : Promise.resolve([]),
    ]);
    return { people, duties, availability };
  }, [span, manager]);
  const [assigning, setAssigning] = useState(null);

  return html`
    <div class="page-head"><div><h1>Kitchen duty</h1>
      <p>${manager ? "Assign people per week. Each assignment e-mails the person straight away." : "Who is on kitchen duty when."}</p></div>
      ${app.isAdmin && html`<${RemindButton} />`}
    </div>
    ${manager && html`<div class="tabs">
      <button class=${tab === "schedule" ? "active" : ""} onClick=${() => setTab("schedule")}>Schedule</button>
      <button class=${tab === "matrix" ? "active" : ""} onClick=${() => setTab("matrix")}>Availability overview</button>
    </div>`}
    <${Loading} state=${state}>${(data) => tab === "matrix" && manager
      ? html`<${AvailabilityMatrix} data=${data} weeks=${weeks.slice(1)} settings=${app.settings} />`
      : html`<${Schedule} data=${data} weeks=${weeks} manager=${manager} app=${app}
          onAssign=${setAssigning} reload=${state.reload} />`}<//>
    <div class="row" style="margin-top:12px"><button class="btn" onClick=${() => setSpan(span + 8)}>Show more weeks</button></div>
    ${assigning && state.data && html`<${AssignModal} week=${assigning} data=${state.data} settings=${app.settings}
      onClose=${() => setAssigning(null)} reload=${state.reload} />`}`;
}

function RemindButton() {
  const [busy, run] = useBusy();
  return html`<button class="btn" disabled=${busy} title="Sends availability reminders and this week's duty reminders"
    onClick=${() => run(async () => {
      const r = await api.sendWeeklyReminders();
      if (r && "availability_reminders" in r) toast(`Sent ${r.availability_reminders} availability and ${r.duty_reminders} duty reminders`);
    })}>Send reminders now</button>`;
}

function Schedule({ data, weeks, manager, app, onAssign, reload }) {
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const thisWeek = mondayOf();
  const [busy, run] = useBusy();
  const remove = (a) => {
    const p = byId.get(a.person_id);
    if (!confirm(`Remove ${personName(p)} from ${weekLabel(a.week_start)}?`)) return;
    const notify = a.week_start >= thisWeek && confirm("Send them a cancellation e-mail?");
    run(async () => { await api.unassignDuty(a, notify); reload(); });
  };
  const resend = (a) => run(async () => { await api.resendDuty(a.id); toast("E-mail sent"); reload(); });

  return html`<div class="table-wrap"><table class="data">
    <thead><tr><th>Week</th><th>On duty</th>${manager && html`<th></th>`}</tr></thead>
    <tbody>${weeks.map((w) => {
      const rows = data.duties.filter((d) => d.week_start === w);
      const mine = rows.some((d) => d.person_id === app.person?.id);
      return html`<tr class=${w < thisWeek ? "inactive" : ""}>
        <td style="white-space:nowrap"><b>${weekLabel(w)}</b>
          ${w === thisWeek && html` <span class="badge accent">this week</span>`}
          ${mine && html` <span class="badge ok">you</span>`}</td>
        <td>${rows.length ? rows.map((a) => html`<span class="chip" title=${a.notify_error ? `E-mail failed: ${a.notify_error}` : a.notified_at ? "E-mail sent" : ""}>
            ${personName(byId.get(a.person_id))}${a.notify_error ? " ⚠️" : ""}
            ${manager && a.notify_error && html`<button aria-label="Resend e-mail" title="Resend e-mail" disabled=${busy} onClick=${() => resend(a)}>↻</button>`}
            ${manager && html`<button aria-label="Remove" disabled=${busy} onClick=${() => remove(a)}>×</button>`}
          </span>`) : html`<span class="muted">—</span>`}</td>
        ${manager && html`<td class="num"><button class="btn small" onClick=${() => onAssign(w)}>Assign…</button></td>`}
      </tr>`;
    })}</tbody>
  </table></div>`;
}

function AssignModal({ week, data, settings, onClose, reload }) {
  const [showAll, setShowAll] = useState(false);
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [busy, run] = useBusy();
  const assigned = new Set(data.duties.filter((d) => d.week_start === week).map((d) => d.person_id));
  const yearAgo = addDays(isoDate(), -365);
  const dutyCount = useMemo(() => {
    const m = new Map();
    for (const d of data.duties) if (d.week_start >= yearAgo) m.set(d.person_id, (m.get(d.person_id) || 0) + 1);
    return m;
  }, [data.duties]);
  const lastDuty = useMemo(() => {
    const m = new Map();
    for (const d of data.duties) if (!m.has(d.person_id) || m.get(d.person_id) < d.week_start) m.set(d.person_id, d.week_start);
    return m;
  }, [data.duties]);
  const avail = new Map(data.availability.filter((a) => a.week_start === week).map((a) => [a.person_id, a]));
  const target = Number(settings.duty?.people_per_week || 0);

  let people = data.people.filter((p) => showAll || p.active_coffee || p.active_drinks);
  if (search) people = people.filter((p) => personName(p).toLowerCase().includes(search.toLowerCase()));
  people = sortPeople(people, "last").sort((a, b) =>
    STATUS_ORDER[avail.get(a.id)?.status] - STATUS_ORDER[avail.get(b.id)?.status]
    || (dutyCount.get(a.id) || 0) - (dutyCount.get(b.id) || 0));

  const assign = (p) => run(async () => {
    const { mailError } = await api.assignDuty(week, p.id, note);
    if (mailError) toast(`${personName(p)} assigned, but the e-mail failed: ${mailError}`, "error");
    else toast(`${personName(p)} assigned and notified`);
    reload();
  });

  return html`<${Modal} title=${`Assign — ${weekLabel(week)}`} onClose=${onClose} wide>
    <p class="muted small">${assigned.size} assigned${target ? ` (target ${target})` : ""}. Sorted by availability, then by fewest duties in the last 12 months.</p>
    <div class="form-grid" style="margin-bottom:10px">
      <input placeholder="Search name" value=${search} onInput=${(e) => setSearch(e.target.value)} />
      <input placeholder="Note for the e-mail (optional)" value=${note} onInput=${(e) => setNote(e.target.value)} />
      <label class="check"><input type="checkbox" checked=${showAll} onChange=${(e) => setShowAll(e.target.checked)} /> Include people not on any list</label>
    </div>
    <div class="table-wrap" style="max-height:55vh;overflow-y:auto"><table class="data">
      <thead><tr><th>Name</th><th>Group</th><th>Availability</th><th class="num">Duties (12 mo.)</th><th>Last duty</th><th></th></tr></thead>
      <tbody>${people.map((p) => {
        const a = avail.get(p.id);
        return html`<tr>
          <td>${personName(p)}${!p.has_account && html` <span class="badge" title="No account: they will only be e-mailed if an e-mail address is stored">no account</span>`}</td>
          <td>${p.group_name || ""}</td>
          <td><span class="dot ${a?.status || ""}"></span>${a ? statusLabel[a.status] : html`<span class="muted">no answer</span>`}
            ${a?.note && html`<div class="small muted">${a.note}</div>`}</td>
          <td class="num">${dutyCount.get(p.id) || 0}</td>
          <td>${lastDuty.get(p.id) ? `Week ${isoWeek(lastDuty.get(p.id))}, ${lastDuty.get(p.id).slice(0, 4)}` : "—"}</td>
          <td class="num">${assigned.has(p.id)
            ? html`<span class="badge ok">assigned</span>`
            : html`<button class="btn small primary" disabled=${busy} onClick=${() => assign(p)}>Assign</button>`}</td>
        </tr>`;
      })}</tbody>
    </table></div>
  <//>`;
}

function AvailabilityMatrix({ data, weeks, settings }) {
  const { weeksAhead, requiredFor } = availabilityRules(settings);
  const mandatory = new Set(weeksFrom(weeksAhead));
  const people = sortPeople(data.people.filter((p) => requiredFor === "all" || p.active_coffee || p.active_drinks), "group");
  const key = (pid, w) => `${pid}|${w}`;
  const map = new Map(data.availability.map((a) => [key(a.person_id, a.week_start), a]));
  const missingCount = (p) => [...mandatory].filter((w) => !map.has(key(p.id, w))).length;
  return html`
    <p class="muted small">Required window: the next ${weeksAhead} weeks.
      <span class="dot available"></span>available <span class="dot if_needed"></span>if needed <span class="dot unavailable"></span>not available <span class="dot"></span>no answer</p>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Name</th><th class="num">Missing</th>${weeks.map((w) => html`<th title=${weekLabel(w)} style="text-align:center">W${isoWeek(w)}</th>`)}</tr></thead>
      <tbody>${people.map((p) => {
        const m = missingCount(p);
        return html`<tr>
          <td>${personName(p)} <span class="small muted">${p.group_name || ""}</span>${!p.has_account && html` <span class="badge">no account</span>`}</td>
          <td class="num">${p.has_account ? (m ? html`<span class="badge warn">${m}</span>` : html`<span class="badge ok">0</span>`) : "—"}</td>
          ${weeks.map((w) => {
            const a = map.get(key(p.id, w));
            return html`<td style="text-align:center" title=${a ? `${statusLabel[a.status]}${a.note ? `: ${a.note}` : ""}` : "no answer"}>
              <span class="dot ${a?.status || ""}"></span></td>`;
          })}
        </tr>`;
      })}</tbody>
    </table></div>`;
}

