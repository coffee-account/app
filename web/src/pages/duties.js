import { html, useState, useMemo, useLoad, Loading, Modal, Field, toast, useBusy, ConfirmAction, deferDelete, usePendingDeletes, useLinkTab } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { personName, sortPeople, availabilityRules, missingAvailability, dutyStats, dutyRound, owedTone } from "../lib/accounting.js";
import { weeksFrom, weekLabel, mondayOf, addDays, isoWeek } from "../lib/dates.js";
import { STATUS } from "./availability.js";
import { StatusCup, CupLegend, EmptyState, WeekCalendar } from "../lib/drawings.js";

// Name or group search: every word must appear; accents don't matter.
const fold = (x) => String(x || "").toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const searchText = (p) => fold(`${p.first_name} ${p.last_name} ${p.group_name || ""}`);
/** People matching the search; the whole search as typed ("group c") wins over its words found anywhere. */
function searchPeople(list, q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  const phrase = words.join(" ");
  if (words.length > 1 && list.some((p) => searchText(p).includes(phrase))) return list.filter((p) => searchText(p).includes(phrase));
  return list.filter((p) => words.every((w) => searchText(p).includes(w)));
}
const SearchBox = ({ q, setQ }) => html`<input data-search placeholder="Search name or group  /" aria-label="Search name or group" value=${q} onInput=${(e) => setQ(e.target.value)} />`;

const STATUS_ORDER = { available: 0, if_needed: 1, undefined: 2, unavailable: 3 };
const statusLabel = Object.fromEntries(STATUS);

export function DutiesPage() {
  const app = useApp();
  const manager = app.canManageDuties;
  const [span, setSpan] = useState(12);
  const [tab, setTab] = useLinkTab("schedule");
  const weeks = weeksFrom(span, addDays(mondayOf(), -7));
  const state = useLoad(async () => {
    const [people, duties, availability, freeWeeks] = await Promise.all([
      api.listDirectory(),
      manager ? api.listAllDuties() : api.listDuties(weeks[0], weeks[weeks.length - 1]),
      manager ? api.listAvailability(weeks[0], weeks[weeks.length - 1]) : Promise.resolve([]),
      api.listDutyFreeWeeks(),
    ]);
    return { people, duties, availability, free: new Map(freeWeeks.map((f) => [f.week_start, f])) };
  }, [span, manager]);
  const [assigning, setAssigning] = useState(null);
  const [reminding, setReminding] = useState(false);

  return html`
    <div class="page-head"><div><h1>Kitchen duty</h1>
      <p>${manager ? "Assign people per week; each assignment e-mails them straight away." : "Who is on kitchen duty when."}</p></div>
      <div class="row">
        ${manager && html`<button class="btn" disabled=${!state.data} onClick=${() => setReminding(true)}>Availability reminders…</button>`}</div>
    </div>
    ${manager && html`<div class="tabs">
      <button class=${tab === "schedule" ? "active" : ""} onClick=${() => setTab("schedule")}>Schedule</button>
      <button class=${tab === "matrix" ? "active" : ""} onClick=${() => setTab("matrix")}>Availability overview</button>
      <button class=${tab === "rounds" ? "active" : ""} onClick=${() => setTab("rounds")}>Duty pool</button>
      <button class=${tab === "settings" ? "active" : ""} onClick=${() => setTab("settings")}>Settings</button>
    </div>`}
    ${tab === "settings" && manager ? html`<${DutySettings} app=${app} />` : html`<${Loading} state=${state}>${(data) => tab === "matrix" && manager
      ? html`<${AvailabilityMatrix} data=${data} weeks=${weeks.slice(1)} settings=${app.settings} reload=${state.reload} />`
      : tab === "rounds" && manager ? html`<${Rounds} data=${data} app=${app} reload=${state.reload} />`
      : html`<${Schedule} data=${data} weeks=${weeks} manager=${manager} app=${app}
          onAssign=${setAssigning} reload=${state.reload} />`}<//>
    <div class="row" style="margin-top:12px;gap:18px">
      <button class="btn-text" onClick=${() => setSpan(span + 8)}>Show 8 more weeks</button>
      ${span > 12 && html`<button class="btn-text" onClick=${() => setSpan(Math.max(12, span - 8))}>Show 8 fewer weeks</button>`}
    </div>`}
    ${assigning && state.data && html`<${AssignModal} week=${assigning} data=${state.data} settings=${app.settings}
      onClose=${() => setAssigning(null)} reload=${state.reload} />`}
    ${reminding && state.data && html`<${RemindModal} data=${state.data} settings=${app.settings} onClose=${() => setReminding(false)} />`}`;
}

