import { html, useState, useLoad, Loading, Field, toast, useBusy, fmtEUR } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { fmtDate, isoDate } from "../lib/dates.js";

export function SettingsPage() {
  const app = useApp();
  const state = useLoad(async () => {
    const [settings, prices, groups] = await Promise.all([api.loadSettings(), api.listPrices(), api.listGroups()]);
    return { settings, prices, groups };
  });
  return html`
    <div class="page-head"><div><h1>Settings</h1></div></div>
    <${Loading} state=${state}>${(data) => html`
      <${GeneralSettings} settings=${data.settings} onSaved=${() => { state.reload(); app.refresh(); }} />
      <div class="grid cols-2">
        <${Prices} prices=${data.prices} reload=${state.reload} />
        <${Groups} groups=${data.groups} reload=${state.reload} />
      </div>`}<//>`;
}

function GeneralSettings({ settings, onSaved }) {
  const [s, setS] = useState(() => ({
    app_name: settings.app_name ?? "Coffee & Drinks",
    signup_domains: (settings.signup_domains || []).join(", "),
    reimbursement: { to: "", cc_submitter: true, ...settings.reimbursement },
    availability: { weeks_ahead: 6, required_for: "active", reminders: true, ...settings.availability },
    duty: { people_per_week: 2, info: "", reminders: true, ...settings.duty },
    balance: { low_threshold: -10, starting_label: "Starting balance", ...settings.balance },
    payment_info: settings.payment_info ?? "",
  }));
  const [busy, run] = useBusy();
  const sub = (key, patch) => setS((x) => ({ ...x, [key]: { ...x[key], ...patch } }));

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const values = {
        ...s,
        signup_domains: s.signup_domains.split(/[,\s]+/).map((d) => d.trim().replace(/^@/, "").toLowerCase()).filter(Boolean),
        availability: { ...s.availability, weeks_ahead: Number(s.availability.weeks_ahead) || 0 },
        duty: { ...s.duty, people_per_week: Number(s.duty.people_per_week) || 0 },
        balance: { ...s.balance, low_threshold: Number(String(s.balance.low_threshold).replace(",", ".")) || 0 },
      };
      for (const [k, v] of Object.entries(values)) await api.saveSetting(k, v);
      toast("Settings saved");
      onSaved();
    });
  };

  return html`<form onSubmit=${save}>
    <div class="grid cols-2">
      <div class="card">
        <h2>General & access</h2>
        <div class="grid">
          <${Field} label="App name"><input value=${s.app_name} onInput=${(e) => setS({ ...s, app_name: e.target.value })} /><//>
          <${Field} label="Allowed e-mail domains for registration" hint="Comma-separated, e.g. uni-goettingen.de (sub-domains included). Empty = anyone can register. People whose e-mail you stored can always register.">
            <input value=${s.signup_domains} placeholder="uni-goettingen.de" onInput=${(e) => setS({ ...s, signup_domains: e.target.value })} /><//>
          <${Field} label="Low balance warning below (€)"><input inputmode="decimal" value=${s.balance.low_threshold} onInput=${(e) => sub("balance", { low_threshold: e.target.value })} /><//>
          <${Field} label="Label for the starting balance"><input value=${s.balance.starting_label} onInput=${(e) => sub("balance", { starting_label: e.target.value })} /><//>
          <${Field} label="How to pay (shown to members)"><textarea value=${s.payment_info} onInput=${(e) => setS({ ...s, payment_info: e.target.value })}></textarea><//>
        </div>
      </div>
      <div class="card">
        <h2>Invoices</h2>
        <div class="grid">
          <${Field} label="Send reimbursement requests to" hint="One or more addresses, comma-separated.">
            <input value=${s.reimbursement.to} placeholder="finance@example.org" onInput=${(e) => sub("reimbursement", { to: e.target.value })} /><//>
          <label class="check"><input type="checkbox" checked=${s.reimbursement.cc_submitter} onChange=${(e) => sub("reimbursement", { cc_submitter: e.target.checked })} />
            Send a copy to the person who uploaded the invoice</label>
        </div>
        <h2 style="margin-top:18px">Kitchen duty</h2>
        <div class="grid">
          <div class="form-grid">
            <${Field} label="Weeks people must fill in ahead"><input type="number" min="1" max="26" value=${s.availability.weeks_ahead} onInput=${(e) => sub("availability", { weeks_ahead: e.target.value })} /><//>
            <${Field} label="People per week (target)"><input type="number" min="0" max="10" value=${s.duty.people_per_week} onInput=${(e) => sub("duty", { people_per_week: e.target.value })} /><//>
          </div>
          <${Field} label="Availability is mandatory for">
            <select value=${s.availability.required_for} onChange=${(e) => sub("availability", { required_for: e.target.value })}>
              <option value="active">Everyone on the coffee or drinks list</option>
              <option value="all">Every connected account</option>
            </select><//>
          <label class="check"><input type="checkbox" checked=${s.availability.reminders} onChange=${(e) => sub("availability", { reminders: e.target.checked })} />
            Weekly reminder e-mail to people with missing weeks</label>
          <label class="check"><input type="checkbox" checked=${s.duty.reminders} onChange=${(e) => sub("duty", { reminders: e.target.checked })} />
            Remind people on duty at the start of their week</label>
          <${Field} label="Duty instructions (included in duty e-mails)"><textarea value=${s.duty.info} onInput=${(e) => sub("duty", { info: e.target.value })}></textarea><//>
        </div>
      </div>
    </div>
    <div class="row end" style="margin-bottom:16px"><button class="btn primary" disabled=${busy}>Save settings</button></div>
  </form>`;
}

