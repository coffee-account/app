import { html, useState, useLoad, Loading, Field, toast, useBusy, fmtEUR, ConfirmAction, deferDelete, usePendingDeletes } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { fmtDate, isoDate } from "../lib/dates.js";
import { ISSUE_CATEGORIES, APP_BUG } from "./issues.js";

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
    notifications: {
      refund: settings.notifications?.refund ?? "",
      issues: Object.fromEntries([...ISSUE_CATEGORIES, APP_BUG].map(([k]) => [k, settings.notifications?.issues?.[k] ?? ""])),
    },
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
        <h2>Kitchen duty</h2>
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
    <div class="card">
      <h2>Notifications</h2>
      <p class="lede" style="margin-bottom:14px">Who gets which e-mail. Several addresses: separate them with commas.
        Empty fields under <i>Refunds</i> and <i>Reported issues</i> go to all admins.</p>
      <div class="grid cols-2">
        <div class="grid" style="align-content:start">
          <h3 style="margin:0">Invoices and advance payments</h3>
          <${Field} label="Reimbursement and advance requests"><input value=${s.reimbursement.to} placeholder="finance@example.org"
            onInput=${(e) => sub("reimbursement", { to: e.target.value })} /><//>
          <label class="check"><input type="checkbox" checked=${s.reimbursement.cc_submitter} onChange=${(e) => sub("reimbursement", { cc_submitter: e.target.checked })} />
            Send a copy to the person who submitted it</label>
          <h3 style="margin:10px 0 0">Refunds</h3>
          <${Field} label="Refund requests"><input value=${s.notifications.refund} placeholder="all admins"
            onInput=${(e) => sub("notifications", { refund: e.target.value })} /><//>
          <h3 style="margin:10px 0 0">App issues and suggestions</h3>
          <${Field} label="Issues and suggestions about this app"><input value=${s.notifications.issues.app} placeholder="all admins"
            onInput=${(e) => { const v = e.target.value; setS((x) => ({ ...x, notifications: { ...x.notifications, issues: { ...x.notifications.issues, app: v } } })); }} /><//>
        </div>
        <div class="grid" style="align-content:start">
          <h3 style="margin:0">Reported kitchen issues</h3>
          ${ISSUE_CATEGORIES.map(([k, label]) => html`<${Field} label=${label}><input value=${s.notifications.issues[k]} placeholder="all admins"
            onInput=${(e) => { const v = e.target.value; setS((x) => ({ ...x, notifications: { ...x.notifications, issues: { ...x.notifications.issues, [k]: v } } })); }} /><//>`)}
        </div>
      </div>
    </div>
    <div class="row end" style="margin-bottom:16px"><button class="btn primary" disabled=${busy}>Save settings</button></div>
  </form>`;
}

function Prices({ prices: all, reload }) {
  const isPending = usePendingDeletes();
  const prices = all.filter((p) => !isPending(`price:${p.id}`));
  const [f, setF] = useState({ kind: "coffee", price: "", valid_from: isoDate() });
  const [busy, run] = useBusy();
  return html`<div class="card">
    <h2>Prices</h2>
    <p class="small muted">A new price applies to counts dated on or after its start date; older counts keep their old price.</p>
    <div class="table-wrap" style="margin-bottom:12px"><table class="data">
      <thead><tr><th>List</th><th class="num">Price</th><th>Valid from</th><th></th></tr></thead>
      <tbody>${prices.map((p) => html`<tr><td>${p.kind}</td><td class="num">${fmtEUR(p.price)}</td><td>${p.valid_from <= "2000-01-01" ? "always" : fmtDate(p.valid_from)}</td>
        <td class="num"><${ConfirmAction} question="Delete price?" disabled=${busy} onConfirm=${() => deferDelete({ key: `price:${p.id}`, message: `${p.kind} price ${fmtEUR(p.price)} deleted`, commit: () => api.deletePrice(p.id), onDone: reload })} /></td></tr>`)}</tbody>
    </table></div>
    <form class="form-grid" onSubmit=${(e) => { e.preventDefault(); run(async () => { await api.addPrice({ ...f, price: Number(String(f.price).replace(",", ".")) }); toast("Price saved"); reload(); }); }}>
      <select value=${f.kind} onChange=${(e) => setF({ ...f, kind: e.target.value })} aria-label="List"><option value="coffee">Coffee</option><option value="drinks">Drinks</option></select>
      <input inputmode="decimal" required placeholder="Price €" value=${f.price} onInput=${(e) => setF({ ...f, price: e.target.value })} aria-label="Price" />
      <input type="date" required value=${f.valid_from} onInput=${(e) => setF({ ...f, valid_from: e.target.value })} aria-label="Valid from" />
      <button class="btn" disabled=${busy}>Add price</button>
    </form>
  </div>`;
}

function Groups({ groups: all, reload }) {
  const isPending = usePendingDeletes();
  const groups = all.filter((g) => !isPending(`group:${g.name}`));
  const [name, setName] = useState("");
  const [busy, run] = useBusy();
  return html`<div class="card">
    <h2>Groups</h2>
    <p class="small muted">Shown in the registration form and on the lists. Renaming updates everyone in the group.</p>
    ${groups.map((g) => html`<div class="row" style="margin-bottom:6px"><span>${g.name}</span><span class="spacer"></span>
      <button class="btn small" disabled=${busy} onClick=${() => { const to = prompt("New name", g.name); if (to && to !== g.name) run(async () => { await api.renameGroup(g.name, to.trim()); reload(); }); }}>Rename</button>
      <${ConfirmAction} question=${`Delete ${g.name}? People keep their entry.`} disabled=${busy} onConfirm=${() => deferDelete({ key: `group:${g.name}`, message: `Group ${g.name} deleted`, commit: () => api.deleteGroup(g.name), onDone: reload })} /></div>`)}
    <form class="row" style="margin-top:10px" onSubmit=${(e) => { e.preventDefault(); run(async () => { await api.addGroup(name.trim()); setName(""); reload(); }); }}>
      <input required placeholder="New group" value=${name} onInput=${(e) => setName(e.target.value)} style="max-width:240px" />
      <button class="btn" disabled=${busy}>Add group</button>
    </form>
  </div>`;
}
