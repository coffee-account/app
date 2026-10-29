import { html, useState, useLoad, Loading, Field, toast, useBusy, ConfirmAction, deferDelete, usePendingDeletes } from "../lib/ui.js";
import { useApp } from "../lib/context.js";
import * as api from "../lib/api.js";
import { personName } from "../lib/accounting.js";
import { fmtDate } from "../lib/dates.js";
import { EmptyState, LayeredCup } from "../lib/drawings.js";

export const ISSUE_CATEGORIES = [
  ["milk", "Milk ran out", "Milk is empty"],
  ["coffee", "Coffee beans ran out", "Coffee beans are empty"],
  ["supplies", "Other supplies ran out", "Out of "],
  ["kitchen", "Kitchen not clean", "Kitchen needs cleaning"],
  ["machine", "Machine or equipment", "Problem with "],
  ["other", "Something else", ""],
];
/** Issues with and suggestions for the app itself; kept apart from the kitchen categories. */
export const APP_BUG = ["app", "App issues and suggestions"];
const LABEL = Object.fromEntries([...ISSUE_CATEGORIES, APP_BUG].map(([k, l]) => [k, l]));

const PAGES = ["My account", "My availability", "Kitchen duty", "Invoices", "Report an issue", "Refunds", "Updates & guide",
  "Balances", "Counting", "Payments", "PayPal import", "Print lists", "People", "Accounts & roles", "Settings", "Sign-in or registration", "E-mails"];

/** Browser, system and screen size, so an issue can be reproduced. */
function environment() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "other browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const dark = matchMedia("(prefers-color-scheme: dark)").matches || document.documentElement.dataset.theme === "dark";
  return `${browser}${os ? ` on ${os}` : ""} · window ${innerWidth}×${innerHeight}${dark ? " · dark mode" : ""}`;
}

export function IssuesPage() {
  const app = useApp();
  const state = useLoad(() => api.listIssues());
  const [show, setShow] = useState("open");
  const [section, setSection] = useState("kitchen");
  const bugs = section === "app";
  return html`
    <div class="page-head"><div><h1>Report an issue</h1>
      <p>${bugs ? "Something in this app doesn't work as it should, or you have an idea to make it better? Tell us." : "Something ran out or isn't right in the kitchen? Tell the people who can fix it."}</p></div></div>
    <div class="tabs">
      <button class=${!bugs ? "active" : ""} onClick=${() => setSection("kitchen")}>Kitchen</button>
      <button class=${bugs ? "active" : ""} onClick=${() => setSection("app")}>App issues and suggestions</button>
    </div>
    ${bugs ? html`<${BugForm} app=${app} onDone=${state.reload} />` : html`<${ReportForm} app=${app} onDone=${state.reload} />`}
    <div class="row" style="margin:32px 0 14px"><h2 style="margin:0">${bugs ? "Reported issues and suggestions" : "Reported"}</h2><span class="spacer"></span>
      <div class="seg" role="group" aria-label="Show">
        ${[["open", "Open"], ["resolved", "Resolved"], ["all", "All"]].map(([k, l]) =>
          html`<button class=${show === k ? "on" : ""} aria-pressed=${show === k} onClick=${() => setShow(k)}>${l}</button>`)}
      </div></div>
    <${Loading} state=${state}>${(rows) => html`<${IssueList} key=${section} bugs=${bugs}
      rows=${rows.filter((r) => (r.category === "app") === bugs)} show=${show} app=${app} reload=${state.reload} />`}<//>`;
}

function BugForm({ app, onDone }) {
  const [f, setF] = useState({ title: "", page: "", details: "" });
  const [busy, run] = useBusy();
  const set = (k) => (e) => { const v = e.target.value; setF((x) => ({ ...x, [k]: v })); };
  const env = environment();
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (!f.title.trim()) throw new Error("Please describe the issue or suggestion in a few words.");
      const { mailError } = await api.reportIssue(app.user.id, {
        category: "app", title: f.title.trim(), description: f.details.trim() || null,
        context: [f.page && `Page: ${f.page}`, env].filter(Boolean).join(" · "),
        reporter_name: app.person ? personName(app.person) : app.profile.email,
      });
      if (mailError) toast(`Reported, but the e-mail could not be sent: ${mailError}`, "error");
      else toast("Thanks, it has been sent");
      setF({ title: "", page: "", details: "" });
      onDone();
    });
  };
  return html`<form class="card" onSubmit=${submit}>
    <h2>What's the issue or suggestion?</h2>
    <div class="form-grid">
      <${Field} label="In a few words"><input required value=${f.title} onInput=${set("title")} placeholder="e.g. Save button does nothing, or: show my balance in the menu" /><//>
      <${Field} label="Where in the app?"><input list="app-pages" value=${f.page} onInput=${set("page")} placeholder="e.g. Payments" />
        <datalist id="app-pages">${PAGES.map((p) => html`<option value=${p} />`)}</datalist><//>
    </div>
    <div style="margin-top:12px">
      <${Field} label="Details (optional)" hint="For an issue: what did you do just before, and what happened instead? For a suggestion: what would help you?">
        <textarea rows="4" value=${f.details} onInput=${set("details")}></textarea><//>
    </div>
    <div class="row" style="margin-top:12px">
      <span class="small muted">Sent along automatically: ${env}</span>
      <span class="spacer"></span>
      <button class="btn primary" disabled=${busy}>Send</button>
    </div>
  </form>`;
}

