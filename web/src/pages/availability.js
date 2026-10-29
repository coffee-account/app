import { html, useState, useEffect, useLoad, Loading, toast, useBusy } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { availabilityRules, availabilityRequired } from "../lib/accounting.js";
import { weeksFrom, weekLabel } from "../lib/dates.js";
import { StatusCup, FillLevel } from "../lib/drawings.js";

export const STATUS = [
  ["available", "Available"],
  ["if_needed", "If needed"],
  ["unavailable", "Not available"],
];

export function AvailabilityPage() {
  const app = useApp();
  const { person, settings } = app;
  const { weeksAhead } = availabilityRules(settings);
  const [extra, setExtra] = useState(0);
  const weeks = weeksFrom(weeksAhead + extra);
  const state = useLoad(() => api.listAvailability(weeks[0], weeks[weeks.length - 1], person.id), [person.id, extra]);
  const [draft, setDraft] = useState({});
  const [busy, run] = useBusy();

  useEffect(() => {
    if (state.data) setDraft(Object.fromEntries(state.data.map((r) => [r.week_start, { status: r.status, note: r.note || "" }])));
  }, [state.data]);

  const required = availabilityRequired(settings, person);
  const mandatoryWeeks = new Set(weeksFrom(weeksAhead));
  const missing = weeks.filter((w) => mandatoryWeeks.has(w) && !draft[w]?.status);

  const setWeek = (w, patch) => setDraft((d) => ({ ...d, [w]: { note: "", ...d[w], ...patch } }));
  const setAll = (status) => setDraft((d) => Object.fromEntries(weeks.map((w) => [w, { note: "", ...d[w], status: d[w]?.status || status }])));

  const save = () => run(async () => {
    const rows = Object.entries(draft).filter(([, v]) => v.status).map(([week_start, v]) => ({
      person_id: person.id, week_start, status: v.status, note: v.note || null,
    }));
    await api.saveAvailability(rows);
    toast("Availability saved");
    await app.refresh();
  });

  return html`
    <div class="page-head"><div><h1>My availability</h1>
      <p>${required
        ? `Keep the next ${weeksAhead} weeks answered so kitchen duty can be planned fairly.`
        : "Optional for you, but it helps the duty managers plan."}</p></div></div>
    <${Loading} state=${state}>${() => html`
      <div class="toolbar">
        <${FillLevel} value=${weeksAhead - missing.length} max=${weeksAhead} label="Weeks answered" />
        <span class="spacer"></span>
        <span class="small muted">Fill empty weeks with</span>
        <div class="seg" role="group" aria-label="Fill all empty weeks">
          ${STATUS.map(([k, l]) => html`<button onClick=${() => setAll(k)}><${StatusCup} state=${k} label="" />${l}</button>`)}
        </div>
      </div>
      <div class="week-grid">
        ${weeks.map((w) => {
          const v = draft[w] || {};
          return html`<div class="week-row ${required && mandatoryWeeks.has(w) && !v.status ? "missing" : ""}">
            <div>
              <div><b>${weekLabel(w)}</b>${required && mandatoryWeeks.has(w) && !v.status && html` <span class="missing-word">not answered</span>`}</div>
              <input placeholder="Note (optional), e.g. only Mon–Wed" value=${v.note || ""} style="margin-top:6px"
                onInput=${(e) => setWeek(w, { note: e.target.value })} />
            </div>
            <div class="seg" role="group" aria-label=${`Availability ${weekLabel(w)}`}>
              ${STATUS.map(([k, l]) => html`<button class=${v.status === k ? "on" : ""} aria-pressed=${v.status === k}
                onClick=${() => setWeek(w, { status: k })}>${v.status === k && html`<${StatusCup} state=${k} label="" />`}${l}</button>`)}
            </div>
          </div>`;
        })}
      </div>
      <div class="row" style="margin-top:14px">
        <button class="btn-text" onClick=${() => setExtra(extra + 4)}>Show 4 more weeks</button>
        <span class="spacer"></span>
        ${required && missing.length > 0 && html`<span class="badge warn">${missing.length} week${missing.length > 1 ? "s" : ""} not answered</span>`}
        <button class="btn primary" disabled=${busy} onClick=${save}>Save availability</button>
      </div>`}<//>`;
}
