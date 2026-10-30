import { html, useLoad, Loading, fmtEUR } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { computeLedger } from "../lib/accounting.js";
import { fmtDate, isoDate, mondayOf, addDays, weekLabel } from "../lib/dates.js";
import { Figures, DictEntry, EmptyState, LayeredCup, WeekCalendar } from "../lib/drawings.js";

const hello = () => {
  const h = new Date().getHours();
  return h < 11 ? "Morning" : h < 17 ? "Hello" : "Evening";
};
const tone = (x) => (x < 0 ? "neg" : x > 0 ? "pos" : "");

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
    return html`<div class="greeting"><div><h1>Welcome</h1>
        <p class="lede">${app.profile.suggested_person_id
          ? "Your account is waiting for an admin to connect it to your entry on the coffee list."
          : "Your account isn't connected to an entry on the coffee list yet. An admin will do this for you."} Until then
        there is no balance to show.</p></div></div>
      <${EmptyState} drawing=${html`<${LayeredCup} size=${130} />`}>Your balance and history will appear here once your account is connected.<//>`;
  }

  const low = Number(settings.balance?.low_threshold ?? -10);
  const lists = [person.active_coffee && "Coffee list", person.active_drinks && "Drinks list"].filter(Boolean).join(" · ") || "Not on any list";
  return html`
    <div class="greeting">
      <div><h1>${hello()}, ${person.first_name}.</h1><p class="lede">${lists}</p></div>
      <${DictEntry} word="mug·shot" pos="n.">The face you make when the pot is empty and it's your kitchen week.<//>
    </div>
    <${Loading} state=${state}>${({ ledger, duties }) => html`
      ${ledger.balance < low && html`<div class="notice bad">Your balance is below ${fmtEUR(low)}. Please top it up${settings.payment_info ? " (see below)" : ""}.</div>`}
      <${Figures} items=${[
        { label: "Balance", value: fmtEUR(ledger.balance), tone: tone(ledger.balance), sub: "after all counts and payments" },
        { label: "Coffees", value: ledger.coffees, sub: fmtEUR(ledger.coffeeCost) },
        { label: "Drinks", value: ledger.drinks, sub: fmtEUR(ledger.drinksCost) },
        { label: "Paid in", value: fmtEUR(ledger.paid), sub: "all payments so far" },
      ]} />
      <div class="grid cols-2">
        <div>
          <h2>Kitchen duty</h2>
          ${duties.length
            ? html`<div class="table-wrap"><table class="data normal"><tbody>
                ${duties.map((d) => html`<tr><td>${weekLabel(d.week_start)}</td><td class="muted">${d.note || ""}</td></tr>`)}
              </tbody></table></div>`
            : html`<${EmptyState} drawing=${html`<${WeekCalendar} size=${96} />`}
                action=${html`<a class="btn" href="#/availability">Update availability</a>`}>No duty coming up.<//>`}
        </div>
        ${settings.payment_info && html`<div><h2>How to pay</h2>
          <div class="card"><p style="white-space:pre-line;margin:0;font-family:var(--font-text);font-size:16px">${settings.payment_info}</p></div></div>`}
      </div>
      <h2 class="section-title">History</h2>
      <div class="table-wrap"><table class="data normal">
        <thead><tr><th>Date</th><th>What</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${[...ledger.entries].reverse().map((e) => html`<tr>
            <td>${fmtDate(e.date)}</td>
            <td>${e.kind === "payment" ? `Payment${e.note ? ` (${e.note})` : ""}` : `${e.quantity} × ${e.kind === "coffee" ? "coffee" : "drink"} at ${fmtEUR(e.unit)}`}</td>
            <td class="num ${tone(e.amount)}">${fmtEUR(e.amount)}</td></tr>`)}
        </tbody>
      </table></div>`}<//>`;
}
