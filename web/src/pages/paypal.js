import { html, useState, useMemo, useLoad, Loading, toast, useBusy, fmtEUR, ConfirmAction, deferDelete, usePendingDeletes } from "../lib/ui.js";
import * as api from "../lib/api.js";
import { personName, sortPeople } from "../lib/accounting.js";
import { fmtDate } from "../lib/dates.js";
import { readStatement, matchPayer, normName } from "../lib/paypal.js";
import { Figures, EmptyState, ReceiptCarrier } from "../lib/drawings.js";

export function PaypalPage() {
  const state = useLoad(async () => {
    const [people, payments, aliases, ignored] = await Promise.all([api.listPeople(), api.listPayments(), api.listAliases(), api.listIgnored()]);
    return { people, payments, aliases, ignored };
  });
  const [statement, setStatement] = useState(null);
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
      <p>Book PayPal payments from a statement download. Known payers are matched for you; nothing is saved until you confirm.</p></div></div>
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
    <${Loading} state=${state}>${(data) => html`<div>
      ${statement && html`<${Review} key=${fileName} statement=${statement} data=${data}
        onDone=${() => { state.reload(); }} onClear=${() => { setStatement(null); setFileName(""); setInputKey((k) => k + 1); }} />`}
      <${Aliases} data=${data} reload=${state.reload} />
    </div>`}<//>`;
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

  const open = rows.filter((r) => r.state !== "booked" && r.state !== "ignored");
  const toBook = open.filter((r) => choice[r.id].include && choice[r.id].personId && !choice[r.id].skip);
  const toSkip = open.filter((r) => choice[r.id].skip);
  const count = (s) => rows.filter((r) => r.state === s).length;
  const skippedTotal = Object.values(statement.skipped).reduce((a, b) => a + b, 0);
  const order = { unknown: 0, suggested: 1, matched: 2 };
  const shown = [...open].sort((a, b) => order[a.state] - order[b.state] || a.date.localeCompare(b.date));

  const save = () => run(async () => {
    const aliases = [];
    if (remember) {
      for (const r of toBook) {
        const person_id = choice[r.id].personId;
        if (r.email) aliases.push({ person_id, kind: "email", value: r.email });
        if (normName(r.name)) aliases.push({ person_id, kind: "name", value: normName(r.name) });
      }
    }
    // One alias per key; the last choice wins.
    const uniq = [...new Map(aliases.map((a) => [`${a.kind}:${a.value}`, a])).values()];
    await api.importPaypal({
      payments: toBook.map((r) => ({
        person_id: choice[r.id].personId, paid_on: r.date, amount: r.amount, external_id: r.id,
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
                onChange=${(e) => set(r.id, { personId: e.target.value, include: !!e.target.value })}>
                <option value="">Who paid?</option>
                ${people.map((p) => html`<option value=${p.id}>${p.last_name}, ${p.first_name}${p.group_name ? ` (${p.group_name})` : ""}</option>`)}
              </select>
              <div class="small ${r.state === "matched" ? "pos" : "muted"}">${r.match.how ? `${r.state === "matched" ? "✓ " : "suggested: "}${r.match.how}` : "no match"}</div>`}</td>
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