/**
 * Availability reminders go out only when a duty manager sends them. The app suggests whoever has weeks due
 * (fewer than the minimum answered); the manager decides who actually gets one.
 */
function RemindModal({ data, settings, onClose }) {
  const { weeksAhead, requiredFor } = availabilityRules(settings);
  const freeWeeks = [...data.free.keys()];
  const upcoming = weeksFrom(weeksAhead, mondayOf()).filter((w) => !data.free.has(w));
  const rows = useMemo(() => {
    const byPerson = new Map();
    for (const a of data.availability) (byPerson.get(a.person_id) || byPerson.set(a.person_id, []).get(a.person_id)).push(a);
    return sortPeople(data.people.filter((p) => requiredFor === "all" || p.active_duty), "last").map((p) => {
      const answers = byPerson.get(p.id) || [];
      const answered = new Set(answers.map((a) => a.week_start));
      const open = upcoming.filter((w) => !answered.has(w));
      const due = missingAvailability(settings, answers, freeWeeks).length > 0;
      return { p, open, due, suggest: due && p.has_account };
    }).filter((r) => r.open.length > 0)
      .sort((a, b) => b.suggest - a.suggest || b.open.length - a.open.length);
  }, [data, settings]);
  const [picked, setPicked] = useState(() => new Set(rows.filter((r) => r.suggest).map((r) => r.p.id)));
  const [result, setResult] = useState(null);
  const [busy, run] = useBusy();
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const send = () => run(async () => {
    const r = await api.sendAvailabilityReminders([...picked]);
    setResult(r);
    toast(`${r.sent} availability reminder${r.sent === 1 ? "" : "s"} sent`);
  });
  const nameOf = (id) => personName(data.people.find((p) => p.id === id));
  return html`<${Modal} title="Availability reminders" onClose=${onClose} wide>
    <p class="lede" style="margin:6px 0 14px">Nothing goes out on its own. Suggested (ticked): people with an account who have answered fewer than the minimum weeks,
      so their availability is due. Others still have open weeks within the next ${weeksAhead} and can be added. Each e-mail lists that person's open weeks;
      the text is under <a href="#/emails">E-mails</a>.</p>
    ${result ? html`<div class="notice ok">${result.sent} reminder${result.sent === 1 ? "" : "s"} sent.</div>
        ${result.skipped?.length > 0 && html`<div class="notice warn">Not sent: <ul>${result.skipped.map((x) => html`<li>${nameOf(x.person_id)}: ${x.reason}</li>`)}</ul></div>`}
        <div class="row end"><button class="btn primary" onClick=${onClose}>Close</button></div>`
      : rows.length === 0 ? html`<div class="notice ok">Everyone has answered the next ${weeksAhead} weeks. No reminders needed.</div>`
      : html`<div class="toolbar">
          <button class="btn-text" onClick=${() => setPicked(new Set(rows.filter((r) => r.suggest).map((r) => r.p.id)))}>Pick the suggested</button>
          <button class="btn-text" onClick=${() => setPicked(new Set(rows.map((r) => r.p.id)))}>Pick everyone listed</button>
          <button class="btn-text" onClick=${() => setPicked(new Set())}>Pick nobody</button>
          <span class="count">${rows.filter((r) => r.suggest).length} suggested · ${rows.length} with open weeks</span>
        </div>
        <div class="table-wrap" style="max-height:50vh;overflow-y:auto"><table class="data">
          <thead><tr><th></th><th>Name</th><th>Group</th><th class="num">Open weeks</th><th>Why</th></tr></thead>
          <tbody>${rows.map(({ p, open, due, suggest }) => html`<tr key=${p.id}>
            <td><input type="checkbox" aria-label=${`Remind ${personName(p)}`} checked=${picked.has(p.id)} onChange=${() => toggle(p.id)} /></td>
            <td>${personName(p)}${!p.has_account && html` <span class="badge" title="E-mailed only if an e-mail address is stored">no account</span>`}</td>
            <td>${p.group_name || ""}</td>
            <td class="num">${open.length}</td>
            <td class="small ${suggest ? "" : "muted"}">${due ? `fewer than the minimum answered${suggest ? "" : " (no account)"}` : "enough answered for now"}</td>
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

/** A duty manager fills in or corrects someone's availability (e.g. told in person). */
function EditAvailabilityModal({ person, weeks, data, onClose, reload }) {
  const before = new Map(data.availability.filter((a) => a.person_id === person.id).map((a) => [a.week_start, a]));
  const [draft, setDraft] = useState(() => Object.fromEntries(weeks.map((w) => [w, { status: before.get(w)?.status || "", note: before.get(w)?.note || "" }])));
  const [busy, run] = useBusy();
  const setWeek = (w, patch) => setDraft((d) => ({ ...d, [w]: { ...d[w], ...patch } }));
  const changed = weeks.filter((w) => (draft[w].status || "") !== (before.get(w)?.status || "") || (draft[w].note || "") !== (before.get(w)?.note || ""));
  const save = () => run(async () => {
    const rows = changed.filter((w) => draft[w].status).map((w) => ({ person_id: person.id, week_start: w, status: draft[w].status, note: draft[w].note || null }));
    if (rows.length) await api.saveAvailability(rows);
    await api.clearAvailability(person.id, changed.filter((w) => !draft[w].status && before.has(w)));
    toast(`Availability of ${personName(person)} saved`);
    reload();
    onClose();
  });
  return html`<${Modal} title=${`Availability · ${personName(person)}`} onClose=${onClose} wide>
    <p class="lede" style="margin:6px 0 14px">Change what ${person.first_name} answered, e.g. after they told you in person. They aren't e-mailed.</p>
    <div class="week-grid" style="max-height:60vh;overflow-y:auto">
      ${weeks.map((w) => {
        if (data.free.has(w)) return html`<div class="week-row free"><div><b>${weekLabel(w)}</b></div><span class="muted">No kitchen duty this week</span></div>`;
        const v = draft[w];
        return html`<div class="week-row">
          <div><b>${weekLabel(w)}</b>
            <input placeholder="Note (optional)" value=${v.note} style="margin-top:6px" disabled=${!v.status} onInput=${(e) => setWeek(w, { note: e.target.value })} /></div>
          <div class="seg" role="group" aria-label=${`Availability ${weekLabel(w)}`}>
            ${STATUS.map(([k, l]) => html`<button class=${v.status === k ? "on" : ""} aria-pressed=${v.status === k} onClick=${() => setWeek(w, { status: k })}>
              ${v.status === k && html`<${StatusCup} state=${k} label="" />`}${l}</button>`)}
            <button class=${!v.status ? "on" : ""} aria-pressed=${!v.status} title="Remove the answer" onClick=${() => setWeek(w, { status: "", note: "" })}>No answer</button>
          </div>
        </div>`;
      })}
    </div>
    <div class="row" style="margin-top:14px">
      <span class="small muted">${changed.length ? `${changed.length} week${changed.length > 1 ? "s" : ""} changed` : "No changes yet."}</span>
      <span class="spacer"></span>
      <button class="btn-text" onClick=${onClose}>Cancel</button>
      <button class="btn primary" disabled=${busy || !changed.length} onClick=${save}>Save</button>
    </div>
  <//>`;
}

function Schedule({ data, weeks, manager, app, onAssign, reload }) {
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const thisWeek = mondayOf();
  const [busy, run] = useBusy();
  const isPending = usePendingDeletes();
  // The cancellation e-mail only goes out once the Undo window has passed.
  const remove = (a, notify) => deferDelete({
    key: `duty:${a.id}`, message: `${personName(byId.get(a.person_id))} removed${notify ? "; they'll be e-mailed" : ""}`,
    commit: () => api.unassignDuty(a, notify), onDone: reload,
  });
  const resend = (a) => run(async () => { await api.resendDuty(a.id); toast("E-mail sent"); reload(); });
  const setFree = (w, free) => run(async () => {
    if (free) await api.setDutyFree(w, "");
    else await api.clearDutyFree(w);
    toast(free ? `${weekLabel(w)}: no kitchen duty` : `${weekLabel(w)}: kitchen duty again`);
    reload();
  });

  if (!manager && !data.duties.length) {
    return html`<${EmptyState} drawing=${html`<${WeekCalendar} />`}>Nobody has been scheduled yet. Assignments will appear here.<//>`;
  }
  return html`<div class="table-wrap"><table class="data normal">
    <thead><tr><th>Week</th><th>On duty</th>${manager && html`<th></th>`}</tr></thead>
    <tbody>${weeks.map((w) => {
      const rows = data.duties.filter((d) => d.week_start === w && !isPending(`duty:${d.id}`));
      const mine = rows.some((d) => d.person_id === app.person?.id);
      const free = data.free.get(w);
      return html`<tr class=${w < thisWeek || free ? "inactive" : ""}>
        <td style="white-space:nowrap"><b>${weekLabel(w)}</b>
          ${w === thisWeek && html` <span class="badge">this week</span>`}
          ${mine && html` <span class="badge ok">you</span>`}</td>
        <td>${rows.length ? rows.map((a) => {
          const name = personName(byId.get(a.person_id));
          return html`<span class="chip" title=${a.notify_error ? `E-mail failed: ${a.notify_error}` : a.notified_at ? "E-mail sent" : "Not e-mailed"}>
            ${name}${a.notify_error && html` <span class="flag" aria-label="E-mail failed">!</span>`}
            ${manager && a.notify_error && html`<button class="btn-text" disabled=${busy} onClick=${() => resend(a)}>Resend</button>`}
            ${manager && html`<${ConfirmAction} label="×" ariaLabel=${`Remove ${name}`} align="left" question=${`Remove ${name}?`}
              actions=${a.week_start >= thisWeek
                ? [{ label: "Remove and e-mail", danger: true, onClick: () => remove(a, true) }, { label: "Remove quietly", danger: true, onClick: () => remove(a, false) }]
                : [{ label: "Remove", danger: true, onClick: () => remove(a, false) }]} />`}
          </span>`;
        }) : free ? html`<span class="muted">No kitchen duty${free.note ? ` (${free.note})` : ""}</span>` : html`<span class="muted">—</span>`}</td>
        ${manager && html`<td class="num"><span class="row end" style="gap:10px;flex-wrap:nowrap">
          ${w >= thisWeek && html`<button class="btn-text" style="white-space:nowrap" disabled=${busy} onClick=${() => setFree(w, !free)}>${free ? "Kitchen duty after all" : "No duty this week"}</button>`}
          ${!free && html`<button class="btn small" onClick=${() => onAssign(w)}>Assign</button>`}</span></td>`}
      </tr>`;
    })}</tbody>
  </table></div>`;
}

function AssignModal({ week, data, settings, onClose, reload }) {
  const [showAll, setShowAll] = useState(false);
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState(new Set()); // people ticked for this week, assigned together
  const [busy, run] = useBusy();
  const assigned = new Set(data.duties.filter((d) => d.week_start === week).map((d) => d.person_id));
  const stats = useMemo(() => dutyStats(data.people, data.duties, dutyRound(settings)), [data, settings]);
  const lastDuty = useMemo(() => {
    const m = new Map();
    for (const d of data.duties) if (!m.has(d.person_id) || m.get(d.person_id) < d.week_start) m.set(d.person_id, d.week_start);
    return m;
  }, [data.duties]);
  const avail = new Map(data.availability.filter((a) => a.week_start === week).map((a) => [a.person_id, a]));
  const target = Number(settings.duty?.people_per_week || 0);

  let people = data.people.filter((p) => showAll || p.active_duty);
  if (search) people = people.filter((p) => personName(p).toLowerCase().includes(search.toLowerCase()));
  // Available first, then whoever owes the most duties, then whoever had duty longest ago.
  people = sortPeople(people, "last").sort((a, b) =>
    STATUS_ORDER[avail.get(a.id)?.status] - STATUS_ORDER[avail.get(b.id)?.status]
    || stats.get(b.id).owed - stats.get(a.id).owed
    || (lastDuty.get(a.id) || "").localeCompare(lastDuty.get(b.id) || ""));

  const toggle = (p) => setPicked((s) => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; });
  const nameOf = (id) => personName(data.people.find((p) => p.id === id));
  const assign = (quietly = false) => run(async () => {
    const ids = [...picked];
    const { mailErrors } = await api.assignDuty(week, ids, note, { quietly });
    if (mailErrors.length) toast(`Assigned, but the e-mail to ${mailErrors.map((m) => nameOf(m.person_id)).join(", ")} failed: ${mailErrors[0].error}`, "error");
    else toast(`${ids.map(nameOf).join(", ")} assigned${quietly ? " (no e-mail)" : " and e-mailed"}`);
    setPicked(new Set());
    reload();
  });
  const total = assigned.size + picked.size;

  return html`<${Modal} title=${`Assign · ${weekLabel(week)}`} onClose=${onClose} wide>
    <p class="lede" style="margin:6px 0 14px">${assigned.size} assigned${target ? ` of ${target}` : ""}. Tick everyone for this week, then assign them together: each e-mail names the others on duty.
      Sorted by availability, then by duties owed this round, then by who had duty longest ago.</p>
    <${CupLegend} />
    <div class="toolbar">
      <input data-search placeholder="Search name" value=${search} onInput=${(e) => setSearch(e.target.value)} />
      <input placeholder="Note for the e-mail (optional)" style="max-width:320px" value=${note} onInput=${(e) => setNote(e.target.value)} />
      <label class="check"><input type="checkbox" checked=${showAll} onChange=${(e) => setShowAll(e.target.checked)} /> Include people outside the duty pool</label>
      <span class="count">${people.length} people</span>
    </div>
    <div class="table-wrap" style="max-height:55vh;overflow-y:auto"><table class="data">
      <thead><tr><th>Name</th><th>Group</th><th>Availability</th><th class="num">Owed</th><th class="num">Done / target</th><th>Last duty</th><th></th></tr></thead>
      <tbody>${people.map((p) => {
        const a = avail.get(p.id);
        return html`<tr>
          <td>${personName(p)}${!p.has_account && html` <span class="badge" title="No account: they will only be e-mailed if an e-mail address is stored">no account</span>`}</td>
          <td>${p.group_name || ""}</td>
          <td><${StatusCup} state=${a?.status} label="" /> ${a ? statusLabel[a.status] : html`<span class="muted">no answer</span>`}
            ${a?.note && html`<div class="small muted">${a.note}</div>`}</td>
          <td class="num"><${Owed} n=${stats.get(p.id).owed} /></td>
          <td class="num small">${stats.get(p.id).done}${stats.get(p.id).scheduled ? ` + ${stats.get(p.id).scheduled}` : ""} / ${stats.get(p.id).target}</td>
          <td>${lastDuty.get(p.id) ? `Week ${isoWeek(lastDuty.get(p.id))}, ${lastDuty.get(p.id).slice(0, 4)}` : "—"}</td>
          <td class="num">${assigned.has(p.id)
            ? html`<span class="badge ok">assigned</span>`
            : html`<input type="checkbox" aria-label=${`Pick ${personName(p)}`} checked=${picked.has(p.id)} disabled=${busy} onChange=${() => toggle(p)} />`}</td>
        </tr>`;
      })}</tbody>
    </table></div>
    <div class="row" style="margin-top:14px">
      <span class="small muted">${picked.size ? `Picked: ${[...picked].map(nameOf).join(", ")}` : "Nobody picked yet."}</span>
      <span class="spacer"></span>
      ${target > 0 && total > target && html`<span class="badge warn">${total} of ${target} per week</span>`}
      <button class="btn" disabled=${busy || !picked.size} title="Assign without sending an e-mail" onClick=${() => assign(true)}>Assign quietly</button>
      <button class="btn primary" disabled=${busy || !picked.size} onClick=${() => assign()}>${picked.size > 1 ? `Assign ${picked.size} people and e-mail them` : "Assign and e-mail"}</button>
    </div>
  <//>`;
}

function AvailabilityMatrix({ data, weeks, settings, reload }) {
  const { weeksAhead, minWeeks, requiredFor } = availabilityRules(settings);
  const [missingFirst, setMissingFirst] = useState(true);
  const [editing, setEditing] = useState(null);
  const mandatory = new Set(weeksFrom(weeksAhead));
  const thisWeek = mondayOf();
  const key = (pid, w) => `${pid}|${w}`;
  const map = new Map(data.availability.map((a) => [key(a.person_id, a.week_start), a]));
  for (const w of data.free.keys()) mandatory.delete(w);
  const missingCount = (p) => (p.has_account ? [...mandatory].filter((w) => !map.has(key(p.id, w))).length : 0);
  const [q, setQ] = useState("");
  let people = sortPeople(searchPeople(data.people.filter((p) => requiredFor === "all" || p.active_duty), q), "group");
  if (missingFirst) people = [...people].sort((a, b) => missingCount(b) - missingCount(a));
  const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  return html`<div>
    <div class="toolbar">
      <${CupLegend} />
      <${SearchBox} q=${q} setQ=${setQ} />
      <label class="check"><input type="checkbox" checked=${missingFirst} onChange=${(e) => setMissingFirst(e.target.checked)} /> Missing answers first</label>
      <span class="count">${requiredFor === "all" ? "Every connected account" : "Everyone in the duty pool"} answers ${weeksAhead} week${weeksAhead === 1 ? "" : "s"} ahead
        and is asked again once fewer than ${minWeeks} are answered · ${people.length} people · click a name or week to change it</span>
    </div>
    <div class="table-wrap"><table class="data matrix">
      <thead><tr><th scope="col"><div class="name-cell">Name</div></th><th class="num" scope="col" title=${`Unanswered weeks among the next ${weeksAhead}`}>Missing</th>${weeks.map((w) => html`<th class="week ${w === thisWeek ? "current" : ""}" scope="col">
        <span class="wk">W${isoWeek(w)}<small>${short.format(new Date(`${w}T00:00:00`))}</small></span></th>`)}</tr></thead>
      <tbody>${people.length === 0 && html`<tr><td colspan=${weeks.length + 2} class="muted">No one matches “${q}”.</td></tr>`}
      ${people.map((p) => {
        const m = missingCount(p);
        return html`<tr>
          <td><div class="name-cell"><button class="btn-text" style="text-align:left;padding:0" title="Change their availability" onClick=${() => setEditing(p)}>${personName(p)}</button>
            <small>${[p.group_name, !p.has_account && "no account"].filter(Boolean).join(" · ")}</small></div></td>
          <td class="num ${m ? "neg" : "zero"}">${p.has_account ? m : "—"}</td>
          ${weeks.map((w) => {
            if (data.free.has(w)) return html`<td class="week free" title=${`${weekLabel(w)}: no kitchen duty`}>–</td>`;
            const a = map.get(key(p.id, w));
            const word = a ? `${statusLabel[a.status]}${a.note ? `: ${a.note}` : ""}` : "No answer";
            return html`<td class="week ${w === thisWeek ? "current" : ""}" style="cursor:pointer" title=${`${word} · click to change`} onClick=${() => setEditing(p)}><${StatusCup} state=${a?.status} label=${`${weekLabel(w)}: ${word}`} /></td>`;
          })}
        </tr>`;
      })}</tbody>
    </table></div>
    ${editing && html`<${EditAvailabilityModal} person=${editing} weeks=${weeks.filter((w) => w >= thisWeek)} data=${data}
      onClose=${() => setEditing(null)} reload=${reload} />`}
  </div>`;
}

const Owed = ({ n }) => html`<span class=${`badge ${owedTone(n)}`} title=${n > 0 ? `${n} more this round` : n < 0 ? `${-n} ahead` : "Done for this round"}>${n}</span>`;

/** Duty pool: who is in it, and (by rounds, as in the old sheet) who has done their share. Targets can be adjusted per person. */
function Rounds({ data, app, reload }) {
  const round = dutyRound(app.settings);
  const [busy, run] = useBusy();
  const [showAll, setShowAll] = useState(false);
  const stats = dutyStats(data.people, data.duties, round);
  const pool = data.people.filter((p) => p.active_duty);
  const [q, setQ] = useState("");
  // A search looks through everyone, so someone outside the pool can be found and added.
  const people = sortPeople(q.trim() ? searchPeople(data.people, q) : showAll ? data.people : pool, "last").sort((a, b) => stats.get(b.id).owed - stats.get(a.id).owed);
  const behind = pool.filter((p) => stats.get(p.id).owed > 0).length;
  const nextRound = () => run(async () => {
    await api.saveSetting("duty", { ...app.settings.duty, round: round + 1 });
    toast(`Round ${round + 1} started: everyone in the pool owes one more duty`);
    await app.refresh();
  });
  const setPool = (p, inPool) => run(async () => {
    await api.setDutyPool(p.id, inPool);
    toast(`${personName(p)} ${inPool ? "added to" : "taken out of"} the duty pool`);
    reload();
  });
  const setTarget = (p, value) => {
    const target = Math.round(Number(value));
    if (!Number.isFinite(target) || target < 0 || target === stats.get(p.id).target) return;
    run(async () => { await api.setDutyTarget(p.id, target); toast(`${personName(p)}: target ${target}`); reload(); });
  };
  return html`<div>
    <p class="lede" style="margin-bottom:14px">Who is in the duty pool, and whether they have done their share. Tick <b>In pool</b> to add or remove
      someone; to find people outside the pool, search for them or show them all with the switch. Each round, everyone in the pool does one kitchen duty;
      people who joined later owe only the rounds since. Change a target where someone should do more or fewer. <b>Owed</b> = target − done − scheduled.</p>
    <div class="toolbar">
      <${SearchBox} q=${q} setQ=${setQ} />
      <span><b>Round ${round}</b> · ${behind ? `${behind} of ${pool.length} still owe a duty` : "everyone has done their share"}</span>
      <${ConfirmAction} label=${`Start round ${round + 1}`} question=${`Start round ${round + 1}? Everyone in the pool then owes one more duty.`}
        disabled=${busy} onConfirm=${nextRound} />
      <span class="spacer"></span>
      <label class="check"><input type="checkbox" checked=${showAll} onChange=${(e) => setShowAll(e.target.checked)} /> Include people outside the pool</label>
    </div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th class="center">In pool</th><th>Name</th><th>Group</th><th class="num">Done</th><th class="num">Scheduled</th><th class="num">Target</th><th class="num">Owed</th></tr></thead>
      <tbody>${people.length === 0 && html`<tr><td colspan="7" class="muted">No one matches “${q}”.</td></tr>`}
      ${people.map((p) => {
        const s = stats.get(p.id);
        return html`<tr key=${p.id} class=${p.active_duty ? "" : "inactive"}>
          <td class="center"><input type="checkbox" aria-label=${`${personName(p)} in the duty pool`} checked=${p.active_duty} disabled=${busy}
            onChange=${(e) => setPool(p, e.target.checked)} /></td>
          <td>${personName(p)}</td><td>${p.group_name || ""}</td>
          <td class="num" title=${p.duty_carryover ? `Including ${p.duty_carryover} from before the app` : undefined}>${s.done}</td>
          <td class="num ${s.scheduled ? "" : "zero"}">${s.scheduled}</td>
          <td class="num"><input class="target-input" type="number" min="0" step="1" value=${s.target} disabled=${busy}
            aria-label=${`Target for ${personName(p)}`}
            onChange=${(e) => setTarget(p, e.target.value)} onKeyDown=${(e) => e.key === "Enter" && e.target.blur()} /></td>
          <td class="num"><${Owed} n=${s.owed} /></td>
        </tr>`;
      })}</tbody>
    </table></div>
  </div>`;
}


/** Kitchen-duty settings: the "availability" and "duty" settings, editable by duty managers and admins. */
function DutySettings({ app }) {
  const [a, setA] = useState(() => ({ weeks_ahead: 6, min_weeks: 3, required_for: "active", ...app.settings.availability }));
  const [d, setD] = useState(() => ({ people_per_week: 2, reminders: true, ...app.settings.duty }));
  const [busy, run] = useBusy();
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const weeksAhead = Math.max(1, Math.round(Number(a.weeks_ahead)) || 6);
      await api.saveSetting("availability", { ...app.settings.availability, ...a, weeks_ahead: weeksAhead,
        min_weeks: Math.min(weeksAhead, Math.max(1, Math.round(Number(a.min_weeks)) || 3)) });
      // Keep the round and anything else stored with "duty".
      await api.saveSetting("duty", { ...app.settings.duty, people_per_week: Math.max(0, Math.round(Number(d.people_per_week)) || 0), reminders: !!d.reminders });
      toast("Kitchen-duty settings saved");
      await app.refresh();
    });
  };
  return html`<form class="card" style="max-width:720px" onSubmit=${save}>
    <div class="grid">
      <div class="form-grid">
        <${Field} label="Weeks people fill in ahead"><input type="number" min="1" max="26" value=${a.weeks_ahead} onInput=${(e) => setA({ ...a, weeks_ahead: e.target.value })} /><//>
        <${Field} label="Minimum weeks answered" hint="Only once fewer weeks are answered are people asked again, then up to the weeks ahead.">
          <input type="number" min="1" max="26" value=${a.min_weeks} onInput=${(e) => setA({ ...a, min_weeks: e.target.value })} /><//>
        <${Field} label="People per week (target)"><input type="number" min="0" max="10" value=${d.people_per_week} onInput=${(e) => setD({ ...d, people_per_week: e.target.value })} /><//>
      </div>
      <${Field} label="Availability is mandatory for">
        <select value=${a.required_for} onChange=${(e) => setA({ ...a, required_for: e.target.value })}>
          <option value="active">Everyone in the kitchen-duty pool</option>
          <option value="all">Every connected account</option>
        </select><//>
      <label class="check"><input type="checkbox" checked=${d.reminders} onChange=${(e) => setD({ ...d, reminders: e.target.checked })} />
        Remind people on duty at the start of their week (Monday mornings)</label>
      <p class="small muted" style="margin:0">Availability reminders go out only when you send them, with <b>Availability reminders…</b> above.
        The duty round is on the <a href="#/duties?tab=rounds">Duty pool</a> tab; the e-mail texts are under <a href="#/emails">E-mails</a>.</p>
      <div class="row end"><button class="btn primary" disabled=${busy}>Save kitchen-duty settings</button></div>
    </div>
  </form>`;
}