function ReportForm({ app, onDone }) {
  const [cat, setCat] = useState("milk");
  const [title, setTitle] = useState(ISSUE_CATEGORIES[0][2]);
  const [desc, setDesc] = useState("");
  const [busy, run] = useBusy();
  const choose = (k) => {
    const prev = ISSUE_CATEGORIES.find((c) => c[0] === cat)[2];
    setCat(k);
    if (!title || title === prev) setTitle(ISSUE_CATEGORIES.find((c) => c[0] === k)[2]);
  };
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (!title.trim()) throw new Error("Please say in a few words what's wrong.");
      const { mailError } = await api.reportIssue(app.user.id, {
        category: cat, title: title.trim(), description: desc.trim() || null,
        reporter_name: app.person ? personName(app.person) : app.profile.email,
      });
      if (mailError) toast(`Reported, but the e-mail could not be sent: ${mailError}`, "error");
      else toast("Thanks, it's been reported");
      setTitle(ISSUE_CATEGORIES.find((c) => c[0] === cat)[2]);
      setDesc("");
      onDone();
    });
  };
  return html`<form class="card" onSubmit=${submit}>
    <h2>What's the problem?</h2>
    <div class="seg issue-cats" role="group" aria-label="Kind of problem">
      ${ISSUE_CATEGORIES.map(([k, l]) => html`<button type="button" class=${cat === k ? "on" : ""} aria-pressed=${cat === k} onClick=${() => choose(k)}>${l}</button>`)}
    </div>
    <div class="form-grid" style="margin-top:14px">
      <${Field} label="In a few words"><input required value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder="e.g. Out of sugar" /><//>
      <${Field} label="Details (optional)"><input value=${desc} onInput=${(e) => setDesc(e.target.value)} placeholder="e.g. only one carton of oat milk left" /><//>
    </div>
    <div class="row end" style="margin-top:14px"><button class="btn primary" disabled=${busy}>Report</button></div>
  </form>`;
}

function IssueList({ rows, show, app, reload, bugs }) {
  const [busy, run] = useBusy();
  const [resolving, setResolving] = useState(null);
  const [note, setNote] = useState("");
  const isPending = usePendingDeletes();
  const list = rows.filter((r) => !isPending(`issue:${r.id}`) && (show === "all" || r.status === show));
  if (!list.length) {
    return html`<${EmptyState} drawing=${html`<${LayeredCup} size=${96} />`}>${show !== "open" ? "Nothing here yet."
      : bugs ? "No open issues or suggestions." : "Nothing reported. All good in the kitchen."}<//>`;
  }
  const manager = app.canResolve; // admins and people with the "Resolve reports" right
  const resolve = (r) => run(async () => {
    await api.resolveIssue(app.user.id, r.id, note, true);
    setResolving(null);
    setNote("");
    toast("Marked as resolved; the reporter has been told");
    reload();
  });
  const remove = (r) => deferDelete({ key: `issue:${r.id}`, message: "Report deleted", commit: () => api.deleteIssue(r.id), onDone: reload });

  return html`<div class="table-wrap"><table class="data normal">
    <thead><tr><th>Reported</th><th>What</th><th>${bugs ? "Where" : "Kind"}</th><th>Status</th><th></th></tr></thead>
    <tbody>${list.map((r) => html`<tr key=${r.id}>
      <td>${fmtDate(r.created_at.slice(0, 10))}<div class="small muted">${r.reporter_name || ""}</div></td>
      <td><b>${r.title}</b>${r.description && html`<div class="small muted">${r.description}</div>`}</td>
      <td>${bugs ? html`<span class="small">${r.context || "—"}</span>` : LABEL[r.category]}</td>
      <td><span class="badge ${r.status === "open" ? "warn" : "ok"}">${r.status}</span>
        ${r.resolution && html`<div class="small muted">${r.resolution}</div>`}
        ${manager && r.notify_error && html`<div class="small neg" title=${r.notify_error}>e-mail failed
          <button class="btn-text" onClick=${() => run(async () => { await api.resendIssue(r.id); toast("E-mail sent"); reload(); })}>Resend</button></div>`}</td>
      <td class="num"><div class="row end" style="gap:12px">
        ${manager && r.status === "open" && (resolving === r.id
          ? html`<input placeholder="What was done? (optional)" aria-label="What was done" value=${note} onInput=${(e) => setNote(e.target.value)} style="width:200px" />
              <button class="btn small primary" disabled=${busy} onClick=${() => resolve(r)}>Resolve</button>
              <button class="btn-text" onClick=${() => setResolving(null)}>Cancel</button>`
          : html`<button class="btn small" onClick=${() => { setResolving(r.id); setNote(""); }}>Resolve</button>`)}
        ${manager && r.status === "resolved" && html`<button class="btn-text" disabled=${busy} onClick=${() => run(async () => { await api.reopenIssue(r.id); reload(); })}>Reopen</button>`}
        ${(app.isAdmin || (r.reported_by === app.user.id && r.status === "open")) && html`<${ConfirmAction} question="Delete this report?" onConfirm=${() => remove(r)} />`}
      </div></td>
    </tr>`)}</tbody>
  </table></div>`;
}
