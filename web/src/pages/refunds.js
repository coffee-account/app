import { html, useState, useLoad, Loading, Field, toast, useBusy, fmtEUR, ConfirmAction, deferDelete, usePendingDeletes } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { computeLedger, personName, sortPeople } from "../lib/accounting.js";
import { isoDate, fmtDate } from "../lib/dates.js";
import { EmptyState, LayeredCup } from "../lib/drawings.js";

const STATUS = { open: ["", "waiting"], paid: ["ok", "paid out"], rejected: ["bad", "declined"] };

export function RefundsPage() {
  const app = useApp();
  const state = useLoad(async () => {
    const [mine, all, ledgerData, profiles] = await Promise.all([
      app.person ? api.listRefunds(true, app.user.id) : [],
      app.isAdmin ? api.listRefunds(false) : [],
      app.person ? api.loadLedgerData(app.isAdmin ? undefined : app.person.id) : null,
      app.isAdmin ? api.listProfiles() : [],
    ]);
    const ledger = ledgerData ? computeLedger(ledgerData) : new Map();
    return { mine, all, ledger, people: ledgerData?.people || [], profiles };
  });
  return html`
    <div class="page-head"><div><h1>Refunds</h1>
      <p>${app.isAdmin ? "Request your own refund, and pay out what others have asked for." : "Leaving, or want your credit back? Ask for a refund here."}</p></div></div>
    <${Loading} state=${state}>${(data) => html`<div>
      ${app.person ? html`<${RequestForm} app=${app} data=${data} reload=${state.reload} />`
        : html`<div class="notice">Your account isn't connected to an entry on the list yet, so there's no balance to refund.</div>`}
      ${data.mine.length > 0 && html`<h2 class="section-title">My requests</h2>
        <${RefundTable} rows=${data.mine} data=${data} reload=${state.reload} own />`}
      ${app.isAdmin && html`<h2 class="section-title">All requests</h2>
        <${RefundTable} rows=${data.all} data=${data} reload=${state.reload} admin />`}
    </div>`}<//>`;
}

