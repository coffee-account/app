import { html, useState, useMemo, useLoad, Loading, toast, useBusy, fmtEUR, ConfirmAction, deferDelete, usePendingDeletes } from "../lib/ui.js";
import * as api from "../lib/api.js";
import { personName, sortPeople, dutyRound } from "../lib/accounting.js";
import { fmtDate } from "../lib/dates.js";
import { readStatement, matchPayer, normName } from "../lib/paypal.js";
import { Figures, EmptyState, ReceiptCarrier } from "../lib/drawings.js";

export function PaypalPage() {
  const state = useLoad(async () => {
    const [people, payments, aliases, ignored, invoices, refunds, payouts, settings, groups] = await Promise.all([
      api.listPeople(), api.listPayments(), api.listAliases(), api.listIgnored(),
      api.listInvoices(false), api.listRefunds(false), api.listPayouts(), api.loadSettings(), api.listGroups(),
    ]);
    return { people, payments, aliases, ignored, invoices, refunds, payouts, groups, round: dutyRound(settings), stored: settings.paypal_balance || null };
  });
  const [statement, setStatement] = useState(null);
  const [tab, setTab] = useState("in");
  const [fileName, setFileName] = useState("");
  const [inputKey, setInputKey] = useState(0);

  const onFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      setStatement(readStatement(await file.text()));
      setFileName(file.name);
    } catch (err) {
      toast(err.message, "error");
      setStatement(null);
    }
  };

  return html`
    <div class="page-head"><div><h1>PayPal import</h1>
      <p>Book incoming payments and payouts from a PayPal statement. Known payers are matched for you; nothing is saved until you confirm.</p></div></div>
    <div class="grid cols-2" style="margin-bottom:8px">
      <label class="upload">
        <span>${fileName || "Choose the PayPal CSV file"}</span>
        <small class="muted">English or German export; the same file can be imported again safely</small>
        <input key=${inputKey} type="file" accept=".csv,text/csv" onChange=${onFile} />
      </label>
      <details class="howto">
        <summary>How to download the statement</summary>
        <ol>
          <li>Log in at paypal.com and open <b>Activity</b> → <b>Statements</b> → <b>Activity download</b> (German: <i>Aktivitäten</i> → <i>Kontoauszüge</i> → <i>Aktivitäten herunterladen</i>).</li>
          <li>Transaction type: <b>Completed payments</b>; format: <b>CSV</b>.</li>
          <li>Pick a date range covering the time since your last import (overlaps are fine) and download.</li>
        </ol>
      </details>
    </div>
    <${Loading} state=${state}>${(data) => {
      // The newest balance in the file becomes the "PayPal balance" on the Balances page when you record something.
      const newer = statement?.balance && (!data.stored || statement.balance.date >= data.stored.as_of);
      const saveBalance = async () => {
        if (newer) await api.saveSetting("paypal_balance", { amount: statement.balance.amount, as_of: statement.balance.date });
      };
      const done = async () => { await saveBalance(); state.reload(); };
      const clear = () => { setStatement(null); setFileName(""); setInputKey((k) => k + 1); };
      return html`<div>
        ${statement && html`<div>
          ${statement.balance && html`<div class="notice ${newer ? "ok" : ""}">
            PayPal balance in this file: <b>${fmtEUR(statement.balance.amount)}</b> on ${fmtDate(statement.balance.date)}.
            ${newer ? " It's saved as the current PayPal balance when you record payments or payouts." : " Your saved balance is newer, so it stays."}
            ${newer && html` <button class="btn-text" onClick=${() => done().then(() => toast("PayPal balance saved"))}>Save balance only</button>`}</div>`}
          <div class="tabs">
            <button class=${tab === "in" ? "active" : ""} onClick=${() => setTab("in")}>Incoming payments (${statement.payments.length})</button>
            <button class=${tab === "out" ? "active" : ""} onClick=${() => setTab("out")}>Payouts (${statement.payouts.length})</button>
          </div>
          ${tab === "in"
            ? html`<${Review} key=${fileName} statement=${statement} data=${data} onDone=${done} onClear=${clear} />`
            : html`<${PayoutReview} key=${`${fileName}-out`} statement=${statement} data=${data} onDone=${done} onClear=${clear} />`}
        </div>`}
        <${Payouts} data=${data} reload=${state.reload} />
        <${Aliases} data=${data} reload=${state.reload} />
      </div>`;
    }}<//>`;
}

