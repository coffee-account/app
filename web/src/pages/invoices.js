import { html, useState, useLoad, Loading, Field, toast, useBusy, fmtEUR } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { personName } from "../lib/accounting.js";
import { isoDate, fmtDate } from "../lib/dates.js";

const MAX_BYTES = 10 * 1024 * 1024;
const STATUS_BADGE = { submitted: "warn", reimbursed: "ok", rejected: "bad" };

export function InvoicesPage() {
  const app = useApp();
  const [scope, setScope] = useState(app.isAdmin ? "all" : "mine");
  const state = useLoad(() => api.listInvoices(scope === "mine", app.user.id), [scope]);
  const to = app.settings.reimbursement?.to;

  return html`
    <div class="page-head"><div><h1>Invoices</h1>
      <p>Upload a receipt for something you bought for the kitchen. ${app.isAdmin && to ? `An e-mail goes to ${to}.` : "The reimbursement contact is notified by e-mail."}</p></div></div>
    ${app.isAdmin && !to && html`<div class="notice warn">No reimbursement e-mail address is set yet. <a href="#/settings">Set it in Settings</a>.</div>`}
    <${SubmitForm} app=${app} onDone=${state.reload} />
    <div class="row" style="margin:20px 0 10px"><h2 style="margin:0">${scope === "all" ? "All invoices" : "My invoices"}</h2><span class="spacer"></span>
      ${app.isAdmin && html`<div class="seg">
        <button class=${scope === "all" ? "on available" : ""} onClick=${() => setScope("all")}>All</button>
        <button class=${scope === "mine" ? "on available" : ""} onClick=${() => setScope("mine")}>Mine</button></div>`}
    </div>
    <${Loading} state=${state}>${(rows) => html`<${InvoiceTable} rows=${rows} admin=${app.isAdmin} reload=${state.reload} />`}<//>`;
}

function SubmitForm({ app, onDone }) {
  const empty = { invoice_date: isoDate(), amount: "", supplier: "", description: "", reimburse_note: "",
    submitter_name: app.person ? personName(app.person) : "" };
  const [form, setForm] = useState(empty);
  const [file, setFile] = useState(null);
  const [inputKey, setInputKey] = useState(0);
  const [busy, run] = useBusy();
  const set = (k) => (e) => { const v = e.target.value; setForm((f) => ({ ...f, [k]: v })); };

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (!file) throw new Error("Please attach the invoice (PDF or photo).");
      if (file.size > MAX_BYTES) throw new Error("The file is larger than 10 MB.");
      const amount = Number(String(form.amount).replace(",", "."));
      if (!(amount > 0)) throw new Error("Please enter the amount.");
      const { mailError } = await api.submitInvoice(app.user.id, { ...form, amount }, file);
      if (mailError) toast(`Invoice saved, but the e-mail could not be sent: ${mailError}`, "error");
      else toast("Invoice submitted — the reimbursement contact has been e-mailed");
      setForm(empty);
      setFile(null);
      setInputKey((k) => k + 1);
      onDone();
    });
  };

  return html`<form class="card" onSubmit=${submit}>
    <h2>Submit an invoice</h2>
    <div class="form-grid">
      <${Field} label="Invoice date"><input type="date" required value=${form.invoice_date} onInput=${set("invoice_date")} /><//>
      <${Field} label="Amount (€)"><input inputmode="decimal" required placeholder="12,49" value=${form.amount} onInput=${set("amount")} /><//>
      <${Field} label="Shop / supplier"><input required value=${form.supplier} onInput=${set("supplier")} /><//>
      <${Field} label="Your name"><input required value=${form.submitter_name} onInput=${set("submitter_name")} /><//>
    </div>
    <div class="form-grid" style="margin-top:12px">
      <${Field} label="What was bought"><textarea value=${form.description} onInput=${set("description")} placeholder="e.g. 6 l milk, coffee beans"></textarea><//>
      <${Field} label="How should you be reimbursed?" hint="e.g. PayPal address or 'bank transfer, details on file'">
        <textarea value=${form.reimburse_note} onInput=${set("reimburse_note")}></textarea><//>
    </div>
    <div class="row" style="margin-top:12px">
      <${Field} label="Invoice file (PDF, JPG, PNG — max. 10 MB)">
        <input key=${inputKey} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" required
          onChange=${(e) => setFile(e.target.files[0] || null)} /><//>
      <span class="spacer"></span>
      <button class="btn primary" disabled=${busy}>${busy ? "Uploading…" : "Submit & notify"}</button>
    </div>
  </form>`;
}

