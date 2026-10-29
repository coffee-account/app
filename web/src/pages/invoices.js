import { html, useState, useLoad, Loading, Field, toast, useBusy, fmtEUR, ConfirmAction, deferDelete, usePendingDeletes } from "../lib/ui.js";
import { EmptyState, ReceiptCarrier } from "../lib/drawings.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { personName } from "../lib/accounting.js";
import { isoDate, fmtDate } from "../lib/dates.js";

const MAX_BYTES = 10 * 1024 * 1024;
const STATUS_BADGE = { submitted: "", reimbursed: "ok", rejected: "bad" };
const STATUS_WORD = { submitted: "open", reimbursed: "reimbursed", rejected: "rejected" };

export function InvoicesPage() {
  const app = useApp();
  const [scope, setScope] = useState(app.isAdmin ? "all" : "mine");
  const state = useLoad(() => api.listInvoices(scope === "mine", app.user.id), [scope]);
  const to = app.settings.reimbursement?.to;

  return html`
    <div class="page-head"><div><h1>Invoices</h1>
      <p>Get money back for something you bought for the kitchen, or ask for it in advance; ${app.isAdmin && to ? `${to} gets an e-mail.` : "the accounting contact gets an e-mail."}</p></div></div>
    ${app.isAdmin && !to && html`<div class="notice warn">No reimbursement address is set yet, so no e-mail can go out. <a href="#/settings">Set it in Settings →</a></div>`}
    <${SubmitForm} app=${app} onDone=${state.reload} />
    <div class="row" style="margin:32px 0 14px"><h2 style="margin:0">${scope === "all" ? "All invoices" : "My invoices"}</h2><span class="spacer"></span>
      ${app.isAdmin && html`<div class="seg" role="group" aria-label="Show">
        <button class=${scope === "all" ? "on" : ""} aria-pressed=${scope === "all"} onClick=${() => setScope("all")}>All</button>
        <button class=${scope === "mine" ? "on" : ""} aria-pressed=${scope === "mine"} onClick=${() => setScope("mine")}>Mine</button></div>`}
    </div>
    <${Loading} state=${state}>${(rows) => html`<${InvoiceTable} rows=${rows} admin=${app.isAdmin} reload=${state.reload} />`}<//>`;
}

function SubmitForm({ app, onDone }) {
  const empty = { invoice_date: isoDate(), amount: "", supplier: "", description: "", reimburse_note: "",
    submitter_name: app.person ? personName(app.person) : "" };
  const [kind, setKind] = useState("reimbursement");
  const advance = kind === "advance";
  const [form, setForm] = useState(empty);
  const [file, setFile] = useState(null);
  const [inputKey, setInputKey] = useState(0);
  const [busy, run] = useBusy();
  const set = (k) => (e) => { const v = e.target.value; setForm((f) => ({ ...f, [k]: v })); };

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (!file && !advance) throw new Error("Please attach the invoice (PDF or photo).");
      if (file && file.size > MAX_BYTES) throw new Error("The file is larger than 10 MB.");
      const amount = Number(String(form.amount).replace(",", "."));
      if (!(amount > 0)) throw new Error("Please enter the amount.");
      const { mailError } = await api.submitInvoice(app.user.id, { ...form, amount, kind }, file);
      if (mailError) toast(`Saved, but the e-mail could not be sent: ${mailError}`, "error");
      else toast(advance ? "Advance requested; the accounting contact has been e-mailed" : "Invoice submitted; the accounting contact has been e-mailed");
      setForm(empty);
      setFile(null);
      setInputKey((k) => k + 1);
      onDone();
    });
  };

  return html`<form class="card" onSubmit=${submit}>
    <h2>Request money</h2>
    <div style="max-width:320px;margin-bottom:12px">
      <${Field} label="Type of request">
        <select value=${kind} onChange=${(e) => setKind(e.target.value)}>
          <option value="reimbursement">Reimbursement (I already paid)</option>
          <option value="advance">Advance payment (I need money first)</option>
        </select><//>
    </div>
    <p class="lede" style="margin-bottom:14px">${advance
      ? "You'd like the money before you buy something for the kitchen. Once you've bought it, please send the receipt to the accounting contact."
      : "You already paid for something for the kitchen. Upload the receipt and say how you'd like the money back."}</p>
    <div class="form-grid">
      <${Field} label=${advance ? "Needed by" : "Invoice date"}><input type="date" required value=${form.invoice_date} onInput=${set("invoice_date")} /><//>
      <${Field} label=${advance ? "Amount needed (€)" : "Amount (€)"}><input inputmode="decimal" required placeholder="12,49" value=${form.amount} onInput=${set("amount")} /><//>
      <${Field} label=${advance ? "Where will you buy it?" : "Shop / supplier"}><input required value=${form.supplier} onInput=${set("supplier")} /><//>
      <${Field} label="Your name"><input required value=${form.submitter_name} onInput=${set("submitter_name")} /><//>
    </div>
    <div class="form-grid" style="margin-top:12px">
      <${Field} label=${advance ? "What is it for?" : "What was bought"}><textarea required=${advance} value=${form.description} onInput=${set("description")}
        placeholder="e.g. 6 l milk, coffee beans"></textarea><//>
      <${Field} label=${advance ? "Where should the advance go?" : "How should you be reimbursed?"} hint="e.g. PayPal address or IBAN">
        <textarea value=${form.reimburse_note} onInput=${set("reimburse_note")}></textarea><//>
    </div>
    <div class="row" style="margin-top:14px;align-items:flex-end">
      <label class="upload" style="flex:1;min-width:260px">
        <span>${file ? file.name : advance ? "Attach a quote or shopping link (optional)" : "Choose the invoice file"}</span>
        <small class="muted">PDF, JPG or PNG, up to 10 MB</small>
        <input key=${inputKey} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
          onChange=${(e) => setFile(e.target.files[0] || null)} />
      </label>
      <button class="btn primary" disabled=${busy}>${busy ? "Sending…" : advance ? "Request advance" : "Submit and notify"}</button>
    </div>
  </form>`;
}

