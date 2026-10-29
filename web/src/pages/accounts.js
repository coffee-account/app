import { html, useState, useLoad, Loading, toast, useBusy, ConfirmAction } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { personName, sortPeople } from "../lib/accounting.js";
import { fmtDate } from "../lib/dates.js";

const ROLE_LABEL = { admin: "Admin", group_admin: "Group admin", member: "Member" };

export function AccountsPage() {
  const app = useApp();
  const group = app.isAdmin ? null : app.managedGroup; // group admins only see their group
  const state = useLoad(async () => {
    const [profiles, people, groups] = await Promise.all([api.listProfiles(), api.listPeople(), app.isAdmin ? api.listGroups() : []]);
    // The database already limits a group admin's view; filtering here keeps the demo the same.
    const ofGroup = (pid) => people.find((p) => p.id === pid)?.group_name === group;
    return {
      profiles: group ? profiles.filter((p) => p.group_name === group || ofGroup(p.person_id) || ofGroup(p.suggested_person_id)) : profiles,
      people: group ? people.filter((p) => p.group_name === group) : people,
      groups,
    };
  });
  const [busy, run] = useBusy();
  const done = async (p, msg) => {
    toast(msg || "Saved");
    await state.reload();
    if (p.id === app.user.id) app.refresh();
  };
  const update = (p, patch, msg) => run(async () => { await api.updateProfile(p.id, patch); await done(p, msg); });
  const connect = (p, personId, msg) => run(async () => { await api.connectAccount(p.id, personId); await done(p, msg || "Connected"); });
  const disconnect = (p) => run(async () => { await api.disconnectAccount(p.id); await done(p, "Disconnected"); });

  return html`
    <div class="page-head"><div><h1>${group ? "Accounts" : "Accounts & roles"}</h1>
      <p>${group ? `Connect new accounts from ${group} to the right person on the list.`
        : "Anyone can register as a member. Connect each account to their entry on the list, and hand out roles and rights."}</p></div></div>
    <${Loading} state=${state}>${({ profiles, people, groups }) => {
      const byId = new Map(people.map((p) => [p.id, p]));
      const linked = new Set(profiles.map((p) => p.person_id).filter(Boolean));
      const free = sortPeople(people.filter((p) => !linked.has(p.id)), "last");
      const pending = profiles.filter((p) => !p.person_id);
      return html`<div>
        ${pending.length > 0 && html`<div class="card">
          <h2>Waiting to be connected (${pending.length})</h2>
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Account</th><th>Registered as</th><th>Connect to</th></tr></thead>
            <tbody>${pending.map((p) => {
              const s = p.suggested_person_id && byId.get(p.suggested_person_id);
              return html`<tr>
                <td>${p.email}<div class="small muted">${fmtDate(p.created_at?.slice(0, 10))}</div></td>
                <td>${p.first_name} ${p.last_name}<div class="small muted">${p.group_name || ""}</div></td>
                <td><div class="row">
                  ${s && html`<button class="btn small primary" disabled=${busy} onClick=${() => connect(p, s.id, `Connected to ${personName(s)}`)}>
                    Connect to ${personName(s)} (${s.group_name || "no group"})</button>`}
                  <${PersonSelect} free=${free} onPick=${(id) => connect(p, id)} />
                </div></td></tr>`;
            })}</tbody>
          </table></div></div>`}
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Account</th><th>Person</th><th>Role</th>
            ${!group && html`<th class="center">Upload invoices</th><th class="center">Manage kitchen duty</th><th class="center">Resolve reports</th>`}</tr></thead>
          <tbody>${profiles.map((p) => {
            const person = p.person_id && byId.get(p.person_id);
            return html`<tr key=${p.id}>
              <td>${p.email}${p.id === app.user.id && html` <span class="badge accent">you</span>`}</td>
              <td>${person ? html`${personName(person)} <${ConfirmAction} label="Disconnect" question="Disconnect account?" disabled=${busy} onConfirm=${() => disconnect(p)} />`
                : p.person_id ? html`<span class="muted">another group</span>`
                : html`<${PersonSelect} free=${free} onPick=${(id) => connect(p, id)} />`}</td>
              <td>${group ? html`${ROLE_LABEL[p.role]}${p.role === "group_admin" && p.managed_group ? ` · ${p.managed_group}` : ""}`
                : html`<${RoleEditor} p=${p} groups=${groups} busy=${busy} update=${update} />`}</td>
              ${!group && html`
                ${[["can_upload_invoices", "May upload invoices"], ["can_manage_duties", "May manage kitchen duty"], ["can_resolve_reports", "May resolve reports"]].map(([k, label]) =>
                  html`<td class="center">${p.role === "admin" ? html`<span class="badge ok">always</span>`
                    : html`<input type="checkbox" aria-label=${label} checked=${!!p[k]} disabled=${busy} onChange=${(e) => update(p, { [k]: e.target.checked })} />`}</td>`)}`}
            </tr>`;
          })}</tbody>
        </table></div>
        ${!group && html`<p class="small muted" style="margin-top:10px">
          Group admins manage the people, account connections, balances, payments and counts of their own group, and see admin messages. They can't change settings, roles or anything outside their group.
          To remove an account entirely, delete the user in the Supabase dashboard (Authentication → Users).</p>`}
      </div>`;
    }}<//>`;
}

/** Role select; choosing "Group admin" asks for the group first. */
function RoleEditor({ p, groups, busy, update }) {
  const [choosingGroup, setChoosingGroup] = useState(false);
  const pickRole = (e) => {
    const role = e.target.value;
    if (role === "group_admin") { setChoosingGroup(true); return; }
    if (role === "admin" && !confirm(`Make ${p.email} an admin? Admins can see and change everything.`)) { e.target.value = p.role; return; }
    setChoosingGroup(false);
    update(p, { role, managed_group: null }, `${p.email} is now ${ROLE_LABEL[role].toLowerCase()}`);
  };
  const showGroup = choosingGroup || p.role === "group_admin";
  return html`<div class="row" style="gap:8px;flex-wrap:nowrap">
    <select style="width:auto" value=${choosingGroup ? "group_admin" : p.role} disabled=${busy} onChange=${pickRole} aria-label=${`Role of ${p.email}`}>
      <option value="member">Member</option><option value="group_admin">Group admin</option><option value="admin">Admin</option>
    </select>
    ${showGroup && html`<select style="width:auto" value=${p.managed_group || ""} disabled=${busy} aria-label="Group they manage"
      onChange=${(e) => { if (!e.target.value) return; setChoosingGroup(false); update(p, { role: "group_admin", managed_group: e.target.value }, `${p.email} now manages ${e.target.value}`); }}>
      <option value="">Which group?</option>
      ${groups.map((g) => html`<option value=${g.name}>${g.name}</option>`)}
    </select>`}
    ${choosingGroup && html`<button class="btn-text" onClick=${() => setChoosingGroup(false)}>Cancel</button>`}
  </div>`;
}

function PersonSelect({ free, onPick }) {
  return html`<select style="width:auto;max-width:260px" onChange=${(e) => e.target.value && onPick(e.target.value)}>
    <option value="">Choose person…</option>
    ${free.map((p) => html`<option value=${p.id}>${p.last_name}, ${p.first_name}${p.group_name ? ` (${p.group_name})` : ""}</option>`)}
  </select>`;
}
