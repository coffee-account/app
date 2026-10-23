import { html, useState, useEffect, useLoad, Loading, Field, toast, useBusy, fmtEUR } from "../lib/ui.js";
import * as api from "../lib/api.js";
import { sortPeople, priceAt, personName } from "../lib/accounting.js";
import { isoDate, fmtDate } from "../lib/dates.js";

const KIND_LABEL = { coffee: "Coffee", drinks: "Drinks" };

export function CountingPage() {
  const state = useLoad(async () => {
    const data = await api.loadLedgerData();
    return data;
  });
  const [editing, setEditing] = useState(null);

  if (editing) {
    return html`<${Loading} state=${state}>${(data) => html`<${SessionEditor} session=${editing} data=${data}
      onClose=${() => { setEditing(null); state.reload(); }} />`}<//>`;
  }
  return html`
    <div class="page-head"><div><h1>Counting</h1><p>Type in the marks from a paper list after collecting it. Each session is one list collection on one date.</p></div>
      <div class="row">
        <button class="btn primary" onClick=${() => setEditing({ kind: "coffee", session_date: isoDate() })}>New coffee count</button>
        <button class="btn primary" onClick=${() => setEditing({ kind: "drinks", session_date: isoDate() })}>New drinks count</button>
      </div></div>
    <${Loading} state=${state}>${(data) => {
      const sessions = [...data.sessions].sort((a, b) => b.session_date.localeCompare(a.session_date));
      if (!sessions.length) return html`<p class="muted">No counts yet.</p>`;
      return html`<div class="table-wrap"><table class="data">
        <thead><tr><th>Date</th><th>List</th><th class="num">People</th><th class="num">Marks</th><th class="num">Price</th><th class="num">Value</th><th>Note</th><th></th></tr></thead>
        <tbody>${sessions.map((s) => {
          const rows = data.counts.filter((c) => c.session_id === s.id && c.quantity > 0);
          const marks = rows.reduce((n, c) => n + c.quantity, 0);
          const unit = priceAt(data.prices, s.kind, s.session_date);
          return html`<tr>
            <td>${fmtDate(s.session_date)}</td><td><span class="badge ${s.kind === "coffee" ? "accent" : ""}">${KIND_LABEL[s.kind]}</span></td>
            <td class="num">${rows.length}</td><td class="num">${marks}</td><td class="num">${fmtEUR(unit)}</td><td class="num">${fmtEUR(marks * unit)}</td>
            <td class="small muted">${s.note || ""}</td>
            <td class="num"><button class="btn small" onClick=${() => setEditing(s)}>Open</button></td>
          </tr>`;
        })}</tbody>
      </table></div>`;
    }}<//>`;
}

function SessionEditor({ session, data, onClose }) {
  const [meta, setMeta] = useState({ ...session });
  const [values, setValues] = useState(() => new Map(
    data.counts.filter((c) => c.session_id === session.id).map((c) => [c.person_id, c.quantity]),
  ));
  const [extra, setExtra] = useState([]);
  const [busy, run] = useBusy();
  const flag = meta.kind === "coffee" ? "active_coffee" : "active_drinks";
  const listed = sortPeople(data.people.filter((p) => p[flag] || values.has(p.id) || extra.includes(p.id)), "group");
  const others = sortPeople(data.people.filter((p) => !listed.includes(p)), "last");
  const unit = priceAt(data.prices, meta.kind, meta.session_date);
  const total = [...values.values()].reduce((n, v) => n + (Number(v) || 0), 0);
  const dirty = useDirtyGuard();

  const setQty = (id, v) => {
    dirty.mark();
    setValues((m) => { const n = new Map(m); n.set(id, v === "" ? 0 : Math.max(0, Math.round(Number(v)) || 0)); return n; });
  };
  const save = () => run(async () => {
    const counts = new Map(listed.map((p) => [p.id, values.get(p.id) || 0]));
    await api.saveSession(meta, counts);
    dirty.clear();
    toast("Counts saved");
    onClose();
  });
  const remove = () => confirm("Delete this whole count session?") && run(async () => {
    await api.deleteSession(meta.id);
    dirty.clear();
    toast("Deleted");
    onClose();
  });

  // Enter moves to the next input, like a spreadsheet.
  const onKey = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const inputs = [...document.querySelectorAll("input[data-count]")];
    inputs[inputs.indexOf(e.target) + 1]?.focus();
  };

  let lastGroup = null;
  return html`
    <div class="page-head"><div><h1>${meta.id ? "Edit" : "New"} ${KIND_LABEL[meta.kind].toLowerCase()} count</h1>
      <p>Same order as the printed list. Enter jumps to the next person; empty means 0.</p></div>
      <button class="btn" onClick=${() => (!dirty.is() || confirm("Discard unsaved changes?")) && (dirty.clear(), onClose())}>Back</button></div>
    <div class="card"><div class="form-grid">
      <${Field} label="List"><select value=${meta.kind} disabled=${!!meta.id} onChange=${(e) => setMeta({ ...meta, kind: e.target.value })}>
        <option value="coffee">Coffee</option><option value="drinks">Drinks</option></select><//>
      <${Field} label="Date collected"><input type="date" value=${meta.session_date} onInput=${(e) => { dirty.mark(); setMeta({ ...meta, session_date: e.target.value }); }} /><//>
      <${Field} label="Note"><input value=${meta.note || ""} onInput=${(e) => { dirty.mark(); setMeta({ ...meta, note: e.target.value }); }} /><//>
      <div><div class="stat-label">Total</div><div class="stat">${total} × ${fmtEUR(unit)} = ${fmtEUR(total * unit)}</div></div>
    </div></div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Name</th><th>Group</th><th class="num">Marks</th><th class="num">Amount</th></tr></thead>
      <tbody>${listed.map((p) => {
        const header = p.group_name !== lastGroup ? html`<tr class="group-row"><td colspan="4">${p.group_name || "No group"}</td></tr>` : null;
        lastGroup = p.group_name;
        const v = values.get(p.id) || 0;
        return html`${header}<tr class=${p[flag] ? "" : "inactive"}>
          <td>${p.last_name}, ${p.first_name}${!p[flag] && html` <span class="badge">not on list</span>`}</td><td>${p.group_name || ""}</td>
          <td class="num"><input type="number" min="0" step="1" data-count value=${v || ""} aria-label=${`Marks for ${personName(p)}`}
            onInput=${(e) => setQty(p.id, e.target.value)} onKeyDown=${onKey} /></td>
          <td class="num">${v ? fmtEUR(v * unit) : ""}</td></tr>`;
      })}</tbody>
    </table></div>
    <div class="row" style="margin-top:12px">
      <select style="max-width:280px" onChange=${(e) => { if (e.target.value) { setExtra([...extra, e.target.value]); e.target.value = ""; } }}>
        <option value="">+ Add someone not on this list…</option>
        ${others.map((p) => html`<option value=${p.id}>${p.last_name}, ${p.first_name}</option>`)}
      </select>
      <span class="spacer"></span>
      ${meta.id && html`<button class="btn danger" disabled=${busy} onClick=${remove}>Delete session</button>`}
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
