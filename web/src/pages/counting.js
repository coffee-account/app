import { html, useState, useEffect, useLoad, Loading, Field, toast, useBusy, fmtEUR, ConfirmAction, deferDelete, usePendingDeletes } from "../lib/ui.js";
import { EmptyState, TallySheet } from "../lib/drawings.js";
import * as api from "../lib/api.js";
import { sortPeople, priceAt, personName } from "../lib/accounting.js";
import { isoDate, fmtDate } from "../lib/dates.js";
import { useApp } from "../lib/context.js";

const KIND_LABEL = { coffee: "Coffee", drinks: "Drinks" };

export function CountingPage() {
  const app = useApp();
  const group = app.isAdmin ? null : app.managedGroup; // group admins count their group only
  const state = useLoad(async () => {
    const [ledger, directory, groups, counted] = await Promise.all([
      api.loadLedgerData(undefined, group), api.listDirectory(), api.listGroups(), api.listCountedGroups(),
    ]);
    return { ...ledger, directory, groups, counted };
  });
  const [editing, setEditing] = useState(null);
  const isPending = usePendingDeletes();

  if (editing) {
    return html`<${Loading} state=${state}>${(data) => html`<${SessionEditor} session=${editing} data=${data}
      onClose=${() => { setEditing(null); state.reload(); }} onReload=${state.reload} />`}<//>`;
  }
  return html`
    <div class="page-head"><div><h1>Counting</h1><p>Type in the marks from a collected paper list, one session per list and date.</p></div>
      <div class="row">
        <button class="btn" onClick=${() => setEditing({ kind: "drinks", session_date: isoDate() })}>New drinks count</button>
        <button class="btn primary" onClick=${() => setEditing({ kind: "coffee", session_date: isoDate() })}>New coffee count</button>
      </div></div>
    <${Loading} state=${state}>${(data) => {
      const sessions = [...data.sessions].filter((s) => !isPending(`session:${s.id}`)).sort((a, b) => b.session_date.localeCompare(a.session_date));
      if (!sessions.length) {
        return html`<${EmptyState} drawing=${html`<${TallySheet} />`}
          action=${html`<button class="btn primary" onClick=${() => setEditing({ kind: "coffee", session_date: isoDate() })}>New coffee count</button>`}>
          No counts yet. After collecting a paper list, enter its marks here.<//>`;
      }
      return html`<div class="table-wrap"><table class="data">
        <thead><tr><th>Date</th><th>List</th><th>Not counted yet</th><th class="num">People</th><th class="num">Marks</th><th class="num">Price</th><th class="num">Value</th><th>Note</th><th></th></tr></thead>
        <tbody>${sessions.map((s) => {
          const rows = data.counts.filter((c) => c.session_id === s.id && c.quantity > 0);
          const marks = rows.reduce((n, c) => n + c.quantity, 0);
          const unit = priceAt(data.prices, s.kind, s.session_date);
          return html`<tr style="cursor:pointer" tabindex="0" onClick=${() => setEditing(s)} onKeyDown=${(e) => e.key === "Enter" && setEditing(s)}>
            <td>${fmtDate(s.session_date)}</td><td><span class="badge">${KIND_LABEL[s.kind]}</span></td>
            <td><${MissingGroups} session=${s} data=${data} /></td>
            <td class="num">${rows.length}</td><td class="num">${marks}</td><td class="num">${fmtEUR(unit)}</td><td class="num">${fmtEUR(marks * unit)}</td>
            <td class="small muted">${s.note || ""}</td>
            <td class="num"><span class="row-actions"><button class="btn-text">Open</button></span></td>
          </tr>`;
        })}</tbody>
      </table></div>`;
    }}<//>`;
}

