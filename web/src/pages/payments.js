import { html, useState, useLoad, Loading, Field, toast, useBusy, fmtEUR } from "../lib/ui.js";
import * as api from "../lib/api.js";
import { computeLedger, personName, sortPeople } from "../lib/accounting.js";
import { isoDate, fmtDate } from "../lib/dates.js";

export function PaymentsPage() {
  const state = useLoad(() => api.loadLedgerData());
  const [q, setQ] = useState("");
  const [busy, run] = useBusy();

  return html`
    <div class="page-head"><div><h1>Payments</h1><p>Money people paid in (PayPal, cash…). Negative amounts record pay-outs or corrections.</p></div></div>
    <${Loading} state=${state}>${(data) => {
      const ledger = computeLedger(data);
      const byId = new Map(data.people.map((p) => [p.id, p]));
      const payments = [...data.payments].sort((a, b) => b.paid_on.localeCompare(a.paid_on) || (b.created_at || "").localeCompare(a.created_at || ""))
        .filter((p) => !q || personName(byId.get(p.person_id)).toLowerCase().includes(q.toLowerCase()));
      const remove = (p) => confirm("Delete this payment?") && run(async () => { await api.deletePayment(p.id); state.reload(); });
      return html`
        <${PaymentForm} people=${data.people} ledger=${ledger} onSaved=${state.reload} />
        <div class="row" style="margin:20px 0 10px"><h2 style="margin:0">History</h2><span class="spacer"></span>
          <input placeholder="Filter by name" style="max-width:220px" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Date</th><th>Person</th><th class="num">Amount</th><th>Method</th><th>Note</th><th></th></tr></thead>
          <tbody>${payments.slice(0, 300).map((p) => html`<tr>
            <td>${fmtDate(p.paid_on)}</td><td>${personName(byId.get(p.person_id))}</td>
            <td class="num ${p.amount < 0 ? "neg" : ""}">${fmtEUR(p.amount)}</td><td>${p.method || ""}</td><td class="small muted">${p.note || ""}</td>
            <td class="num"><button class="btn small danger" disabled=${busy} onClick=${() => remove(p)}>Delete</button></td></tr>`)}</tbody>
        </table></div>
        ${payments.length > 300 && html`<p class="small muted">Showing the latest 300.</p>`}`;
    }}<//>`;
}

function PaymentForm({ people, ledger, onSaved }) {
  const empty = { person_id: "", paid_on: isoDate(), amount: "20", method: "PayPal", note: "" };
  const [f, setF] = useState(empty);
  const [busy, run] = useBusy();
  const set = (k) => (e) => { const v = e.target.value; setF((x) => ({ ...x, [k]: v })); };
  const bal = f.person_id ? ledger.get(f.person_id)?.balance : null;
  return html`<form class="card" onSubmit=${(e) => {
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
    <h2>Record a payment</h2>
    <div class="form-grid">
      <${Field} label="Person" hint=${bal != null ? `Current balance: ${fmtEUR(bal)}` : null}>
        <select required value=${f.person_id} onChange=${set("person_id")}>
          <option value="">— choose —</option>
          ${sortPeople(people, "last").map((p) => html`<option value=${p.id}>${p.last_name}, ${p.first_name}${p.group_name ? ` (${p.group_name})` : ""}</option>`)}
        </select><//>
      <${Field} label="Date"><input type="date" required value=${f.paid_on} onInput=${set("paid_on")} /><//>
      <${Field} label="Amount (€)"><input inputmode="decimal" required value=${f.amount} onInput=${set("amount")} /><//>
      <${Field} label="Method"><input list="pay-methods" value=${f.method} onInput=${set("method")} />
        <datalist id="pay-methods"><option>PayPal</option><option>Cash</option><option>Bank transfer</option><option>Correction</option></datalist><//>
      <${Field} label="Note"><input value=${f.note} onInput=${set("note")} /><//>
    </div>
    <div class="row end" style="margin-top:12px"><button class="btn primary" disabled=${busy}>Add payment</button></div>
  </form>`;
}
