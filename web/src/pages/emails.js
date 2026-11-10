import { html, useState, useLoad, Loading, Field, toast, useBusy } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { markdown } from "../lib/markdown.js";
import { EMAIL_TEMPLATES, EDITOR_LABEL, mayEditEmail } from "../lib/email-templates.js";

export function EmailsPage() {
  const app = useApp();
  const state = useLoad(() => api.listEmailTemplates());
  const mine = EMAIL_TEMPLATES.filter((t) => mayEditEmail(app, t));
  return html`
    <div class="page-head"><div><h1>E-mails</h1>
      <p>The texts of the e-mails the app sends. ${app.isAdmin ? "Admins can edit all of them; duty managers the duty e-mails, people who resolve reports the issue e-mails." : "You can edit the ones that belong to your role."}</p></div></div>
    <${Loading} state=${state}>${(rows) => {
      const stored = new Map(rows.map((r) => [r.key, r]));
      return html`<div>
        ${["duty", "reports", "admin"].map((group) => {
          const list = mine.filter((t) => t.editor === group);
          return list.length > 0 && html`<section style="margin-bottom:24px">
            <h2>${{ duty: "Kitchen duty", reports: "Reported issues", admin: "Money" }[group]}</h2>
            ${app.isAdmin && group !== "admin" && html`<p class="small muted" style="margin-top:-6px">Also editable by: ${EDITOR_LABEL[group]}</p>`}
            ${list.map((t) => html`<${EmailTemplate} key=${t.key} meta=${t} row=${stored.get(t.key)} reload=${state.reload} />`)}
          </section>`;
        })}
        <p class="small muted">Sign-up confirmations, password resets and invitations come from Supabase itself: edit them in the Supabase dashboard under Authentication → Emails.</p>
      </div>`;
    }}<//>`;
}

function EmailTemplate({ meta, row, reload }) {
  const [draft, setDraft] = useState(null); // null | { subject, body }
  const [busy, run] = useBusy();
  const current = row || meta;
  // Older saved texts may still say {mates}; it is filled in like {others_on_duty}.
  const vars = "others_on_duty" in meta.vars ? { ...meta.vars, mates: meta.vars.others_on_duty } : meta.vars;
  const fill = (text) => String(text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const save = () => run(async () => {
    if (!row) throw new Error("This e-mail text is missing in the database. Run the latest migration first.");
    await api.saveEmailTemplate(meta.key, draft.subject.trim(), draft.body);
    toast(`"${meta.label}" saved`);
    setDraft(null);
    reload();
  });
  return html`<div class="card">
    <div class="row"><div><b>${meta.label}</b><div class="small muted">To: ${meta.to}</div></div><span class="spacer"></span>
      ${!draft && html`<button class="btn-text" onClick=${() => setDraft({ subject: current.subject, body: current.body })}>Edit</button>`}
    </div>
    ${draft ? html`<div class="info-editor" style="margin-top:12px">
        <div class="grid">
          <${Field} label="Subject"><input value=${draft.subject} onInput=${(e) => setDraft({ ...draft, subject: e.target.value })} /><//>
          <${Field} label="Text" hint=${`Placeholders: ${Object.keys(meta.vars).map((k) => `{${k}}`).join(", ")}. A new line stays a new line; a blank line starts a new paragraph. A line whose placeholders are empty is left out.`}>
            <textarea rows="12" value=${draft.body} onInput=${(e) => setDraft({ ...draft, body: e.target.value })}></textarea><//>
        </div>
        <div class="prose preview"><p><b>${fill(draft.subject)}</b></p><div dangerouslySetInnerHTML=${{ __html: markdown(draft.body, vars, { breaks: true }) }}></div></div>
        <div class="row" style="grid-column:1/-1">
          <span class="spacer"></span>
          <button class="btn-text" onClick=${() => setDraft(null)}>Cancel</button>
          <button class="btn primary" disabled=${busy || !draft.subject.trim() || !draft.body.trim()} onClick=${save}>Save</button>
        </div>
      </div>`
      : html`<p class="small" style="margin:8px 0 0">Subject: ${current.subject}</p>`}
  </div>`;
}
