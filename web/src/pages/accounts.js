import { html, useLoad, Loading, toast, useBusy } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { personName, sortPeople } from "../lib/accounting.js";
import { fmtDate } from "../lib/dates.js";

export function AccountsPage() {
  const app = useApp();
  const state = useLoad(async () => {
    const [profiles, people] = await Promise.all([api.listProfiles(), api.listPeople()]);
    return { profiles, people };
  });
  const [busy, run] = useBusy();
  const update = (p, patch, msg) => run(async () => {
    await api.updateProfile(p.id, patch);
    toast(msg || "Saved");
    await state.reload();
    if (p.id === app.user.id) app.refresh();
  });

  return html`
    <div class="page-head"><div><h1>Accounts & roles</h1>
      <p>Anyone can register as a member. Connect each account to their entry on the list so they can see their balance.</p></div></div>
    <${Loading} state=${state}>${({ profiles, people }) => {
      const byId = new Map(people.map((p) => [p.id, p]));
      const linked = new Set(profiles.map((p) => p.person_id).filter(Boolean));
      const free = sortPeople(people.filter((p) => !linked.has(p.id)), "last");
      const pending = profiles.filter((p) => !p.person_id);
      return html`
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
                  ${s && html`<button class="btn small primary" disabled=${busy} onClick=${() => update(p, { person_id: s.id }, `Connected to ${personName(s)}`)}>
                    Connect to ${personName(s)} (${s.group_name || "no group"})</button>`}
                  <${PersonSelect} free=${free} onPick=${(id) => update(p, { person_id: id }, "Connected")} />
                </div></td></tr>`;
            })}</tbody>
          </table></div></div>`}
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Account</th><th>Person</th><th>Role</th><th>Upload invoices</th><th>Manage kitchen duty</th></tr></thead>
          <tbody>${profiles.map((p) => {
            const person = p.person_id && byId.get(p.person_id);
            const admin = p.role === "admin";
            return html`<tr>
              <td>${p.email}${p.id === app.user.id && html` <span class="badge accent">you</span>`}</td>
              <td>${person ? html`${personName(person)} <button class="btn small ghost" disabled=${busy}
                  onClick=${() => confirm("Disconnect this account from the person?") && update(p, { person_id: null }, "Disconnected")}>Disconnect</button>`
                : html`<${PersonSelect} free=${free} onPick=${(id) => update(p, { person_id: id }, "Connected")} />`}</td>
              <td><select style="width:auto" value=${p.role} disabled=${busy}
                onChange=${(e) => (e.target.value === "admin" ? confirm(`Make ${p.email} an admin? Admins can see and change everything.`) : true)
                  ? update(p, { role: e.target.value }) : (e.target.value = p.role)}>
                <option value="member">Member</option><option value="admin">Admin</option></select></td>
              <td>${admin ? html`<span class="badge ok">always</span>`
                : html`<input type="checkbox" aria-label="May upload invoices" checked=${p.can_upload_invoices} disabled=${busy}
                    onChange=${(e) => update(p, { can_upload_invoices: e.target.checked })} />`}</td>
              <td>${admin ? html`<span class="badge ok">always</span>`
                : html`<input type="checkbox" aria-label="May manage kitchen duty" checked=${p.can_manage_duties} disabled=${busy}
                    onChange=${(e) => update(p, { can_manage_duties: e.target.checked })} />`}</td>
            </tr>`;
          })}</tbody>
        </table></div>
        <p class="small muted" style="margin-top:10px">To remove an account entirely, delete the user in the Supabase dashboard (Authentication → Users).</p>`;
    }}<//>`;
}

function PersonSelect({ free, onPick }) {
  return html`<select style="width:auto;max-width:260px" onChange=${(e) => e.target.value && onPick(e.target.value)}>
    <option value="">Choose person…</option>
    ${free.map((p) => html`<option value=${p.id}>${p.last_name}, ${p.first_name}${p.group_name ? ` (${p.group_name})` : ""}</option>`)}
  </select>`;
}
