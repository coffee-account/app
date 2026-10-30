import { html, useState, useMemo, useEffect, useLoad, Loading, Modal, toast, useBusy, ConfirmAction, deferDelete, usePendingDeletes, loadQrCode, downloadBlob } from "../lib/ui.js";
import { matchSheetRow } from "../lib/duty-import.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { personName, sortPeople, availabilityRules, dutyStats, dutyRound, owedTone } from "../lib/accounting.js";
import { weeksFrom, weekLabel, mondayOf, addDays, isoWeek, fmtDate } from "../lib/dates.js";
import { STATUS } from "./availability.js";
import { StatusCup, CupLegend, EmptyState, WeekCalendar } from "../lib/drawings.js";

const STATUS_ORDER = { available: 0, if_needed: 1, undefined: 2, unavailable: 3 };
const statusLabel = Object.fromEntries(STATUS);

export function DutiesPage() {
  const app = useApp();
  const manager = app.canManageDuties;
  const [span, setSpan] = useState(12);
  const [tab, setTab] = useState("schedule");
  const weeks = weeksFrom(span, addDays(mondayOf(), -7));
  const state = useLoad(async () => {
    const [people, duties, availability, freeWeeks, guests] = await Promise.all([
      api.listDirectory(),
      manager ? api.listAllDuties() : api.listDuties(weeks[0], weeks[weeks.length - 1]),
      manager ? api.listAvailability(weeks[0], weeks[weeks.length - 1]) : Promise.resolve([]),
      api.listDutyFreeWeeks(),
      manager ? api.listGuestAvailability() : Promise.resolve([]),
    ]);
    return { people, duties, availability, guests, free: new Map(freeWeeks.map((f) => [f.week_start, f])) };
  }, [span, manager]);
  const [assigning, setAssigning] = useState(null);
  const [showQr, setShowQr] = useState(false);

  return html`
    <div class="page-head"><div><h1>Kitchen duty</h1>
      <p>${manager ? "Assign people per week; each assignment e-mails them straight away." : "Who is on kitchen duty when."}</p></div>
      <div class="row">
        ${manager && html`<button class="btn" onClick=${() => setShowQr(true)}>Guest QR code</button>`}
        ${app.isAdmin && html`<${RemindButton} />`}</div>
    </div>
    ${showQr && html`<${GuestQr} onClose=${() => setShowQr(false)} />`}
    ${manager && html`<div class="tabs">
      <button class=${tab === "schedule" ? "active" : ""} onClick=${() => setTab("schedule")}>Schedule</button>
      <button class=${tab === "matrix" ? "active" : ""} onClick=${() => setTab("matrix")}>Availability overview${state.data?.guests.length ? ` (${state.data.guests.length} to connect)` : ""}</button>
      <button class=${tab === "rounds" ? "active" : ""} onClick=${() => setTab("rounds")}>Rounds</button>
    </div>`}
    <${Loading} state=${state}>${(data) => tab === "matrix" && manager
      ? html`<div><${GuestQueue} data=${data} app=${app} reload=${state.reload} /><${AvailabilityMatrix} data=${data} weeks=${weeks.slice(1)} settings=${app.settings} /></div>`
      : tab === "rounds" && manager ? html`<${Rounds} data=${data} app=${app} reload=${state.reload} />`
      : html`<${Schedule} data=${data} weeks=${weeks} manager=${manager} app=${app}
          onAssign=${setAssigning} reload=${state.reload} />`}<//>
    <div class="row" style="margin-top:12px;gap:18px">
      <button class="btn-text" onClick=${() => setSpan(span + 8)}>Show 8 more weeks</button>
      ${span > 12 && html`<button class="btn-text" onClick=${() => setSpan(Math.max(12, span - 8))}>Show 8 fewer weeks</button>`}
    </div>
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
          return html`<span class="chip" title=${a.notify_error ? `E-mail failed: ${a.notify_error}` : a.notified_at ? "E-mail sent" : ""}>
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

  const assign = (p) => run(async () => {
    const { mailError } = await api.assignDuty(week, p.id, note);
    if (mailError) toast(`${personName(p)} assigned, but the e-mail failed: ${mailError}`, "error");
    else toast(`${personName(p)} assigned and notified`);
    reload();
  });

  return html`<${Modal} title=${`Assign · ${weekLabel(week)}`} onClose=${onClose} wide>
    <p class="lede" style="margin:6px 0 14px">${assigned.size} assigned${target ? ` of ${target}` : ""}. Sorted by availability, then by duties owed this round, then by who had duty longest ago.</p>
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
            : html`<button class="btn small" disabled=${busy} onClick=${() => assign(p)}>Assign</button>`}</td>
        </tr>`;
      })}</tbody>
    </table></div>
  <//>`;
}