function Prices({ prices, reload }) {
  const [f, setF] = useState({ kind: "coffee", price: "", valid_from: isoDate() });
  const [busy, run] = useBusy();
  return html`<div class="card">
    <h2>Prices</h2>
    <p class="small muted">A new price applies to counts dated on or after its start date; older counts keep their old price.</p>
    <div class="table-wrap" style="margin-bottom:12px"><table class="data">
      <thead><tr><th>List</th><th class="num">Price</th><th>Valid from</th><th></th></tr></thead>
      <tbody>${prices.map((p) => html`<tr><td>${p.kind}</td><td class="num">${fmtEUR(p.price)}</td><td>${p.valid_from <= "2000-01-01" ? "always" : fmtDate(p.valid_from)}</td>
        <td class="num"><button class="btn small danger" disabled=${busy} onClick=${() => confirm("Delete this price?") && run(async () => { await api.deletePrice(p.id); reload(); })}>Delete</button></td></tr>`)}</tbody>
    </table></div>
    <form class="form-grid" onSubmit=${(e) => { e.preventDefault(); run(async () => { await api.addPrice({ ...f, price: Number(String(f.price).replace(",", ".")) }); toast("Price saved"); reload(); }); }}>
      <select value=${f.kind} onChange=${(e) => setF({ ...f, kind: e.target.value })} aria-label="List"><option value="coffee">Coffee</option><option value="drinks">Drinks</option></select>
      <input inputmode="decimal" required placeholder="Price €" value=${f.price} onInput=${(e) => setF({ ...f, price: e.target.value })} aria-label="Price" />
      <input type="date" required value=${f.valid_from} onInput=${(e) => setF({ ...f, valid_from: e.target.value })} aria-label="Valid from" />
      <button class="btn" disabled=${busy}>Add price</button>
    </form>
  </div>`;
}

function Groups({ groups, reload }) {
  const [name, setName] = useState("");
  const [busy, run] = useBusy();
  return html`<div class="card">
    <h2>Groups</h2>
    <p class="small muted">Shown in the registration form and on the lists. Renaming updates everyone in the group.</p>
    ${groups.map((g) => html`<div class="row" style="margin-bottom:6px"><span>${g.name}</span><span class="spacer"></span>
      <button class="btn small" disabled=${busy} onClick=${() => { const to = prompt("New name", g.name); if (to && to !== g.name) run(async () => { await api.renameGroup(g.name, to.trim()); reload(); }); }}>Rename</button>
      <button class="btn small danger" disabled=${busy} onClick=${() => confirm(`Delete group ${g.name}? People keep their entry but lose the group.`) && run(async () => { await api.deleteGroup(g.name); reload(); })}>Delete</button></div>`)}
    <form class="row" style="margin-top:10px" onSubmit=${(e) => { e.preventDefault(); run(async () => { await api.addGroup(name.trim()); setName(""); reload(); }); }}>
      <input required placeholder="New group" value=${name} onInput=${(e) => setName(e.target.value)} style="max-width:240px" />
      <button class="btn" disabled=${busy}>Add group</button>
    </form>
  </div>`;
}
