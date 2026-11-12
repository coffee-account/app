import { html, useLoad, Loading, fmtEUR } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { computeLedger, availabilityRules } from "../lib/accounting.js";
import { fmtDate, isoDate, mondayOf, addDays, weekLabel, weeksFrom } from "../lib/dates.js";
import { Figures, DictEntry, EmptyState, LayeredCup, StatusCup } from "../lib/drawings.js";
import { STATUS } from "./availability.js";

const statusLabel = Object.fromEntries(STATUS);
import { GettingStarted } from "../lib/guide.js";

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
    const { weeksAhead } = availabilityRules(settings);
    const weeks = weeksFrom(Math.max(weeksAhead, 4));
    const [allDuties, availability, free] = await Promise.all([
      api.listDuties(mondayOf(), addDays(isoDate(), 365)),
      api.listAvailability(weeks[0], weeks[weeks.length - 1], person.id),
      api.listDutyFreeWeeks(),
    ]);
    const duties = allDuties.filter((d) => d.person_id === person.id);
    return { ledger, duties, weeks, availability, free: new Map(free.map((f) => [f.week_start, f])) };
  }, [person?.id]);

  if (!person) {
    return html`<div class="greeting"><div><h1>Welcome</h1>
        <p class="lede">${app.profile.suggested_person_id
          ? "Your account is waiting for an admin to connect it to your entry on the coffee list."
          : "Your account isn't connected to an entry on the coffee list yet. An admin will do this for you."} Until then
        there is no balance to show.</p></div></div>
      <${GettingStarted} app=${app} ledger=${null} />
      <${EmptyState} drawing=${html`<${LayeredCup} size=${130} />`}>Your balance and history will appear here once your account is connected.<//>`;
  }

  const low = Number(settings.balance?.low_threshold ?? -10);
  const lists = [person.active_coffee && "Coffee list", person.active_drinks && "Drinks list"].filter(Boolean).join(" · ") || "Not on any list";
  return html`
    <div class="greeting">
      <div><h1>${hello()}, ${person.first_name}.</h1><p class="lede">${lists}</p></div>
      <${DictEntry} word="mug·shot" pos="n.">The face you make when the pot is empty and it's your kitchen week.<//>
    </div>
    <${Loading} state=${state}>${({ ledger, duties, weeks, availability, free }) => html`
      <${GettingStarted} app=${app} ledger=${ledger} />
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
          <${DutyWeeks} duties=${duties} weeks=${weeks} availability=${availability} free=${free} />
        </div>
        ${(settings.payment_info || settings.payment_qr) && html`<div><h2>How to pay</h2>
          <div class="card pay-card">
            ${settings.payment_info && html`<p style="white-space:pre-line;margin:0;font-family:var(--font-text);font-size:16px">${settings.payment_info}</p>`}
            ${settings.payment_qr && html`<figure><img class="pay-qr" src=${settings.payment_qr} alt="PayPal QR code" /><figcaption class="small muted">Scan with the PayPal app</figcaption></figure>`}
          </div></div>`}
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

/** The coming weeks with what you answered and whether you're on duty; later duties are listed below them. */
function DutyWeeks({ duties, weeks, availability, free }) {
  const mine = new Map(availability.map((a) => [a.week_start, a]));
  const onDuty = new Map(duties.map((d) => [d.week_start, d]));
  const later = duties.filter((d) => !weeks.includes(d.week_start));
  const unanswered = weeks.filter((w) => !free.has(w) && !mine.has(w)).length;
  return html`<div>
    <div class="table-wrap"><table class="data normal">
      <thead><tr><th>Week</th><th>Your availability</th><th></th></tr></thead>
      <tbody>
        ${weeks.map((w) => {
          const a = mine.get(w);
          const d = onDuty.get(w);
          return html`<tr class=${free.has(w) ? "inactive" : ""}>
            <td style="white-space:nowrap">${weekLabel(w)}</td>
            <td>${free.has(w) ? html`<span class="muted">No kitchen duty${free.get(w).note ? ` (${free.get(w).note})` : ""}</span>`
              : html`<span class="avail-cell"><${StatusCup} state=${a?.status} label="" />${a ? statusLabel[a.status] : html`<span class="muted">not answered</span>`}</span>
                ${a?.note && html`<div class="small muted">${a.note}</div>`}`}</td>
            <td class="num">${d && html`<span class="badge ok" title=${d.note || ""}>on duty</span>`}</td>
          </tr>`;
        })}
        ${later.map((d) => html`<tr><td style="white-space:nowrap">${weekLabel(d.week_start)}</td><td class="muted">${d.note || ""}</td>
          <td class="num"><span class="badge ok">on duty</span></td></tr>`)}
      </tbody>
    </table></div>
    <div class="row" style="margin-top:10px">
      ${unanswered > 0 && html`<span class="small muted">${unanswered} week${unanswered > 1 ? "s" : ""} not answered yet</span>`}
      <span class="spacer"></span>
      <a class="btn small" href="#/availability">Update availability</a>
    </div>
  </div>`;
}