function RequestForm({ app, data, reload }) {
  const balance = data.ledger.get(app.person.id)?.balance ?? 0;
  const open = data.mine.find((r) => r.status === "open");
  const others = sortPeople(
    data.profiles.filter((p) => p.id !== app.user.id && p.person_id)
      .map((p) => ({ ...p, ...(data.people.find((x) => x.id === p.person_id) || {}), profile_id: p.id })),
    "last",
  );
  const [f, setF] = useState({ amount: "", method: "PayPal", details: "", leaving: true, successor: "" });
  const [busy, run] = useBusy();
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const canRefund = balance > 0;
  const needsSuccessor = app.isAdmin && (f.leaving || !canRefund);
  const amount = Number(String(f.amount).replace(",", ".").trim());
  // Checked while typing: above zero and at most the balance.
  const amountError = !canRefund ? null
    : String(f.amount).trim() === "" ? "Please enter an amount."
    : Number.isNaN(amount) ? "Please enter a number, e.g. 12,50."
    : amount <= 0 ? "The amount must be more than 0 €."
    : amount > balance + 0.001 ? `That's more than your balance of ${fmtEUR(balance)}.`
    : null;
  const useBalance = () => set("amount", balance.toFixed(2).replace(".", ","));

  if (open) {
    return html`<div class="notice ok">You asked for ${fmtEUR(open.amount)} on ${fmtDate(open.created_at.slice(0, 10))}. The accounting manager will pay it out and mark it here.</div>`;
  }
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (amountError) throw new Error(amountError);
      if (needsSuccessor && !f.successor) throw new Error("Please choose who takes over as admin.");
      const { mailError } = await api.requestRefund(app.user.id, canRefund
        ? { person_id: app.person.id, amount: Math.round(amount * 100) / 100, method: f.method, details: f.details || null,
            leaving: f.leaving, successor_profile_id: needsSuccessor ? f.successor : null }
        // Nothing to pay out: a leaving notice only (needed so an admin can hand over).
        : { person_id: app.person.id, amount: 0, method: null, details: null, leaving: true,
            successor_profile_id: needsSuccessor ? f.successor : null });
      if (mailError) toast(`Saved, but the e-mail could not be sent: ${mailError}`, "error");
      else toast(canRefund ? "Refund requested" : "Leaving notice sent");
      reload();
    });
  };
  return html`<form class="card" onSubmit=${submit}>
    <h2>${canRefund ? "Request a refund" : "Leaving?"}</h2>
    <p class="lede" style="margin-bottom:14px">Your balance is <b class=${balance < 0 ? "neg" : ""}>${fmtEUR(balance)}</b>.
      ${balance < 0 ? ` You still owe ${fmtEUR(-balance)}; please settle it before leaving (see How to pay on the Info page). There's nothing to refund, but you can let us know that you're leaving.`
        : balance === 0 ? " There's nothing to refund, but you can let us know that you're leaving." : ""}</p>
    ${canRefund && html`<div class="form-grid">
      <${Field} label="Amount (€)">
        <div class="amount-row">
          <input inputmode="decimal" required value=${f.amount} aria-invalid=${!!amountError && String(f.amount).trim() !== ""} onInput=${(e) => set("amount", e.target.value)} />
          <button type="button" class="btn small" onClick=${useBalance} title=${`Fill in ${fmtEUR(balance)}`}>Use full balance</button>
        </div>
        ${amountError && String(f.amount).trim() !== "" && html`<small class="field-error" role="alert">${amountError}</small>`}<//>
      <${Field} label="How should we pay you?"><select value=${f.method} onChange=${(e) => set("method", e.target.value)}>
        <option value="PayPal">PayPal</option><option value="Bank transfer">Bank transfer</option><option value="Cash">Cash</option></select><//>
      <${Field} label=${f.method === "Cash" ? "Note (optional)" : f.method === "PayPal" ? "PayPal address" : "IBAN and account holder"}>
        <input value=${f.details} required=${f.method !== "Cash"} onInput=${(e) => set("details", e.target.value)} /><//>
    </div>
    <label class="check" style="margin-top:12px"><input type="checkbox" checked=${f.leaving} onChange=${(e) => set("leaving", e.target.checked)} />
      I'm leaving: take me off the coffee and drinks lists</label>`}
    ${needsSuccessor && html`<div class="notice warn" style="margin-top:14px">
      You're an admin. Please nominate who takes over; they become admin when your refund is paid out, and you become a member.
      <div style="margin-top:10px;max-width:420px">
        <select required value=${f.successor} onChange=${(e) => set("successor", e.target.value)} aria-label="Successor">
          <option value="">Choose your successor</option>
          ${others.map((p) => html`<option value=${p.profile_id}>${personName(p)}${p.role === "admin" ? " (already admin)" : ""} · ${p.email}</option>`)}
        </select>
      </div></div>`}
    <div class="row end" style="margin-top:14px"><button class="btn primary" disabled=${busy || !!amountError}>${canRefund ? "Request refund" : "Tell us I'm leaving"}</button></div>
  </form>`;
}

function RefundTable({ rows, data, reload, own, admin }) {
  const [busy, run] = useBusy();
  const [paying, setPaying] = useState(null);
  const isPending = usePendingDeletes();
  const visible = rows.filter((r) => !isPending(`refund:${r.id}`));
  if (!visible.length) return html`<${EmptyState} drawing=${html`<${LayeredCup} size=${96} />`}>No refund requests.<//>`;
  const nameOf = (r) => personName(data.people.find((p) => p.id === r.person_id)) || "—";
  const successor = (r) => data.profiles.find((p) => p.id === r.successor_profile_id)?.email;
  const cancel = (r) => deferDelete({ key: `refund:${r.id}`, message: "Refund request withdrawn", commit: () => api.cancelRefund(r.id), onDone: reload });
  const reject = (r) => run(async () => { await api.rejectRefund(r.id, "Declined"); toast("Request declined"); reload(); });

  return html`<div class="table-wrap"><table class="data normal">
    <thead><tr><th>Requested</th>${admin && html`<th>Person</th>`}<th class="num">Amount</th><th>Pay via</th>${admin && html`<th>Leaving / successor</th>`}<th>Status</th><th></th></tr></thead>
    <tbody>${visible.map((r) => html`<tr key=${r.id}>
      <td>${fmtDate(r.created_at.slice(0, 10))}</td>
      ${admin && html`<td>${nameOf(r)}</td>`}
      <td class="num">${fmtEUR(r.amount)}</td>
      <td>${r.method}${r.details && html`<div class="small muted">${r.details}</div>`}</td>
      ${admin && html`<td>${r.leaving ? "leaving" : "staying"}${successor(r) && html`<div class="small muted">successor: ${successor(r)}</div>`}</td>`}
      <td><span class="badge ${STATUS[r.status][0]}">${STATUS[r.status][1]}</span>
        ${r.notify_error && html`<div class="small neg" title=${r.notify_error}>e-mail failed</div>`}
        ${r.admin_note && html`<div class="small muted">${r.admin_note}</div>`}</td>
      <td class="num">${r.status === "open" && html`<div class="row end" style="gap:12px">
        ${admin && (paying === r.id
          ? html`<${PayForm} r=${r} onDone=${() => { setPaying(null); reload(); }} onCancel=${() => setPaying(null)} />`
          : html`<button class="btn small" disabled=${busy} onClick=${() => setPaying(r.id)}>Mark as paid</button>
              <${ConfirmAction} label="Decline" question="Decline this request?" disabled=${busy} actions=${[{ label: "Decline", danger: true, onClick: () => reject(r) }]} />`)}
        ${own && !admin && html`<${ConfirmAction} label="Withdraw" question="Withdraw your request?" actions=${[{ label: "Withdraw", danger: true, onClick: () => cancel(r) }]} />`}
      </div>`}</td>
    </tr>`)}</tbody>
  </table></div>`;
}

function PayForm({ r, onDone, onCancel }) {
  const app = useApp();
  const [date, setDate] = useState(isoDate());
  const [note, setNote] = useState("");
  const [busy, run] = useBusy();
  return html`<div class="row" style="gap:8px;flex-wrap:nowrap">
    <input type="date" aria-label="Paid on" value=${date} onInput=${(e) => setDate(e.target.value)} style="width:150px" />
    <input placeholder="Note" aria-label="Note" value=${note} onInput=${(e) => setNote(e.target.value)} style="width:140px" />
    <button class="btn small primary" disabled=${busy} onClick=${() => run(async () => {
      await api.completeRefund(r.id, date, note);
      toast(`${fmtEUR(r.amount)} recorded as paid out${r.successor_profile_id ? "; admin role handed over" : ""}`);
      onDone();
      if (r.successor_profile_id || r.profile_id === app.user.id) app.refresh(); // roles or own balance changed
    })}>Confirm</button>
    <button class="btn-text" onClick=${onCancel}>Cancel</button>
  </div>`;
}
