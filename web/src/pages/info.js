import { html, useState, useEffect, useLoad, Loading, Field, toast, useBusy, fmtEUR, ConfirmAction, deferDelete, usePendingDeletes } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { markdown } from "../lib/markdown.js";
import { DEFAULT_INFO, DEFAULT_ADMIN_INFO } from "../lib/info-defaults.js";
import { priceAt } from "../lib/accounting.js";
import { isoDate, fmtDate } from "../lib/dates.js";
import { DictEntry } from "../lib/drawings.js";

export function InfoPage() {
  const app = useApp();
  // Captured once per visit, so the "new" marks stay while reading.
  const [seenBefore] = useState(() => app.profile.updates_seen_at || app.profile.created_at || "");
  // Mark the updates as seen; the next sign-in only reacts to newer ones.
  useEffect(() => {
    api.updateProfile(app.user.id, { updates_seen_at: new Date().toISOString() }).catch(() => {});
  }, []);
  const state = useLoad(async () => {
    const [updates, settings, prices] = await Promise.all([api.listUpdates(), api.loadSettings(), api.listPrices()]);
    return { updates, settings, prices };
  });
  return html`
    <div class="page-head"><div><h1>Info</h1><p>News first, then how everything works.</p></div></div>
    <${StartupNotice} app=${app} />
    <${Loading} state=${state}>${({ updates, settings, prices }) => {
      const today = isoDate();
      const vars = {
        coffee_price: fmtEUR(priceAt(prices, "coffee", today)),
        drinks_price: fmtEUR(priceAt(prices, "drinks", today)),
        low_threshold: fmtEUR(settings.balance?.low_threshold ?? -10),
        weeks_ahead: settings.availability?.weeks_ahead ?? 6,
        app_url: api.appUrl(),
      };
      return html`<div>
        <${Updates} updates=${updates} admin=${app.isAdmin} reload=${state.reload} seenBefore=${seenBefore} />
        <${InfoBlock} title="How it works" settingKey="info" text=${settings.info} fallback=${DEFAULT_INFO}
          vars=${vars} editable=${app.isAdmin} reload=${state.reload} />
        ${app.seesAdminMessages && html`<${InfoBlock} title="For admins" note="Only admins and group admins see this part." settingKey="info_admin"
          text=${settings.info_admin} fallback=${DEFAULT_ADMIN_INFO} vars=${vars} editable=${app.isAdmin} reload=${state.reload} />`}
        <div style="margin-top:32px">
          <${DictEntry} word="de·cof·fi·cit" pos="n.">The gap between how many coffees were marked and how many were actually drunk.<//>
        </div>
      </div>`;
    }}<//>`;
}

function Updates({ updates, admin, reload, seenBefore }) {
  const app = useApp();
  const [editing, setEditing] = useState(null); // null | {} (new) | update
  const isPending = usePendingDeletes();
  const visible = updates.filter((u) => !isPending(`update:${u.id}`) && (app.seesAdminMessages || u.audience !== "admins"));
  const remove = (u) => deferDelete({ key: `update:${u.id}`, message: `Update "${u.title}" deleted`, commit: () => api.deleteUpdate(u.id), onDone: reload });
  return html`<section class="updates">
    <div class="row" style="margin-bottom:12px"><h2 style="margin:0">Updates</h2><span class="spacer"></span>
      ${admin && !editing && html`<button class="btn small" onClick=${() => setEditing({ audience: "all" })}>Post an update</button>`}
    </div>
    ${editing && html`<${UpdateForm} update=${editing} onDone=${() => { setEditing(null); reload(); }} onCancel=${() => setEditing(null)} />`}
    ${visible.length === 0 && !editing && html`<p class="lede">No news right now.</p>`}
    ${visible.map((u) => html`<article class="update ${u.pinned ? "pinned" : ""}" key=${u.id}>
      <div class="update-meta">
        ${fmtDate(u.created_at.slice(0, 10))}
        ${seenBefore && u.created_at > seenBefore && u.created_by !== app.user.id && html`<span class="badge bad">new</span>`}
        ${u.pinned && html`<span class="badge">pinned</span>`}
        ${u.audience === "admins" && html`<span class="badge accent">admins only</span>`}
      </div>
      <h3>${u.title}</h3>
      ${u.body && html`<div class="prose" dangerouslySetInnerHTML=${{ __html: markdown(u.body) }}></div>`}
      ${admin && html`<div class="row" style="gap:14px;margin-top:6px">
        <button class="btn-text" onClick=${() => setEditing(u)}>Edit</button>
        <${ConfirmAction} question="Delete this update?" align="left" onConfirm=${() => remove(u)} />
      </div>`}
    </article>`)}
  </section>`;
}

