// Kitchen-duty availability without an account: the page behind the QR code.
import { html, useState, useLoad, Loading, Field, useBusy } from "../lib/ui.js";
import * as api from "../lib/api.js";
import { weeksFrom, weekLabel } from "../lib/dates.js";
import { StatusCup } from "../lib/drawings.js";
import { STATUS } from "./availability.js";

export const GUEST_KEY = "pc:guest"; // name and group, to fill in the register form afterwards

export function GuestAvailabilityPage({ groups, appName }) {
  const info = useLoad(() => api.guestAvailabilityInfo());
  const [form, setForm] = useState({ first: "", last: "", group: "" });
  const [draft, setDraft] = useState({});
  const [result, setResult] = useState(null);
  const [busy, run] = useBusy();
  const set = (k) => (e) => { const v = e.target.value; setForm((f) => ({ ...f, [k]: v })); };
  const setWeek = (w, patch) => setDraft((d) => ({ ...d, [w]: { note: "", ...d[w], ...patch } }));

  const submit = (weeks) => (e) => {
    e.preventDefault();
    run(async () => {
      const answers = weeks.filter((w) => draft[w]?.status).map((w) => ({ week: w, status: draft[w].status, note: draft[w].note || "" }));
      if (!answers.length) throw new Error("Please answer at least one week.");
      const res = await api.submitGuestAvailability(form.first.trim(), form.last.trim(), form.group, answers);
      try { sessionStorage.setItem(GUEST_KEY, JSON.stringify(form)); } catch { /* storage unavailable */ }
      setResult({ ...res, answered: answers.length });
    });
  };

  return html`<div class="auth-wrap guest">
    <div class="card auth-card guest-card">
      <h1>Kitchen-duty availability</h1>
      ${result ? html`<${Done} result=${result} first=${form.first} />` : html`
      <p class="lede">For the ${appName} kitchen duty. No account needed: tell us who you are and which weeks
        suit you. <a href="#/signin">Have an account? Sign in instead.</a></p>
      <${Loading} state=${info}>${({ weeks_ahead: ahead, free_weeks: free }) => {
        const freeSet = new Set(free);
        const weeks = weeksFrom(Number(ahead) || 6).filter((w) => !freeSet.has(w));
        return html`<form class="grid" onSubmit=${submit(weeks)}>
          <div class="form-grid">
            <${Field} label="First name"><input required value=${form.first} onInput=${set("first")} autocomplete="given-name" /><//>
            <${Field} label="Last name"><input required value=${form.last} onInput=${set("last")} autocomplete="family-name" /><//>
          </div>
          <${Field} label="Group"><select required value=${form.group} onChange=${set("group")}>
            <option value="">— choose —</option>${groups.map((g) => html`<option value=${g.name}>${g.name}</option>`)}</select><//>
          <div class="week-grid">${weeks.map((w) => {
            const v = draft[w] || {};
            return html`<div class="week-row">
              <div><b>${weekLabel(w)}</b>
                <input placeholder="Note (optional), e.g. only Mon–Wed" value=${v.note || ""} style="margin-top:6px"
                  onInput=${(e) => setWeek(w, { note: e.target.value })} /></div>
              <div class="seg" role="group" aria-label=${`Availability ${weekLabel(w)}`}>
                ${STATUS.map(([k, l]) => html`<button type="button" class=${v.status === k ? "on" : ""} aria-pressed=${v.status === k}
                  onClick=${() => setWeek(w, { status: k })}>${v.status === k && html`<${StatusCup} state=${k} label="" />`}${l}</button>`)}
              </div>
            </div>`;
          })}</div>
          <p class="small muted">If you answered a week before, your new answer replaces it.</p>
          <button class="btn primary" disabled=${busy}>Send my availability</button>
        </form>`;
      }}<//>`}
    </div>
  </div>`;
}

function Done({ result, first }) {
  return html`<div class="grid">
    <div class="notice ok">${result.matched
      ? html`Thanks, ${first}! Your availability for ${result.saved} week${result.saved === 1 ? " is" : "s is"} saved.`
      : html`Thanks, ${first}! We couldn't find you on the list yet, so a duty manager will connect your answers to you.`}</div>
    ${result.has_account ? html`<div class="card" style="margin:0">
      <h2 style="margin-top:0">You already have an account</h2>
      <p>Next time, please sign in instead: there you can see and change all your answers.</p>
      <div class="row"><a class="btn primary" href="#/signin">Sign in</a></div>
    </div>` : html`<div class="card" style="margin:0">
      <h2 style="margin-top:0">Now please create an account</h2>
      <p>With an account you can see and change your availability, get your duty e-mails and check your coffee balance, and you won't need this form next time.</p>
      <div class="row">
        <a class="btn primary" href="#/register">Register</a>
        <a class="btn" href="#/signin">Sign in</a>
      </div>
    </div>`}
  </div>`;
}