function InvoiceTable({ rows: all, admin, reload }) {
  const isPending = usePendingDeletes();
  const rows = all.filter((inv) => !isPending(`invoice:${inv.id}`));
  const [busy, run] = useBusy();
  if (!rows.length) {
    return html`<${EmptyState} drawing=${html`<${ReceiptCarrier} />`}>No invoices yet. Receipts you upload above will be listed here with their status.<//>`;
  }
  const open = (inv) => run(async () => window.open(await api.invoiceFileUrl(inv.file_path), "_blank", "noopener"));
  const setStatus = (inv, status) => run(async () => {
    const status_note = status === "rejected" ? prompt("Reason (optional)") ?? "" : inv.status_note;
    await api.updateInvoice(inv.id, { status, status_note });
    reload();
  });
  const resend = (inv) => run(async () => { await api.resendInvoice(inv.id); toast("E-mail sent"); reload(); });
  const remove = (inv) => deferDelete({
    key: `invoice:${inv.id}`, message: `Invoice from ${inv.supplier} deleted`,
    commit: () => api.deleteInvoice(inv), onDone: reload,
  });
  const total = rows.filter((r) => r.status === "submitted").reduce((s, r) => s + Number(r.amount), 0);

  return html`<div class="table-wrap"><table class="data">
    <thead><tr><th>Date</th><th>Supplier</th><th class="num">Amount</th>${admin && html`<th>Submitted by</th>`}<th>Status</th><th>E-mail</th><th></th></tr></thead>
    <tbody>${rows.map((inv) => html`<tr>
      <td>${fmtDate(inv.invoice_date)}${inv.kind === "advance" && html`<div><span class="badge">advance</span></div>`}</td>
      <td>${inv.supplier}${inv.description && html`<div class="small muted">${inv.description}</div>`}</td>
      <td class="num">${fmtEUR(inv.amount)}</td>
      ${admin && html`<td>${inv.submitter_name || ""}${inv.reimburse_note && html`<div class="small muted">${inv.reimburse_note}</div>`}</td>`}
      <td><span class="badge ${STATUS_BADGE[inv.status]}">${STATUS_WORD[inv.status]}</span>${inv.status_note && html`<div class="small muted">${inv.status_note}</div>`}</td>
      <td>${inv.notify_error ? html`<span class="badge bad" title=${inv.notify_error}>failed</span>`
        : inv.notified_at ? html`<span class="badge ok">sent</span>` : html`<span class="badge">pending</span>`}</td>
      <td class="num"><div class="row end" style="gap:12px">
        ${inv.file_path && html`<button class="btn-text" disabled=${busy} onClick=${() => open(inv)}>File</button>`}
        ${(admin || inv.notify_error) && html`<button class="btn-text" disabled=${busy} onClick=${() => resend(inv)}>Resend</button>`}
        ${admin && inv.status !== "reimbursed" && html`<button class="btn small" disabled=${busy} onClick=${() => setStatus(inv, "reimbursed")}>Mark reimbursed</button>`}
        ${admin && inv.status === "submitted" && html`<button class="btn-text" disabled=${busy} onClick=${() => setStatus(inv, "rejected")}>Reject</button>`}
        ${admin && inv.status !== "submitted" && html`<button class="btn-text" disabled=${busy} onClick=${() => setStatus(inv, "submitted")}>Reopen</button>`}
        ${(admin || inv.status === "submitted") && html`<${ConfirmAction} question="Delete invoice and file?" disabled=${busy} onConfirm=${() => remove(inv)} />`}
      </div></td>
    </tr>`)}</tbody>
    <tfoot><tr><td colspan="2">Open</td><td class="num">${fmtEUR(total)}</td><td colspan=${admin ? 4 : 3}></td></tr></tfoot>
  </table></div>`;
}
