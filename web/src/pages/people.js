import { html, useState, useLoad, Loading, Modal, Field, toast, useBusy, fmtEUR, ConfirmAction, usePersisted, deferDelete, usePendingDeletes } from "../lib/ui.js";
import * as api from "../lib/api.js";
import { personName, sortPeople } from "../lib/accounting.js";

export function PeoplePage() {
  const state = useLoad(async () => {
    const [people, groups, profiles] = await Promise.all([api.listPeople(), api.listGroups(), api.listProfiles()]);
    return { people, groups, profiles };
  });
  const [filter, setFilter] = usePersisted("people.filter", { q: "", group: "", status: "active" });
  const [editing, setEditing] = useState(null);
  const [busy, run] = useBusy();

  const toggle = (p, field) => run(async () => { await api.savePerson({ id: p.id, [field]: !p[field] }); state.reload(); });
  const isPending = usePendingDeletes();
  const remove = (p) => deferDelete({
    key: `person:${p.id}`, message: `${personName(p)} deleted`,
    commit: () => api.deletePerson(p.id), onDone: state.reload,
  });
  const invite = (p) => run(async () => { await api.invitePerson(p.id); toast(`Invitation sent to ${p.email}`); });

  return html`
    <div class="page-head"><div><h1>People</h1><p>Who is on the coffee and drinks lists. The two switches decide who gets printed.</p></div>
      <button class="btn primary" onClick=${() => setEditing({ active_coffee: true, active_drinks: false, starting_balance: 0 })}>Add person</button></div>
    <${Loading} state=${state}>${({ people, groups, profiles }) => {
      const account = new Map(profiles.filter((x) => x.person_id).map((x) => [x.person_id, x]));
      let rows = people.filter((p) => {
        if (isPending(`person:${p.id}`)) return false;
        const s = `${p.first_name} ${p.last_name} ${p.email || ""}`.toLowerCase();
        if (filter.q && !s.includes(filter.q.toLowerCase())) return false;
        if (filter.group && p.group_name !== filter.group) return false;
        if (filter.status === "active" && !p.active_coffee && !p.active_drinks) return false;
        if (filter.status === "inactive" && (p.active_coffee || p.active_drinks)) return false;
        return true;
      });
      rows = sortPeople(rows, "group");
      return html`
        <div class="toolbar">
          <input data-search placeholder="Search name  /" aria-label="Search name or e-mail" value=${filter.q} onInput=${(e) => setFilter({ ...filter, q: e.target.value })} />
          <select aria-label="Group" value=${filter.group} onChange=${(e) => setFilter({ ...filter, group: e.target.value })}>
            <option value="">All groups</option>${groups.map((g) => html`<option value=${g.name}>${g.name}</option>`)}</select>
          <select aria-label="Status" value=${filter.status} onChange=${(e) => setFilter({ ...filter, status: e.target.value })}>
            <option value="active">On a list</option><option value="inactive">Not on any list</option><option value="all">Everyone</option></select>
          <span class="count">${rows.length} shown · ${people.filter((p) => p.active_coffee).length} coffee · ${people.filter((p) => p.active_drinks).length} drinks</span>
        </div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Name</th><th>Group</th><th>E-mail</th><th class="center">Coffee</th><th class="center">Drinks</th><th class="num">Start balance</th><th>Account</th><th></th></tr></thead>
          <tbody>${rows.map((p) => html`<tr class=${p.active_coffee || p.active_drinks ? "" : "inactive"}>
            <td>${p.last_name}, ${p.first_name}</td>
            <td>${p.group_name || ""}</td>
            <td class="small">${p.email || ""}</td>
            <td class="center"><input type="checkbox" aria-label="Active for coffee" checked=${p.active_coffee} disabled=${busy} onChange=${() => toggle(p, "active_coffee")} /></td>
            <td class="center"><input type="checkbox" aria-label="Active for drinks" checked=${p.active_drinks} disabled=${busy} onChange=${() => toggle(p, "active_drinks")} /></td>
            <td class="num ${Number(p.starting_balance) < 0 ? "neg" : Number(p.starting_balance) ? "" : "zero"}">${fmtEUR(p.starting_balance)}</td>
            <td>${account.has(p.id) ? html`<span class="badge ok">linked</span>`
              : p.email ? html`<button class="btn-text" disabled=${busy} onClick=${() => invite(p)}>Invite</button>` : html`<span class="muted">—</span>`}</td>
            <td class="num"><span class="row-actions row end">
              <button class="btn-text" onClick=${() => setEditing(p)}>Edit</button>
              <${ConfirmAction} question=${`Delete ${p.first_name}?`} disabled=${busy} onConfirm=${() => remove(p)} /></span></td>
          </tr>`)}</tbody>
        </table></div>
        ${editing && html`<${PersonModal} person=${editing} groups=${groups} onClose=${() => setEditing(null)}
          onSaved=${() => { setEditing(null); state.reload(); }} />`}`;
    }}<//>`;
}

function PersonModal({ person, groups, onClose, onSaved }) {
  const [p, setP] = useState({ ...person });
  const [busy, run] = useBusy();
  const set = (k, v) => setP((x) => ({ ...x, [k]: v }));
  return html`<${Modal} title=${p.id ? "Edit person" : "Add person"} onClose=${onClose}>
    <form class="grid" onSubmit=${(e) => { e.preventDefault(); run(async () => { await api.savePerson({ ...p, starting_balance: Number(String(p.starting_balance).replace(",", ".")) || 0 }); toast("Saved"); onSaved(); }); }}>
      <div class="form-grid">
        <${Field} label="First name"><input required value=${p.first_name || ""} onInput=${(e) => set("first_name", e.target.value)} /><//>
        <${Field} label="Last name"><input required value=${p.last_name || ""} onInput=${(e) => set("last_name", e.target.value)} /><//>
        <${Field} label="Group"><select value=${p.group_name || ""} onChange=${(e) => set("group_name", e.target.value)}>
          <option value="">—</option>${groups.map((g) => html`<option value=${g.name}>${g.name}</option>`)}</select><//>
        <${Field} label="E-mail" hint="Used for duty e-mails, and to connect their account automatically when they register.">
          <input type="email" value=${p.email || ""} onInput=${(e) => set("email", e.target.value)} /><//>
        <${Field} label="Starting balance (€)"><input inputmode="decimal" value=${p.starting_balance ?? 0} onInput=${(e) => set("starting_balance", e.target.value)} /><//>
      </div>
      <div class="row">
        <label class="check"><input type="checkbox" checked=${p.active_coffee} onChange=${(e) => set("active_coffee", e.target.checked)} /> On the coffee list</label>
        <label class="check"><input type="checkbox" checked=${p.active_drinks} onChange=${(e) => set("active_drinks", e.target.checked)} /> On the drinks list</label>
      </div>
      <${Field} label="Notes"><textarea value=${p.notes || ""} onInput=${(e) => set("notes", e.target.value)}></textarea><//>
      <div class="row end"><button type="button" class="btn" onClick=${onClose}>Cancel</button><button class="btn primary" disabled=${busy}>Save</button></div>
    </form>
  <//>`;
}