function AvailabilityMatrix({ data, weeks, settings }) {
  const { weeksAhead, requiredFor } = availabilityRules(settings);
  const [missingFirst, setMissingFirst] = useState(true);
  const mandatory = new Set(weeksFrom(weeksAhead));
  const thisWeek = mondayOf();
  const key = (pid, w) => `${pid}|${w}`;
  const map = new Map(data.availability.map((a) => [key(a.person_id, a.week_start), a]));
  for (const w of data.free.keys()) mandatory.delete(w);
  const missingCount = (p) => (p.has_account ? [...mandatory].filter((w) => !map.has(key(p.id, w))).length : 0);
  let people = sortPeople(data.people.filter((p) => requiredFor === "all" || p.active_duty), "group");
  if (missingFirst) people = [...people].sort((a, b) => missingCount(b) - missingCount(a));
  const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  return html`<div>
    <div class="toolbar">
      <${CupLegend} />
      <label class="check"><input type="checkbox" checked=${missingFirst} onChange=${(e) => setMissingFirst(e.target.checked)} /> Missing answers first</label>
      <span class="count">Required: the next ${weeksAhead} weeks · ${people.length} people</span>
    </div>
    <div class="table-wrap"><table class="data matrix">
      <thead><tr><th scope="col"><div class="name-cell">Name</div></th><th class="num" scope="col">Missing</th>${weeks.map((w) => html`<th class="week ${w === thisWeek ? "current" : ""}" scope="col">
        <span class="wk">W${isoWeek(w)}<small>${short.format(new Date(`${w}T00:00:00`))}</small></span></th>`)}</tr></thead>
      <tbody>${people.map((p) => {
        const m = missingCount(p);
        return html`<tr>
          <td><div class="name-cell"><span>${personName(p)}</span>
            <small>${[p.group_name, !p.has_account && "no account"].filter(Boolean).join(" · ")}</small></div></td>
          <td class="num ${m ? "neg" : "zero"}">${p.has_account ? m : "—"}</td>
          ${weeks.map((w) => {
            if (data.free.has(w)) return html`<td class="week free" title=${`${weekLabel(w)}: no kitchen duty`}>–</td>`;
            const a = map.get(key(p.id, w));
            const word = a ? `${statusLabel[a.status]}${a.note ? `: ${a.note}` : ""}` : "No answer";
            return html`<td class="week ${w === thisWeek ? "current" : ""}"><${StatusCup} state=${a?.status} label=${`${weekLabel(w)}: ${word}`} /></td>`;
          })}
        </tr>`;
      })}</tbody>
    </table></div>
  </div>`;
}

const Owed = ({ n }) => html`<span class=${`badge ${owedTone(n)}`} title=${n > 0 ? `${n} more this round` : n < 0 ? `${-n} ahead` : "Done for this round"}>${n}</span>`;

/** Rounds, as in the old sheet: who has done their share, who is behind. Targets can be adjusted per person. */
function Rounds({ data, app, reload }) {
  const round = dutyRound(app.settings);
  const [busy, run] = useBusy();
  const [showAll, setShowAll] = useState(false);
  const stats = dutyStats(data.people, data.duties, round);
  const pool = data.people.filter((p) => p.active_duty);
  const people = sortPeople(showAll ? data.people : pool, "last").sort((a, b) => stats.get(b.id).owed - stats.get(a.id).owed);
  const behind = pool.filter((p) => stats.get(p.id).owed > 0).length;
  const nextRound = () => run(async () => {
    await api.saveSetting("duty", { ...app.settings.duty, round: round + 1 });
    toast(`Round ${round + 1} started: everyone in the pool owes one more duty`);
    await app.refresh();
  });
  const setTarget = (p, value) => {
    const target = Math.round(Number(value));
    if (!Number.isFinite(target) || target < 0 || target === stats.get(p.id).target) return;
    run(async () => { await api.setDutyTarget(p.id, target); toast(`${personName(p)}: target ${target}`); reload(); });
  };
  return html`<div>
    <p class="lede" style="margin-bottom:14px">Each round, everyone in the duty pool does one kitchen duty. People who joined later owe only the rounds since;
      change a target where someone should do more or fewer. <b>Owed</b> = target − done − scheduled.</p>
    <div class="toolbar">
      <span><b>Round ${round}</b> · ${behind ? `${behind} of ${pool.length} still owe a duty` : "everyone has done their share"}</span>
      <${ConfirmAction} label=${`Start round ${round + 1}`} question=${`Start round ${round + 1}? Everyone in the pool then owes one more duty.`}
        disabled=${busy} onConfirm=${nextRound} />
      <span class="spacer"></span>
      <label class="check"><input type="checkbox" checked=${showAll} onChange=${(e) => setShowAll(e.target.checked)} /> Include people outside the pool</label>
    </div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Name</th><th>Group</th><th class="num">Done</th><th class="num">Scheduled</th><th class="num">Target</th><th class="num">Owed</th></tr></thead>
      <tbody>${people.map((p) => {
        const s = stats.get(p.id);
        return html`<tr key=${p.id} class=${p.active_duty ? "" : "inactive"}>
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

/** QR code (and link) to the availability form that works without an account, for posters and lists. */
function GuestQr({ onClose }) {
  const link = api.guestLink();
  const [svg, setSvg] = useState("");
  useEffect(() => {
    loadQrCode().then((qrcode) => {
      const qr = qrcode(0, "M");
      qr.addData(link);
      qr.make();
      setSvg(qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true }));
    }).catch((e) => toast(`Could not create the QR code: ${e.message}`, "error"));
  }, [link]);
  const copy = () => navigator.clipboard.writeText(link).then(() => toast("Link copied"), () => toast(link));
  return html`<${Modal} title="Availability without an account" onClose=${onClose}>
    <p class="lede" style="margin:4px 0 14px">Anyone can scan this to fill in their kitchen-duty availability with their name and group.
      Answers only fill in weeks they haven't answered yet; names the app doesn't know wait here for you to connect.</p>
    <div class="qr-box">
      ${svg ? html`<div dangerouslySetInnerHTML=${{ __html: svg }} />` : html`<p class="muted">Creating QR code…</p>`}
      <code class="small" style="word-break:break-all">${link}</code>
      <div class="row">
        <button class="btn" onClick=${copy}>Copy link</button>
        <button class="btn" disabled=${!svg} onClick=${() => downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "availability-qr.svg")}>Download (SVG)</button>
      </div>
    </div>
  <//>`;
}

