import { html, useState, useMemo, useLoad, Loading, Field, toast, useBusy, fmtEUR, ConfirmAction, deferDelete, usePendingDeletes, useLinkTab, SearchSelect } from "../lib/ui.js";
import { PaypalImport, PayoutsTab } from "./paypal.js";
import * as api from "../lib/api.js";
import { computeLedger, personName, sortPeople } from "../lib/accounting.js";
import { isoDate, fmtDate } from "../lib/dates.js";
import { useApp } from "../lib/context.js";

// Payments by hand; for admins also payouts and the PayPal import as tabs (#/payments?tab=payouts|import).
const TABS = [["record", "Money in", "Payments from members. A negative amount records a correction."],
  ["payouts", "Money out", "Payouts from the PayPal account."],
  ["import", "PayPal import", "Money in and out of the PayPal account, from its statement."]];

export function PaymentsPage() {
  const app = useApp();
  const [picked, setTab] = useLinkTab("record");
  const tab = app.isAdmin && TABS.some(([k]) => k === picked) ? picked : "record";
  return html`
    <div class="page-head"><div><h1>Payments</h1><p>${TABS.find(([k]) => k === tab)[2]}</p></div></div>
    ${app.isAdmin && html`<div class="tabs">
      ${TABS.map(([k, label]) => html`<button class=${tab === k ? "active" : ""} onClick=${() => setTab(k)}>${label}</button>`)}
    </div>`}
    ${tab === "import" ? html`<${PaypalImport} />` : tab === "payouts" ? html`<${PayoutsTab} />` : html`<${RecordPayments} app=${app} />`}`;
}

function RecordPayments({ app }) {
  const group = app.isAdmin ? null : app.managedGroup; // group admins: their group's payments only
  const state = useLoad(() => api.loadLedgerData(undefined, group));
  const [q, setQ] = useState("");
  const [busy, run] = useBusy();
  const isPending = usePendingDeletes();

  return html`
    <${Loading} state=${state}>${(data) => {
      const ledger = computeLedger(data);
      const byId = new Map(data.people.map((p) => [p.id, p]));
      const payments = [...data.payments].sort((a, b) => b.paid_on.localeCompare(a.paid_on) || (b.created_at || "").localeCompare(a.created_at || ""))
        .filter((p) => !isPending(`payment:${p.id}`))
        .filter((p) => !q || personName(byId.get(p.person_id)).toLowerCase().includes(q.toLowerCase()));
      const remove = (p) => deferDelete({
        key: `payment:${p.id}`, message: `Payment of ${fmtEUR(p.amount)} deleted`,
        commit: () => api.deletePayment(p.id), onDone: state.reload,
      });
      return html`
        <${PaymentForm} people=${data.people} ledger=${ledger} onSaved=${state.reload} />
        <h2 class="section-title">History</h2>
        <div class="toolbar">
          <input data-search placeholder="Search name  /" aria-label="Search name" value=${q} onInput=${(e) => setQ(e.target.value)} />
          <span class="count">${payments.length} payments · ${fmtEUR(payments.reduce((n, p) => n + Number(p.amount), 0))}</span>
        </div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Date</th><th>Person</th><th class="num">Amount</th><th>Method</th><th>Note</th><th></th></tr></thead>
          <tbody>${payments.slice(0, 300).map((p) => html`<tr>
            <td>${fmtDate(p.paid_on)}</td><td>${personName(byId.get(p.person_id))}</td>
            <td class="num ${p.amount < 0 ? "neg" : "pos"}">${fmtEUR(p.amount)}</td><td>${p.method || ""}${p.payer && html`<div class="small muted">${p.payer}</div>`}</td><td class="muted">${p.note || ""}</td>
            <td class="num"><span class="row-actions"><${ConfirmAction} question="Delete payment?" disabled=${busy} onConfirm=${() => remove(p)} /></span></td></tr>`)}</tbody>
        </table></div>
        ${payments.length > 300 && html`<p class="small muted">Showing the latest 300.</p>`}`;
    }}<//>`;
}

function PaymentForm({ people, ledger, onSaved }) {
  const empty = { person_id: "", paid_on: isoDate(), amount: "20", method: "PayPal", note: "" };
  const [f, setF] = useState(empty);
  const [busy, run] = useBusy();
  const isPending = usePendingDeletes();
  const set = (k) => (e) => { const v = e.target.value; setF((x) => ({ ...x, [k]: v })); };
  const bal = f.person_id ? ledger.get(f.person_id)?.balance : null;
  // Everyone on the list, by last name; people on neither list come last.
  const options = useMemo(() => {
    const on = (p) => p.active_coffee || p.active_drinks;
    return [...sortPeople(people.filter(on), "last"), ...sortPeople(people.filter((p) => !on(p)), "last")].map((p) => ({
      value: p.id, label: `${p.last_name}, ${p.first_name}`, sub: [p.group_name, !on(p) && "not on a list"].filter(Boolean).join(" · "),
    }));
  }, [people]);
  return html`<form class="card payment-form" onSubmit=${(e) => {
    e.preventDefault();
    run(async () => {
      const amount = Number(String(f.amount).replace(",", "."));
      if (!f.person_id) throw new Error("Choose a person");
      if (!amount) throw new Error("Enter an amount");
      await api.addPayment({ ...f, amount, note: f.note || null });
      toast(`Payment of ${fmtEUR(amount)} recorded`);
      setF({ ...empty, paid_on: f.paid_on, method: f.method });
      onSaved();
    });
  }}>
    <div class="form-row">
      <${Field} label="Person" hint=${bal != null ? `Current balance: ${fmtEUR(bal)}` : null}>
        <${SearchSelect} options=${options} value=${f.person_id} required ariaLabel="Person" placeholder="Search name"
          onChange=${(id) => setF((x) => ({ ...x, person_id: id }))} /><//>
      <${Field} label="Date"><input type="date" required value=${f.paid_on} onInput=${set("paid_on")} /><//>
      <${Field} label="Amount (€)"><input inputmode="decimal" required value=${f.amount} onInput=${set("amount")} /><//>
      <${Field} label="Method" hint=${/^paypal/i.test(f.method) ? "Also added to the PayPal balance." : null}><select value=${f.method} onChange=${set("method")}>
        ${["PayPal", "Cash", "Bank transfer", "Correction"].map((m) => html`<option value=${m}>${m}</option>`)}</select><//>
      <${Field} label="Note"><input value=${f.note} onInput=${set("note")} /><//>
      <button class="btn primary" disabled=${busy}>Record payment</button>
    </div>
  </form>`;
}
