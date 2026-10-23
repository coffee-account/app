import { html, useLoad, Loading, fmtEUR } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { computeLedger } from "../lib/accounting.js";
import { fmtDate, isoDate, mondayOf, addDays, weekLabel } from "../lib/dates.js";

export function HomePage() {
  const app = useApp();
  const { person, settings } = app;
  const state = useLoad(async () => {
    if (!person) return null;
    const data = await api.loadLedgerData(person.id);
    const ledger = computeLedger(data).get(person.id);
    const duties = (await api.listDuties(mondayOf(), addDays(isoDate(), 365))).filter((d) => d.person_id === person.id);
    return { ledger, duties };
  }, [person?.id]);

  if (!person) {
    return html`<div class="page-head"><div><h1>Welcome</h1></div></div>
      <div class="notice info">${app.profile.suggested_person_id
        ? "Your account is waiting for an admin to connect it to your entry on the coffee/drinks list."
        : "Your account is not connected to an entry on the coffee/drinks list yet. An admin will do this for you."}
      Until then you cannot see a balance.</div>`;
  }

  const low = Number(settings.balance?.low_threshold ?? -10);
  return html`
    <div class="page-head"><div><h1>Hi ${person.first_name}</h1>
      <p>${[person.active_coffee && "Coffee list", person.active_drinks && "Drinks list"].filter(Boolean).join(" · ") || "Not on any list"}</p></div></div>
    <${Loading} state=${state}>${({ ledger, duties }) => html`
      ${ledger.balance < low && html`<div class="notice bad"><b>Your balance is low.</b> Please top it up.</div>`}
      <div class="grid cols-3">
        <div class="card"><div class="stat-label">Balance</div>
          <div class="stat ${ledger.balance < 0 ? "neg" : "pos"}">${fmtEUR(ledger.balance)}</div></div>
        <div class="card"><div class="stat-label">Coffees / drinks</div>
          <div class="stat">${ledger.coffees} / ${ledger.drinks}</div>
          <div class="small muted">${fmtEUR(ledger.coffeeCost)} / ${fmtEUR(ledger.drinksCost)}</div></div>
        <div class="card"><div class="stat-label">Paid in total</div><div class="stat">${fmtEUR(ledger.paid)}</div>
          <div class="small muted">${settings.balance?.starting_label || "Starting balance"}: ${fmtEUR(person.starting_balance)}</div></div>
      </div>
      ${settings.payment_info && html`<div class="card"><h3>How to pay</h3><p style="white-space:pre-line;margin:0">${settings.payment_info}</p></div>`}
      <div class="card">
        <h3>Your kitchen duty</h3>
        ${duties.length
          ? html`<ul style="margin:0;padding-left:18px">${duties.map((d) => html`<li>${weekLabel(d.week_start)}${d.note ? ` — ${d.note}` : ""}</li>`)}</ul>`
          : html`<p class="muted" style="margin:0">No upcoming duty. <a href="#/availability">Update your availability</a>.</p>`}
      </div>
      <div class="card">
        <h3>History</h3>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Date</th><th>What</th><th class="num">Amount</th></tr></thead>
          <tbody>
            ${[...ledger.entries].reverse().map((e) => html`<tr>
              <td>${fmtDate(e.date)}</td>
              <td>${e.kind === "payment" ? `Payment${e.note ? ` (${e.note})` : ""}` : `${e.quantity} × ${e.kind === "coffee" ? "coffee" : "drink"} à ${fmtEUR(e.unit)}`}</td>
              <td class="num ${e.amount < 0 ? "neg" : "pos"}">${fmtEUR(e.amount)}</td></tr>`)}
            <tr><td></td><td>${settings.balance?.starting_label || "Starting balance"}</td><td class="num">${fmtEUR(person.starting_balance)}</td></tr>
          </tbody>
        </table></div>
      </div>`}<//>`;
}
