// First steps for new people: the short tour per role and the "Getting started" checklist on My account.
// What someone has finished is kept in profiles.guide_seen: tour parts ("member", "group_admin", "duty",
// "admin") and "checklist" once that is hidden. Someone who gets a new role later sees only the new part.

import { html, useState, useEffect } from "./ui.js";
import * as api from "./api.js";
import { availabilityRules, availabilityRequired } from "./accounting.js";

// path: the page the step opens (its menu entry is highlighted); tab: which tab of that page.
const PARTS = {
  member: (app) => {
    const { weeksAhead, minWeeks } = availabilityRules(app.settings);
    return [
      { path: "", title: "My account", text: "Your balance, every count and payment, and your next kitchen duty." },
      { path: "availability", title: "My availability", text: `Answer the next ${weeksAhead} weeks for kitchen duty. You're only asked again once fewer than ${minWeeks} weeks are answered.` },
      { path: "duties", title: "Duty schedule", text: "Who is on kitchen duty when. You get an e-mail when you're assigned, and a reminder at the start of your week." },
      { path: "issues", title: "Report an issue", text: "Milk ran out, the machine is broken, or something in this app doesn't work? Report it here and the right people get an e-mail." },
    ];
  },
  group_admin: () => [
    { path: "counting", title: "Counting", text: "When a paper list has been collected, an admin opens a count. Open it here, type in the marks for your group, then tick your group as counted." },
    { path: "payments", title: "Payments", text: "Record money that people in your group paid." },
    { path: "accounts", title: "Accounts", text: "New people register themselves. Connect each new account to their name on the list." },
    { path: "people", title: "People", text: "Put people of your group on or off the coffee and drinks lists." },
  ],
  duty: () => [
    { path: "duties", tab: "schedule", title: "Schedule", text: "Assign people per week. The Availability overview tab shows who can when; each assignment e-mails the person straight away." },
    { path: "duties", tab: "rounds", title: "Duty pool", text: "Add or remove people from the duty pool, and see who still owes a duty this round." },
    { path: "emails", title: "E-mails", text: "Edit the texts of the duty e-mails and the availability reminder." },
  ],
  admin: () => [
    { path: "lists", title: "Print lists", text: "When a paper list is full, print new coffee and drinks lists here." },
    { path: "counting", title: "Counting", text: "Open a count for each collected list. Group admins then fill in their own groups; the list shows which groups are still missing." },
    { path: "payments", title: "Payments", text: "Record payments by hand, or import them from a PayPal export under PayPal import." },
    { path: "balances", title: "Balances", text: "See who is below the low-balance limit and remind them." },
    { path: "accounts", title: "Accounts & roles", text: "Connect new accounts and hand out rights: group admin, duty manager, invoices, resolving reports." },
    { path: "duties", tab: "schedule", title: "Duty schedule", text: "Assign weeks in the Schedule tab and manage who is in the Duty pool." },
    { path: "settings", title: "Settings and E-mails", text: "Prices, notifications and the texts of every e-mail the app sends." },
  ],
};

const PART_LABEL = { member: "The basics", group_admin: "For group admins", duty: "For duty managers", admin: "For admins" };

/** The tour parts that fit this user's roles, in order. */
export function tourParts(app) {
  return [
    app.person && "member",
    app.isGroupAdmin && "group_admin",
    app.canManageDuties && !app.isAdmin && "duty",
    app.isAdmin && "admin",
  ].filter(Boolean);
}

export const guideSeen = (app) => new Set(app.profile.guide_seen || []);

/** Parts not seen yet; the tour opens by itself while there are any. */
export const unseenParts = (app) => tourParts(app).filter((p) => !guideSeen(app).has(p));

export async function markGuideSeen(app, keys) {
  const next = [...new Set([...guideSeen(app), ...keys])];
  await api.updateProfile(app.user.id, { guide_seen: next });
  await app.refresh();
}

// The Info page and the checklist reopen the whole tour through this event; the shell listens.
export const openTour = () => window.dispatchEvent(new Event("pc:open-tour"));

/**
 * The tour: a card in the corner (not a pop-up), so the page and its highlighted menu entry stay visible.
 * Each step opens its page, except pages that are still locked; those only say when they open.
 */
export function Tour({ app, parts, locked, onStep, onClose }) {
  const steps = parts.flatMap((p) => PARTS[p](app).map((s, i) => ({ ...s, part: p, first: i === 0 })));
  const [at, setAt] = useState(0);
  const step = steps[at];
  const visit = (s) => {
    onStep(s.path);
    if (!locked(s.path)) location.hash = `#/${s.path}${s.tab ? `?tab=${s.tab}` : ""}`;
  };
  const go = (i) => { setAt(i); visit(steps[i]); };
  useEffect(() => { if (steps[0]) visit(steps[0]); }, []);
  const finish = () => { markGuideSeen(app, parts).catch(() => {}); onClose(); };
  if (!step) return null;
  return html`<aside class="tour-card" role="dialog" aria-label="Tour">
    <div class="row"><span class="small muted">${PART_LABEL[step.part]} · ${at + 1} of ${steps.length}</span><span class="spacer"></span>
      <button class="icon-btn" aria-label="Close the tour" onClick=${finish}>×</button></div>
    <h3>${step.title}</h3>
    <p>${step.text}</p>
    ${locked(step.path) && html`<p class="small muted">Opens once you've filled in your availability.</p>`}
    <div class="row">
      <span class="spacer"></span>
      ${at > 0 && html`<button class="btn-text" onClick=${() => go(at - 1)}>Back</button>`}
      ${at < steps.length - 1
        ? html`<button class="btn primary small" onClick=${() => go(at + 1)}>Next</button>`
        : html`<button class="btn primary small" onClick=${finish}>Done</button>`}
    </div>
  </aside>`;
}

/**
 * "Getting started" on My account. Ticks itself from what the app knows and disappears once
 * everything is done or someone hides it. `ledger` is null while the account isn't connected.
 */
export function GettingStarted({ app, ledger }) {
  const seen = guideSeen(app);
  if (seen.has("checklist")) return null;
  const needsAvailability = availabilityRequired(app.settings, app.person);
  const items = [
    { done: !!app.person, text: app.person ? "Your account is connected to your name on the list." : "Wait for an admin to connect your account to your name on the list." },
    needsAvailability && { done: app.availabilityMissing.length === 0, text: html`Fill in your kitchen-duty availability under <a href="#/availability">My availability</a>.` },
    app.person && { done: (ledger?.paid ?? 0) > 0, text: app.settings.payment_info ? "Pay your starting credit (see How to pay below)." : "Pay your starting credit." },
    { done: seen.has("member") || !app.person, text: html`Take the <button class="btn-text" onClick=${openTour}>short tour</button> of the app.` },
  ].filter(Boolean);
  if (items.every((i) => i.done)) return null;
  const left = items.filter((i) => !i.done).length;
  return html`<div class="card checklist">
    <div class="row"><h2 style="margin:0">Getting started</h2><span class="small muted">${left} of ${items.length} left</span><span class="spacer"></span>
      <button class="btn-text" onClick=${() => markGuideSeen(app, ["checklist"]).catch(() => {})}>Hide</button></div>
    <ul>${items.map((i) => html`<li class=${i.done ? "done" : ""}><span class="tick" aria-hidden="true">${i.done ? "✓" : ""}</span><span>${i.text}</span></li>`)}</ul>
  </div>`;
}