/** Groups with someone on this session's list (coffee or drinks), and those already ticked as counted. */
function groupProgress(session, kind, data) {
  const active = (p) => (kind === "coffee" ? p.active_coffee : p.active_drinks);
  const onList = new Set(data.directory.filter(active).map((p) => p.group_name).filter(Boolean));
  const done = new Set(data.counted.filter((c) => c.session_id === session.id).map((c) => c.group_name));
  return { groups: data.groups.map((g) => g.name).filter((g) => onList.has(g) || done.has(g)), done };
}

/** Overview: only the groups still to be counted. */
function MissingGroups({ session, data }) {
  const { groups, done } = groupProgress(session, session.kind, data);
  const missing = groups.filter((g) => !done.has(g));
  if (!groups.length) return html`<span class="muted">—</span>`;
  if (!missing.length) return html`<span class="small pos">✓ all groups counted</span>`;
  return html`<div class="missing-groups">${missing.map((g) => html`<span class="badge warn">${g}</span>`)}</div>`;
}

function SessionEditor({ session, data, onClose, onReload }) {
  const app = useApp();
  // Sessions are shared by all groups: only admins change their date or note, or delete them.
  const lockSession = !app.isAdmin && !!session.id;
  const [meta, setMeta] = useState({ ...session });
  const [original] = useState(() => new Map(
    data.counts.filter((c) => c.session_id === session.id).map((c) => [c.person_id, c.quantity]),
  ));
  const [values, setValues] = useState(() => new Map(original));
  const [extra, setExtra] = useState([]);
  const [busy, run] = useBusy();
  // "Counted" ticks per group, saved together with the counts. Admins tick any group, group admins their own.
  const [doneBefore] = useState(() => groupProgress(session, session.kind, data).done);
  const [done, setDone] = useState(() => new Set(doneBefore));
  const mayTick = (g) => !!g && (app.isAdmin || g === app.managedGroup);
  const toggleDone = (g) => { dirty.mark(); setDone((d) => { const n = new Set(d); if (n.has(g)) n.delete(g); else n.add(g); return n; }); };
  const flag = meta.kind === "coffee" ? "active_coffee" : "active_drinks";
  const listed = sortPeople(data.people.filter((p) => p[flag] || values.has(p.id) || extra.includes(p.id)), "group");
  const others = sortPeople(data.people.filter((p) => !listed.includes(p)), "last");
  const unit = priceAt(data.prices, meta.kind, meta.session_date);
  const total = [...values.values()].reduce((n, v) => n + (Number(v) || 0), 0);
  const dirty = useDirtyGuard();
  const changed = new Set([...new Set([...values.keys(), ...original.keys()])]
    .filter((id) => (values.get(id) || 0) !== (original.get(id) || 0)));
  const ticksChanged = [...new Set([...done, ...doneBefore])].filter((g) => mayTick(g) && done.has(g) !== doneBefore.has(g));

  const setQty = (id, v) => {
    dirty.mark();
    setValues((m) => { const n = new Map(m); n.set(id, v === "" ? 0 : Math.max(0, Math.round(Number(v)) || 0)); return n; });
  };
  const save = () => run(async () => {
    const counts = new Map(listed.map((p) => [p.id, values.get(p.id) || 0]));
    const row = await api.saveSession(meta, counts, { editSession: app.isAdmin });
    for (const g of ticksChanged) await api.setGroupCounted(row.id, g, done.has(g));
    dirty.clear();
    toast("Counts saved");
    onClose();
  });
  const remove = () => {
    dirty.clear();
    deferDelete({ key: `session:${meta.id}`, message: "Count session deleted", commit: () => api.deleteSession(meta.id), onDone: onReload });
    onClose();
  };

  // Enter and the arrow keys move between people, like a spreadsheet.
  const onKey = (e) => {
    const step = e.key === "Enter" || e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const inputs = [...document.querySelectorAll("input[data-count]")];
    inputs[inputs.indexOf(e.target) + step]?.focus();
  };

  let lastGroup = null;
  return html`
    <div class="page-head"><div><h1>${meta.id ? "Edit" : "New"} ${KIND_LABEL[meta.kind].toLowerCase()} count</h1>
      <p>Same order as the printed list. Enter or the arrow keys move between people; empty means 0.</p></div>
      <button class="btn" onClick=${() => (!dirty.is() || confirm("Discard unsaved changes?")) && (dirty.clear(), onClose())}>Back</button></div>
    <div class="count-total">${total} × ${fmtEUR(unit)} = ${fmtEUR(total * unit)}</div>
    <div class="card"><div class="form-grid">
      <${Field} label="List"><select value=${meta.kind} disabled=${!!meta.id} onChange=${(e) => setMeta({ ...meta, kind: e.target.value })}>
        <option value="coffee">Coffee</option><option value="drinks">Drinks</option></select><//>
      <${Field} label="Date collected"><input type="date" value=${meta.session_date} disabled=${lockSession} onInput=${(e) => { dirty.mark(); setMeta({ ...meta, session_date: e.target.value }); }} /><//>
      <${Field} label="Note"><input value=${meta.note || ""} disabled=${lockSession} onInput=${(e) => { dirty.mark(); setMeta({ ...meta, note: e.target.value }); }} /><//>
    </div></div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Name</th><th>Group</th><th class="num">Marks</th><th class="num">Amount</th></tr></thead>
      <tbody>${listed.map((p) => {
        const g = p.group_name;
        const header = g !== lastGroup ? html`<tr class="group-row"><td colspan="3">${g || "No group"}</td>
          <td class="num">${mayTick(g) ? html`<label class="check group-done ${done.has(g) ? "on" : ""}"><input type="checkbox" checked=${done.has(g)}
              onChange=${() => toggleDone(g)} /> Counted</label>`
            : g && done.has(g) ? html`<span class="small pos">✓ counted</span>` : null}</td></tr>` : null;
        lastGroup = p.group_name;
        const v = values.get(p.id) || 0;
        return html`${header}<tr class=${p[flag] ? "" : "inactive"}>
          <td>${changed.has(p.id) && html`<span class="changed-dot" title="Changed, not saved"></span>`}${p.last_name}, ${p.first_name}${!p[flag] && html` <span class="badge">not on list</span>`}</td><td>${p.group_name || ""}</td>
          <td class="num"><input type="number" min="0" step="1" data-count placeholder="0" value=${v || ""} aria-label=${`Marks for ${personName(p)}`}
            onInput=${(e) => setQty(p.id, e.target.value)} onKeyDown=${onKey} /></td>
          <td class="num zero">${v ? fmtEUR(v * unit) : ""}</td></tr>`;
      })}</tbody>
    </table></div>
    <div class="row save-bar">
      <select style="max-width:280px" aria-label="Add someone" onChange=${(e) => { if (e.target.value) { setExtra([...extra, e.target.value]); e.target.value = ""; } }}>
        <option value="">+ Add someone not on this list…</option>
        ${others.map((p) => html`<option value=${p.id}>${p.last_name}, ${p.first_name}</option>`)}
      </select>
      <span class="spacer"></span>
      ${meta.id && app.isAdmin && html`<${ConfirmAction} label="Delete session" question="Delete this whole count session?" disabled=${busy} onConfirm=${remove} />`}
      ${changed.size + ticksChanged.length > 0 && html`<span class="small muted">${changed.size + ticksChanged.length} change${changed.size + ticksChanged.length > 1 ? "s" : ""} not saved</span>`}
      <button class="btn primary" disabled=${busy} onClick=${save}>Save counts</button>
    </div>
    `;
}

/** Warns before closing the tab with unsaved edits. */
function useDirtyGuard() {
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const on = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", on);
    return () => window.removeEventListener("beforeunload", on);
  }, [dirty]);
  return { mark: () => setDirty(true), clear: () => setDirty(false), is: () => dirty };
}