function InvoiceTable({ rows, admin, reload }) {
  const [busy, run] = useBusy();
  if (!rows.length) return html`<p class="muted">No invoices yet.</p>`;
  const open = (inv) => run(async () => window.open(await api.invoiceFileUrl(inv.file_path), "_blank", "noopener"));
  const setStatus = (inv, status) => run(async () => {
    const status_note = status === "rejected" ? prompt("Reason (optional)") ?? "" : inv.status_note;
    await api.updateInvoice(inv.id, { status, status_note });
    reload();
  });
  const resend = (inv) => run(async () => { await api.resendInvoice(inv.id); toast("E-mail sent"); reload(); });
  const remove = (inv) => confirm("Delete this invoice and its file?") && run(async () => { await api.deleteInvoice(inv); reload(); });
  const total = rows.filter((r) => r.status === "submitted").reduce((s, r) => s + Number(r.amount), 0);

  return html`<div class="table-wrap"><table class="data">
    <thead><tr><th>Date</th><th>Supplier</th><th class="num">Amount</th>${admin && html`<th>Submitted by</th>`}<th>Status</th><th>E-mail</th><th></th></tr></thead>
    <tbody>${rows.map((inv) => html`<tr>
      <td>${fmtDate(inv.invoice_date)}</td>
      <td>${inv.supplier}${inv.description && html`<div class="small muted">${inv.description}</div>`}</td>
      <td class="num">${fmtEUR(inv.amount)}</td>
      ${admin && html`<td>${inv.submitter_name || ""}${inv.reimburse_note && html`<div class="small muted">${inv.reimburse_note}</div>`}</td>`}
      <td><span class="badge ${STATUS_BADGE[inv.status]}">${inv.status}</span>${inv.status_note && html`<div class="small muted">${inv.status_note}</div>`}</td>
      <td>${inv.notify_error ? html`<span class="badge bad" title=${inv.notify_error}>failed</span>`
        : inv.notified_at ? html`<span class="badge ok">sent</span>` : html`<span class="badge">pending</span>`}</td>
      <td class="num"><div class="row end">
        ${inv.file_path && html`<button class="btn small" disabled=${busy} onClick=${() => open(inv)}>File</button>`}
        ${(admin || inv.notify_error) && html`<button class="btn small" disabled=${busy} onClick=${() => resend(inv)}>Resend</button>`}
        ${admin && inv.status !== "reimbursed" && html`<button class="btn small" disabled=${busy} onClick=${() => setStatus(inv, "reimbursed")}>Mark reimbursed</button>`}
        ${admin && inv.status === "submitted" && html`<button class="btn small" disabled=${busy} onClick=${() => setStatus(inv, "rejected")}>Reject</button>`}
        ${admin && inv.status !== "submitted" && html`<button class="btn small ghost" disabled=${busy} onClick=${() => setStatus(inv, "submitted")}>Reopen</button>`}
        ${(admin || inv.status === "submitted") && html`<button class="btn small danger" disabled=${busy} onClick=${() => remove(inv)}>Delete</button>`}
      </div></td>
    </tr>`)}</tbody>
    <tfoot><tr><td colspan=${admin ? 2 : 2}><b>Open</b></td><td class="num"><b>${fmtEUR(total)}</b></td><td colspan=${admin ? 4 : 3}></td></tr></tfoot>
  </table></div>`;
}