/** Availability sent through the guest form by names the app couldn't place. */
function GuestQueue({ data, app, reload }) {
  const [busy, run] = useBusy();
  const people = useMemo(() => sortPeople(data.people, "last"), [data.people]);
  const [pick, setPick] = useState({});
  if (!data.guests.length) return null;
  const canCreate = app.isAdmin || app.isGroupAdmin;
  const suggestion = (g) => matchSheetRow({ last: g.last_name, first: g.first_name, carryover: 0 }, data.people).personId || "";
  const connect = (g, personId, name) => run(async () => {
    await api.connectGuestAvailability(g, personId);
    toast(`Availability of ${g.first_name} ${g.last_name} given to ${name}`);
    reload();
  });
  const create = (g) => run(async () => {
    const p = await api.savePerson({ first_name: g.first_name, last_name: g.last_name, group_name: g.group_name || null,
      active_coffee: false, active_drinks: false, active_duty: true, duty_rounds_before: dutyRound(app.settings) });
    await api.connectGuestAvailability(g, p.id);
    toast(`${g.first_name} ${g.last_name} added to the duty pool`);
    reload();
  });
  const dismiss = (g) => run(async () => { await api.dismissGuestAvailability(g.id); reload(); });
  return html`<div class="card">
    <h2>Guest answers to connect (${data.guests.length})</h2>
    <p class="small muted">Sent with the QR-code form under names the app doesn't know (yet). Connecting fills in only weeks the person hasn't answered.</p>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Name given</th><th>Sent</th><th class="num">Weeks</th><th>Person</th><th></th></tr></thead>
      <tbody>${data.guests.map((g) => {
        const chosen = pick[g.id] ?? suggestion(g);
        const person = people.find((p) => p.id === chosen);
        return html`<tr key=${g.id}>
          <td>${g.first_name} ${g.last_name}<div class="small muted">${g.group_name || "no group"}</div></td>
          <td>${fmtDate(g.created_at.slice(0, 10))}</td>
          <td class="num">${g.answers.length}</td>
          <td><select style="width:auto;max-width:240px" value=${chosen} aria-label=${`Person for ${g.first_name} ${g.last_name}`}
            onChange=${(e) => setPick({ ...pick, [g.id]: e.target.value })}>
            <option value="">Choose person…</option>
            ${people.map((p) => html`<option value=${p.id}>${p.last_name}, ${p.first_name}${p.group_name ? ` (${p.group_name})` : ""}</option>`)}
          </select></td>
          <td class="num"><span class="row end" style="gap:8px;flex-wrap:nowrap">
            <button class="btn small primary" disabled=${busy || !person} onClick=${() => connect(g, person.id, personName(person))}>Connect</button>
            ${canCreate && html`<button class="btn small" disabled=${busy} onClick=${() => create(g)}>New person</button>`}
            <${ConfirmAction} label="Dismiss" question="Dismiss these answers?" disabled=${busy} onConfirm=${() => dismiss(g)} /></span></td>
        </tr>`;
      })}</tbody>
    </table></div>
  </div>`;
}