const PAYOUT_KINDS = [
  ["invoice", "Invoice reimbursement"],
  ["refund", "Refund to a member"],
  ["purchase", "Purchase"],
  ["other", "Other"],
];
const PAYOUT_LABEL = Object.fromEntries(PAYOUT_KINDS);
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

/** Outgoing PayPal payments: say what each was for, then record them. */
function PayoutReview({ statement, data, onDone, onClear }) {
  const people = useMemo(() => sortPeople(data.people, "last"), [data.people]);
  const openInvoices = data.invoices.filter((i) => i.status === "submitted");
  const openRefunds = data.refunds.filter((r) => r.status === "open");
  const done = useMemo(() => new Set([
    ...data.payouts.map((p) => p.external_id), ...data.payments.map((p) => p.external_id), ...data.ignored.map((x) => x.external_id),
  ].filter(Boolean)), [data]);

  // Suggest what each payout was: an open invoice of the same amount, an open refund, or a payment to a member.
  const rows = useMemo(() => statement.payouts.map((p) => {
    const inv = openInvoices.filter((i) => near(i.amount, p.amount));
    const who = matchPayer(p, data.people, data.aliases);
    const refund = openRefunds.find((r) => near(r.amount, p.amount) && (!who.personId || r.person_id === who.personId));
    const guess = inv.length === 1 ? { kind: "invoice", invoiceId: inv[0].id, sure: true, why: "an open invoice with the same amount" }
      : refund ? { kind: "refund", personId: refund.person_id, sure: true, why: "an open refund request with the same amount" }
      : who.confident ? { kind: "refund", personId: who.personId, sure: false, why: `paid to a member (${who.how})` }
      : { kind: "purchase", sure: false, why: null };
    return { ...p, guess, handled: done.has(p.id) };
  }), [statement, data]);
  const [choice, setChoice] = useState(() => Object.fromEntries(rows.map((r) => [r.id, {
    kind: r.guess.kind, invoiceId: r.guess.invoiceId || "", personId: r.guess.personId || "", note: r.note || "", include: r.guess.sure, skip: false,
  }])));
  const [busy, run] = useBusy();
  const set = (id, patch) => setChoice((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
  const open = rows.filter((r) => !r.handled);
  const ready = (r) => {
    const c = choice[r.id];
    return c.include && !c.skip && (c.kind !== "invoice" || c.invoiceId) && (c.kind !== "refund" || c.personId);
  };
  const toRecord = open.filter(ready);
  const toSkip = open.filter((r) => choice[r.id].skip);

  const save = () => run(async () => {
    await api.recordPayouts(toRecord.map((r) => {
      const c = choice[r.id];
      const request = c.kind === "refund" ? openRefunds.find((x) => x.person_id === c.personId) : null;
      return {
        kind: c.kind, paid_on: r.date, amount: r.amount, recipient: [r.name, r.email].filter(Boolean).join(" · "), external_id: r.id,
        note: c.note, invoice_id: c.invoiceId || null, person_id: c.personId || null, refund_request_id: request?.id || null,
      };
    }));
    if (toSkip.length) await api.importPaypal({ payments: [], aliases: [], ignored: toSkip.map((r) => ({ external_id: r.id, payer: r.name || r.email, amount: -r.amount, paid_on: r.date })) });
    toast(`${toRecord.length} payout${toRecord.length === 1 ? "" : "s"} recorded (${fmtEUR(toRecord.reduce((n, r) => n + r.amount, 0))})`);
    onDone();
  });

  if (!open.length) {
    return html`<${EmptyState} drawing=${html`<${ReceiptCarrier} size=${110} />`}
      action=${html`<button class="btn" onClick=${onClear}>Choose another file</button>`}>${rows.length ? "Every payout in this file has already been recorded or skipped." : "No payouts to people in this file."}<//>`;
  }
  const invoiceLabel = (i) => `${fmtDate(i.invoice_date)} · ${i.supplier} · ${fmtEUR(i.amount)}${i.submitter_name ? ` · ${i.submitter_name}` : ""}`;
  return html`<section>
    <p class="lede" style="margin-bottom:14px">Money sent from the PayPal account. Say what each payout was for: invoice reimbursements mark the invoice as reimbursed,
      refunds go on the member's balance (and complete their refund request).</p>
    <div class="table-wrap"><table class="data normal">
      <thead><tr><th>Date</th><th>To (PayPal)</th><th class="num">Amount</th><th>What was it?</th><th class="center">Record</th><th></th></tr></thead>
      <tbody>${open.map((r) => {
        const c = choice[r.id];
        return html`<tr key=${r.id} class=${c.skip ? "inactive" : ""}>
          <td>${fmtDate(r.date)}</td>
          <td>${r.name || "—"}<div class="small muted">${r.email}${r.note ? ` · “${r.note}”` : ""}</div></td>
          <td class="num">${fmtEUR(r.amount)}</td>
          <td>${c.skip ? html`<span class="muted">not coffee money</span>` : html`<div class="payout-what">
            <select aria-label="Kind of payout" value=${c.kind} onChange=${(e) => set(r.id, { kind: e.target.value })}>
              ${PAYOUT_KINDS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
            ${c.kind === "invoice" && html`<select aria-label="Which invoice" value=${c.invoiceId} onChange=${(e) => set(r.id, { invoiceId: e.target.value, include: !!e.target.value })}>
              <option value="">Which invoice?</option>${openInvoices.map((i) => html`<option value=${i.id}>${invoiceLabel(i)}</option>`)}</select>`}
            ${c.kind === "refund" && html`<select aria-label="Which member" value=${c.personId} onChange=${(e) => set(r.id, { personId: e.target.value, include: !!e.target.value })}>
              <option value="">Which member?</option>${people.map((p) => html`<option value=${p.id}>${p.last_name}, ${p.first_name}${openRefunds.some((x) => x.person_id === p.id) ? " · refund requested" : ""}</option>`)}</select>`}
            ${(c.kind === "purchase" || c.kind === "other") && html`<input aria-label="Note" placeholder="What for? e.g. coffee beans" value=${c.note} onInput=${(e) => set(r.id, { note: e.target.value })} />`}
            ${r.guess.why && html`<div class="small ${r.guess.sure ? "pos" : "muted"}">${r.guess.sure ? "✓ " : "suggested: "}${r.guess.why}</div>`}
          </div>`}</td>
          <td class="center"><input type="checkbox" aria-label="Record this payout" checked=${ready(r)} disabled=${c.skip}
            onChange=${(e) => set(r.id, { include: e.target.checked })} /></td>
          <td class="num">${c.skip
            ? html`<button class="btn-text" onClick=${() => set(r.id, { skip: false })}>Undo</button>`
            : html`<button class="btn-text" title="Not about the coffee fund; don't offer it again" onClick=${() => set(r.id, { skip: true, include: false })}>Not coffee</button>`}</td>
        </tr>`;
      })}</tbody>
    </table></div>
    <div class="row save-bar">
      <span class="small muted">Recording a payout doesn't change anyone's balance, except refunds to members.</span>
      <span class="spacer"></span>
      <button class="btn-text" onClick=${onClear}>Cancel</button>
      <button class="btn primary" disabled=${busy || (!toRecord.length && !toSkip.length)} onClick=${save}>
        Record ${toRecord.length} payout${toRecord.length === 1 ? "" : "s"} · ${fmtEUR(toRecord.reduce((n, r) => n + r.amount, 0))}</button>
    </div>
  </section>`;
}

function Payouts({ data, reload }) {
  const isPending = usePendingDeletes();
  const list = data.payouts.filter((p) => !isPending(`payout:${p.id}`));
  const person = new Map(data.people.map((p) => [p.id, p]));
  const invoice = new Map(data.invoices.map((i) => [i.id, i]));
  const forget = (p) => deferDelete({ key: `payout:${p.id}`, message: "Payout removed from the list", commit: () => api.deletePayout(p.id), onDone: reload });
  if (!list.length) return null;
  return html`<section style="margin-top:36px">
    <h2>Recorded payouts</h2>
    <p class="lede" style="margin-bottom:12px">Removing a payout here doesn't change the invoice status or a member's balance; correct those on their own pages.</p>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Date</th><th>To</th><th>What</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>${list.slice(0, 200).map((p) => html`<tr key=${p.id}>
        <td>${fmtDate(p.paid_on)}</td><td>${p.recipient || "—"}</td>
        <td>${PAYOUT_LABEL[p.kind]}${p.kind === "invoice" && invoice.get(p.invoice_id) ? `: ${invoice.get(p.invoice_id).supplier}` : ""}${p.kind === "refund" && person.get(p.person_id) ? `: ${personName(person.get(p.person_id))}` : ""}
          ${p.note && html`<div class="small muted">${p.note}</div>`}</td>
        <td class="num">${fmtEUR(p.amount)}</td>
        <td class="num"><span class="row-actions"><${ConfirmAction} label="Remove" question="Remove this payout from the list?" actions=${[{ label: "Remove", danger: true, onClick: () => forget(p) }]} /></span></td>
      </tr>`)}</tbody>
    </table></div>
  </section>`;
}

function Review({ statement, data, onDone, onClear }) {
  const people = useMemo(() => sortPeople(data.people, "last"), [data.people]);
  const booked = useMemo(() => new Set(data.payments.map((p) => p.external_id).filter(Boolean)), [data.payments]);
  const ignored = useMemo(() => new Set(data.ignored.map((x) => x.external_id)), [data.ignored]);

  // One entry per incoming payment, with its match and the admin's choice.
  const rows = useMemo(() => statement.payments.map((p) => {
    const m = matchPayer(p, data.people, data.aliases);
    const state = booked.has(p.id) ? "booked" : ignored.has(p.id) ? "ignored" : m.confident ? "matched" : m.personId ? "suggested" : "unknown";
    return { ...p, match: m, state };
  }), [statement, data]);
  const [choice, setChoice] = useState(() => Object.fromEntries(rows.map((r) => [r.id, {
    personId: r.match.personId || "", include: r.state === "matched", skip: false,
  }])));
  const [remember, setRemember] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [busy, run] = useBusy();
  const set = (id, patch) => setChoice((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
  // New people, one per PayPal payer (several payments from the same payer share it). "new:<payer>" as personId.
  const [drafts, setDrafts] = useState({});
  const payerKey = (r) => r.email || normName(r.name) || r.id;
  const startNew = (r) => {
    const key = payerKey(r);
    if (!drafts[key]) {
      const words = String(r.name || "").trim().split(/\s+/).filter(Boolean);
      setDrafts((d) => ({ ...d, [key]: { first_name: words[0] || "", last_name: words.slice(1).join(" "), group_name: "", coffee: true, drinks: false, duty: true } }));
    }
    // Other payments from the same payer that nobody was chosen for go to the same new person.
    setChoice((c) => Object.fromEntries(Object.entries(c).map(([id, v]) => {
      const row = rows.find((x) => x.id === id);
      const same = id === r.id || (!v.personId && !v.skip && row && payerKey(row) === key && row.state !== "booked" && row.state !== "ignored");
      return [id, same ? { ...v, personId: `new:${key}`, include: true } : v];
    })));
  };
  const setDraft = (key, patch) => setDrafts((d) => ({ ...d, [key]: { ...d[key], ...patch } }));

  const open = rows.filter((r) => r.state !== "booked" && r.state !== "ignored");
  const toBook = open.filter((r) => choice[r.id].include && choice[r.id].personId && !choice[r.id].skip);
  const toSkip = open.filter((r) => choice[r.id].skip);
  const count = (s) => rows.filter((r) => r.state === s).length;
  const skippedTotal = Object.values(statement.skipped).reduce((a, b) => a + b, 0);
  const order = { unknown: 0, suggested: 1, matched: 2 };
  const shown = [...open].sort((a, b) => order[a.state] - order[b.state] || a.date.localeCompare(b.date));

  const save = () => run(async () => {
    // Create the new people first, then book their payments like any other.
    const created = {};
    for (const key of new Set(toBook.map((r) => choice[r.id].personId).filter((id) => id.startsWith("new:")).map((id) => id.slice(4)))) {
      const d = drafts[key];
      if (!d.first_name.trim() || !d.last_name.trim()) throw new Error("Please give a first and last name for every new person.");
      const p = await api.savePerson({
        first_name: d.first_name.trim(), last_name: d.last_name.trim(), group_name: d.group_name || null,
        active_coffee: d.coffee, active_drinks: d.drinks, active_duty: d.duty, duty_rounds_before: data.round,
      });
      created[`new:${key}`] = p.id;
    }
    const idOf = (r) => created[choice[r.id].personId] ?? choice[r.id].personId;
    const aliases = [];
    if (remember) {
      for (const r of toBook) {
        const person_id = idOf(r);
        if (r.email) aliases.push({ person_id, kind: "email", value: r.email });
        if (normName(r.name)) aliases.push({ person_id, kind: "name", value: normName(r.name) });
      }
    }
    // One alias per key; the last choice wins.
    const uniq = [...new Map(aliases.map((a) => [`${a.kind}:${a.value}`, a])).values()];
    await api.importPaypal({
      payments: toBook.map((r) => ({
        person_id: idOf(r), paid_on: r.date, amount: r.amount, external_id: r.id,
        payer: [r.name, r.email].filter(Boolean).join(" · "), note: r.note || null,
      })),
      aliases: uniq,
      ignored: toSkip.map((r) => ({ external_id: r.id, payer: r.name || r.email, amount: r.amount, paid_on: r.date })),
    });
    toast(`${toBook.length} payment${toBook.length === 1 ? "" : "s"} recorded (${fmtEUR(toBook.reduce((s, r) => s + r.amount, 0))})${toSkip.length ? `, ${toSkip.length} marked as not coffee money` : ""}`);
    onDone();
  });

  return html`<section>
    <${Figures} items=${[
      { label: "Incoming payments", value: rows.length, sub: skippedTotal ? `${skippedTotal} other rows left out` : "in this file" },
      { label: "Matched", value: count("matched"), tone: count("matched") ? "pos" : "", sub: "ready to record" },
      { label: "To check", value: count("suggested") + count("unknown"), tone: count("suggested") + count("unknown") ? "neg" : "", sub: "choose who paid" },
      { label: "Already done", value: count("booked") + count("ignored"), sub: "recorded or skipped before" },
    ]} />
    ${skippedTotal > 0 && html`<p class="small muted" style="margin-top:-16px">Left out: ${Object.entries(statement.skipped).map(([k, v]) => `${v} ${k}`).join(" · ")}.</p>`}

    ${shown.length === 0 ? html`<${EmptyState} drawing=${html`<${ReceiptCarrier} size=${110} />`}
        action=${html`<button class="btn" onClick=${onClear}>Choose another file</button>`}>Everything in this file has already been recorded or skipped.<//>`
      : html`<div class="table-wrap"><table class="data normal">
        <thead><tr><th>Date</th><th>From (PayPal)</th><th class="num">Amount</th><th>Person</th><th class="center">Record</th><th></th></tr></thead>
        <tbody>${shown.map((r) => {
          const c = choice[r.id];
          return html`<tr key=${r.id} class=${c.skip ? "inactive" : ""}>
            <td>${fmtDate(r.date)}</td>
            <td>${r.name || "—"}<div class="small muted">${r.email}${r.note ? ` · “${r.note}”` : ""}</div></td>
            <td class="num">${fmtEUR(r.amount)}</td>
            <td>${c.skip ? html`<span class="muted">not coffee money</span>` : html`
              <select aria-label=${`Person for ${r.name || r.email}`} value=${c.personId} style="min-width:200px"
                onChange=${(e) => (e.target.value === "new" ? startNew(r) : set(r.id, { personId: e.target.value, include: !!e.target.value }))}>
                <option value="">Who paid?</option>
                <option value=${c.personId.startsWith("new:") ? c.personId : "new"}>+ New person…</option>
                ${people.map((p) => html`<option value=${p.id}>${p.last_name}, ${p.first_name}${p.group_name ? ` (${p.group_name})` : ""}</option>`)}
              </select>
              ${c.personId.startsWith("new:")
                ? html`<${NewPerson} draft=${drafts[c.personId.slice(4)]} groups=${data.groups}
                    shared=${shown.findIndex((x) => choice[x.id].personId === c.personId) !== shown.indexOf(r)}
                    onChange=${(patch) => setDraft(c.personId.slice(4), patch)} />`
                : html`<div class="small ${r.state === "matched" ? "pos" : "muted"}">${r.match.how ? `${r.state === "matched" ? "✓ " : "suggested: "}${r.match.how}` : "no match"}</div>`}`}</td>
            <td class="center"><input type="checkbox" aria-label="Record this payment" checked=${c.include && !c.skip} disabled=${!c.personId || c.skip}
              onChange=${(e) => set(r.id, { include: e.target.checked })} /></td>
            <td class="num">${c.skip
              ? html`<button class="btn-text" onClick=${() => set(r.id, { skip: false })}>Undo</button>`
              : html`<button class="btn-text" title="Not a coffee payment; don't offer it again" onClick=${() => set(r.id, { skip: true, include: false })}>Not coffee</button>`}</td>
          </tr>`;
        })}</tbody>
      </table></div>
      <div class="row save-bar">
        <label class="check"><input type="checkbox" checked=${remember} onChange=${(e) => setRemember(e.target.checked)} />
          Remember these PayPal names and e-mails for next time</label>
        <span class="spacer"></span>
        <button class="btn-text" onClick=${onClear}>Cancel</button>
        <button class="btn primary" disabled=${busy || (!toBook.length && !toSkip.length)} onClick=${save}>
          Record ${toBook.length} payment${toBook.length === 1 ? "" : "s"} · ${fmtEUR(toBook.reduce((s, r) => s + r.amount, 0))}</button>
      </div>`}
    ${(count("booked") + count("ignored")) > 0 && html`<button class="btn-text" style="margin-top:8px" onClick=${() => setShowDone(!showDone)}>
      ${showDone ? "Hide" : "Show"} the ${count("booked") + count("ignored")} already handled</button>`}
    ${showDone && html`<div class="table-wrap" style="margin-top:8px"><table class="data">
      <tbody>${rows.filter((r) => r.state === "booked" || r.state === "ignored").map((r) => html`<tr class="inactive">
        <td>${fmtDate(r.date)}</td><td>${r.name || r.email}</td><td class="num">${fmtEUR(r.amount)}</td>
        <td>${r.state === "booked" ? "recorded" : "marked as not coffee money"}</td>
        <td class="num">${r.state === "ignored" && html`<button class="btn-text" onClick=${() => run(async () => { await api.unignore(r.id); onDone(); })}>Offer again</button>`}</td>
      </tr>`)}</tbody></table></div>`}
  </section>`;
}

/** Name, group and lists for a payer who isn't in the app yet (created when the payments are recorded). */
function NewPerson({ draft, groups, shared, onChange }) {
  if (shared) return html`<div class="small muted">the same new person as above</div>`;
  return html`<div class="grid new-person" style="gap:6px;margin-top:6px">
    <div class="row" style="gap:6px;flex-wrap:nowrap">
      <input aria-label="First name" placeholder="First name" value=${draft.first_name} onInput=${(e) => onChange({ first_name: e.target.value })} />
      <input aria-label="Last name" placeholder="Last name" value=${draft.last_name} onInput=${(e) => onChange({ last_name: e.target.value })} />
    </div>
    <select aria-label="Group" value=${draft.group_name} onChange=${(e) => onChange({ group_name: e.target.value })}>
      <option value="">No group</option>${groups.map((g) => html`<option value=${g.name}>${g.name}</option>`)}</select>
    <div class="row" style="gap:10px">
      <label class="check"><input type="checkbox" checked=${draft.coffee} onChange=${(e) => onChange({ coffee: e.target.checked })} /> Coffee list</label>
      <label class="check"><input type="checkbox" checked=${draft.drinks} onChange=${(e) => onChange({ drinks: e.target.checked })} /> Drinks list</label>
      <label class="check"><input type="checkbox" checked=${draft.duty} onChange=${(e) => onChange({ duty: e.target.checked })} /> Kitchen duty</label>
    </div>
  </div>`;
}

function Aliases({ data, reload }) {
  const isPending = usePendingDeletes();
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const list = data.aliases.filter((a) => !isPending(`alias:${a.id}`));
  const forget = (a) => deferDelete({ key: `alias:${a.id}`, message: `Forgot "${a.value}"`, commit: () => api.deleteAlias(a.id), onDone: reload });
  return html`<section style="margin-top:36px">
    <h2>Remembered PayPal payers</h2>
    <p class="lede" style="margin-bottom:12px">Payments from these PayPal names and e-mail addresses are matched automatically.</p>
    ${list.length === 0 ? html`<p class="muted">None yet. They're added when you record payments with "Remember" ticked.</p>`
      : html`<div class="table-wrap"><table class="data">
        <thead><tr><th>PayPal ${"name / e-mail"}</th><th>Kind</th><th>Person</th><th></th></tr></thead>
        <tbody>${list.map((a) => html`<tr key=${a.id}>
          <td>${a.value}</td><td class="muted">${a.kind === "email" ? "e-mail" : "name"}</td><td>${personName(byId.get(a.person_id))}</td>
          <td class="num"><span class="row-actions"><${ConfirmAction} label="Forget" question="Stop matching this automatically?" actions=${[{ label: "Forget", danger: true, onClick: () => forget(a) }]} /></span></td>
        </tr>`)}</tbody></table></div>`}
  </section>`;
}