function UpdateForm({ update, onDone, onCancel }) {
  const app = useApp();
  const [u, setU] = useState({ title: "", body: "", audience: "all", pinned: false, ...update });
  const [busy, run] = useBusy();
  const set = (k, v) => setU((x) => ({ ...x, [k]: v }));
  return html`<form class="card" onSubmit=${(e) => { e.preventDefault(); run(async () => { await api.saveUpdate(u, app.user.id); toast(u.id ? "Update saved" : "Update posted"); onDone(); }); }}>
    <div class="grid" style="gap:12px">
      <${Field} label="Title"><input required value=${u.title} onInput=${(e) => set("title", e.target.value)} /><//>
      <${Field} label="Text" hint="Blank line = new paragraph; '- ' for lists; **bold**; links and e-mail addresses become clickable.">
        <textarea rows="5" value=${u.body} onInput=${(e) => set("body", e.target.value)}></textarea><//>
      <div class="row">
        <div class="seg" role="group" aria-label="Who sees it">
          <button type="button" class=${u.audience === "all" ? "on" : ""} aria-pressed=${u.audience === "all"} onClick=${() => set("audience", "all")}>Everyone</button>
          <button type="button" class=${u.audience === "admins" ? "on" : ""} aria-pressed=${u.audience === "admins"} onClick=${() => set("audience", "admins")}>Admins and group admins</button>
        </div>
        <label class="check"><input type="checkbox" checked=${u.pinned} onChange=${(e) => set("pinned", e.target.checked)} /> Keep at the top</label>
        <span class="spacer"></span>
        <button type="button" class="btn-text" onClick=${onCancel}>Cancel</button>
        <button class="btn primary" disabled=${busy}>${u.id ? "Save" : "Post"}</button>
      </div>
    </div>
  </form>`;
}

function InfoBlock({ title, note, settingKey, text, fallback, vars, editable, reload }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, run] = useBusy();
  const current = text || fallback;
  const save = (value) => run(async () => {
    await api.saveSetting(settingKey, value);
    toast(value ? "Info saved" : "Back to the suggested text");
    setEditing(false);
    reload();
  });
  return html`<section class="info-block">
    <div class="row info-head"><h2 style="margin:0">${title}</h2><span class="spacer"></span>
      ${editable && !editing && html`<button class="btn-text" onClick=${() => { setDraft(current); setEditing(true); }}>Edit</button>`}
    </div>
    ${note && html`<p class="lede" style="margin-bottom:8px">${note}</p>`}
    ${editing ? html`<div class="info-editor">
        <${Field} label="Text" hint="Placeholders: {coffee_price}, {drinks_price}, {low_threshold}, {weeks_ahead}, {app_url}. '## ' starts a section.">
          <textarea rows="22" value=${draft} onInput=${(e) => setDraft(e.target.value)}></textarea><//>
        <div class="prose preview" dangerouslySetInnerHTML=${{ __html: markdown(draft, vars) }}></div>
        <div class="row" style="grid-column:1/-1">
          ${text && html`<${ConfirmAction} label="Use suggested text" question="Replace with the suggested text?" align="left"
            actions=${[{ label: "Replace", danger: true, onClick: () => save("") }]} />`}
          <span class="spacer"></span>
          <button class="btn-text" onClick=${() => setEditing(false)}>Cancel</button>
          <button class="btn primary" disabled=${busy} onClick=${() => save(draft)}>Save</button>
        </div>
      </div>`
      : html`<div class="prose" dangerouslySetInnerHTML=${{ __html: markdown(current, vars) }}></div>`}
  </section>`;
}

/** Shown while this page opens at sign-in: lets the person switch that off (or back on). */
function StartupNotice({ app }) {
  const [busy, run] = useBusy();
  const skip = app.profile.skip_info;
  const toggle = () => run(async () => {
    await api.updateProfile(app.user.id, { skip_info: !skip });
    toast(skip ? "Info will open again when you sign in" : "Info won't open at sign-in any more; it's always under INFO in the menu");
    await app.refresh();
  });
  if (skip) {
    return html`<p class="small muted" style="margin:-12px 0 20px">This page doesn't open at sign-in.
      <button class="btn-text" disabled=${busy} onClick=${toggle}>Show it at sign-in again</button></p>`;
  }
  return html`<div class="notice ok startup-notice">
    <span>Welcome! This page opens first when you sign in, so you don't miss news.</span>
    <span class="row" style="gap:14px">
      <a class="btn-text" href="#/">Go to My account</a>
      <button class="btn small" disabled=${busy} onClick=${toggle}>Don't show at sign-in</button>
    </span>
  </div>`;
}
