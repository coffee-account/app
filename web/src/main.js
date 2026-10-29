import { html, render, useState, useEffect, useCallback, Toasts, toastError, toast, Field, useBusy, Modal } from "./lib/ui.js";
import { markdown } from "./lib/markdown.js";
import { fmtDate } from "./lib/dates.js";
import * as api from "./lib/api.js";
import { AppContext } from "./lib/context.js";
import { LayeredCup, DictEntry } from "./lib/drawings.js";
import { availabilityRequired, missingAvailability, availabilityRules, personName } from "./lib/accounting.js";
import { weeksFrom } from "./lib/dates.js";
import { HomePage } from "./pages/home.js";
import { AvailabilityPage } from "./pages/availability.js";
import { DutiesPage } from "./pages/duties.js";
import { InvoicesPage } from "./pages/invoices.js";
import { PeoplePage } from "./pages/people.js";
import { CountingPage } from "./pages/counting.js";
import { PaymentsPage } from "./pages/payments.js";
import { BalancesPage } from "./pages/balances.js";
import { ListsPage } from "./pages/lists.js";
import { AccountsPage } from "./pages/accounts.js";
import { SettingsPage } from "./pages/settings.js";
import { ImportPage } from "./pages/import.js";
import { InfoPage } from "./pages/info.js";
import { RefundsPage } from "./pages/refunds.js";
import { IssuesPage } from "./pages/issues.js";
import { PaypalPage } from "./pages/paypal.js";

const ROUTES = [
  { path: "info", title: "Updates & guide", page: InfoPage, section: "INFO", show: () => true },
  { path: "", title: "My account", page: HomePage, section: "ME", show: () => true },
  { path: "availability", title: "My availability", page: AvailabilityPage, section: "ME", show: (a) => !!a.person },
  { path: "duties", title: "Kitchen duty", page: DutiesPage, section: "ME", show: () => true },
  { path: "invoices", title: "Invoices", page: InvoicesPage, section: "ME", show: (a) => a.canUpload },
  { path: "issues", title: "Report an issue", page: IssuesPage, section: "ME", show: () => true },
  { path: "refunds", title: "Refunds", page: RefundsPage, section: "ME", show: (a) => !!a.person || a.isAdmin },
  { path: "balances", title: "Balances", page: BalancesPage, section: "ACCOUNTING", show: (a) => a.isAdmin || a.isGroupAdmin },
  { path: "counting", title: "Counting", page: CountingPage, section: "ACCOUNTING", show: (a) => a.isAdmin || a.isGroupAdmin },
  { path: "payments", title: "Payments", page: PaymentsPage, section: "ACCOUNTING", show: (a) => a.isAdmin || a.isGroupAdmin },
  { path: "paypal", title: "PayPal import", page: PaypalPage, section: "ACCOUNTING", show: (a) => a.isAdmin },
  { path: "lists", title: "Print lists", page: ListsPage, section: "ACCOUNTING", show: (a) => a.isAdmin },
  { path: "people", title: "People", page: PeoplePage, section: "ADMIN", show: (a) => a.isAdmin || a.isGroupAdmin },
  { path: "accounts", title: (a) => (a.isAdmin ? "Accounts & roles" : "Accounts"), page: AccountsPage, section: "ADMIN", show: (a) => a.isAdmin || a.isGroupAdmin },
  { path: "settings", title: "Settings", page: SettingsPage, section: "ADMIN", show: (a) => a.isAdmin },
  { path: "import", title: "Import spreadsheet", page: ImportPage, section: "ADMIN", show: (a) => a.isAdmin },
];

// A route's title may depend on who is signed in.
const titleOf = (r, app) => (typeof r.title === "function" ? r.title(app) : r.title);

// Pages that stay reachable while someone still has to fill in their availability.
const OPEN_WHEN_GATED = new Set(["availability", "info", "issues"]);

const currentPath = () => location.hash.replace(/^#\/?/, "").split("?")[0];

function useRoute() {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const on = () => setPath(currentPath());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return path;
}

// ── Auth screens ──
function AuthScreen({ settings, groups }) {
  const [mode, setMode] = useState("signin");
  const [form, setForm] = useState({ email: "", password: "", first_name: "", last_name: "", group: "" });
  const [done, setDone] = useState(null);
  const [busy, run] = useBusy();
  const set = (k) => (e) => { const v = e.target.value; setForm((f) => ({ ...f, [k]: v })); };
  const domains = settings.signup_domains || [];
  const appName = settings.app_name || "Coffee & Drinks";

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (mode === "signin") {
        await api.auth.signIn(form.email.trim(), form.password);
      } else if (mode === "register") {
        const dom = form.email.split("@")[1]?.toLowerCase() || "";
        if (domains.length && !domains.some((d) => dom === d.toLowerCase() || dom.endsWith(`.${d.toLowerCase()}`))) {
          throw new Error(`Please register with an address from: ${domains.join(", ")}`);
        }
        if (form.password.length < 8) throw new Error("Use at least 8 characters for the password.");
        const res = await api.auth.signUp(form.email.trim(), form.password, {
          first_name: form.first_name.trim(), last_name: form.last_name.trim(), group: form.group,
        });
        if (!res.session) setDone("Check your inbox and click the confirmation link, then sign in.");
      } else {
        await api.auth.resetPassword(form.email.trim());
        setDone("If an account exists for this address, a reset link is on its way.");
      }
    });
  };

  return html`<div class="auth-wrap">
    <div class="auth-poster">
      <${LayeredCup} />
      <h1>${appName}</h1>
      <p class="lede">Balances, tally counts and kitchen duty for the coffee corner.</p>
      <${DictEntry} word="caf·fein·ance" pos="n.">The fine art of knowing exactly how many coffees you owe, without ever having to ask.<//>
    </div>
    <div class="card auth-card">
    ${api.isDemo && html`<div class="notice"><b>Demo mode.</b> ${api.isOnlineDemo
      ? "Try the app with made-up people. Nothing is sent anywhere, and whatever you change stays in this browser."
      : "No database is configured; data stays in this browser."}
      <div class="row" style="margin-top:8px">
        <button class="btn small" onClick=${() => run(() => api.auth.signIn("ada@example.org", "x"))}>Sign in as admin</button>
        <button class="btn small" onClick=${() => run(() => api.auth.signIn("clara@example.org", "x"))}>Sign in as group admin</button>
        <button class="btn small" onClick=${() => run(() => api.auth.signIn("bob@example.org", "x"))}>Sign in as member</button>
      </div></div>`}
    <div class="tabs">
      ${[["signin", "Sign in"], ["register", "Register"], ["reset", "Forgot password"]].map(([m, l]) =>
        html`<button class=${mode === m ? "active" : ""} onClick=${() => { setMode(m); setDone(null); }}>${l}</button>`)}
    </div>
    ${done ? html`<div class="notice ok">${done}</div>` : html`
    <form class="grid" onSubmit=${submit}>
      ${mode === "register" && html`
        <div class="form-grid">
          <${Field} label="First name"><input required value=${form.first_name} onInput=${set("first_name")} autocomplete="given-name" /><//>
          <${Field} label="Last name"><input required value=${form.last_name} onInput=${set("last_name")} autocomplete="family-name" /><//>
        </div>
        <${Field} label="Group">
          <select value=${form.group} onChange=${set("group")}>
            <option value="">— choose —</option>
            ${groups.map((g) => html`<option value=${g.name}>${g.name}</option>`)}
          </select><//>`}
      <${Field} label="E-mail" hint=${mode === "register" && domains.length ? `Allowed: ${domains.join(", ")}` : null}>
        <input type="email" required value=${form.email} onInput=${set("email")} autocomplete="email" /><//>
      ${mode !== "reset" && html`<${Field} label="Password">
        <input type="password" required minlength=${mode === "register" ? 8 : undefined} value=${form.password} onInput=${set("password")}
          autocomplete=${mode === "register" ? "new-password" : "current-password"} /><//>`}
      <button class="btn primary" disabled=${busy}>${{ signin: "Sign in", register: "Create account", reset: "Send reset link" }[mode]}</button>
      ${mode === "register" && html`<p class="small muted">If you are already on the coffee or drinks list, use the same name:
        an admin will then connect your account to your existing balance.</p>`}
    </form>`}
  </div></div>`;
}

function SetPasswordScreen({ onDone }) {
  const [pw, setPw] = useState("");
  const [busy, run] = useBusy();
  return html`<div class="auth-wrap">
    <div class="auth-poster"><${LayeredCup} /><h1>New password</h1></div>
    <div class="card auth-card">
    <h2>Choose a new password</h2>
    <form class="grid" onSubmit=${(e) => { e.preventDefault(); run(async () => { await api.auth.setPassword(pw); toast("Password updated"); onDone(); }); }}>
      <${Field} label="New password"><input type="password" minlength="8" required value=${pw} onInput=${(e) => setPw(e.target.value)} autocomplete="new-password" /><//>
      <button class="btn primary" disabled=${busy}>Save password</button>
    </form>
  </div></div>`;
}

// ── Signed-in shell ──
function Shell({ app }) {
  const path = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const [freshUpdates, setFreshUpdates] = useState(null); // new updates for people who skip the Info page
  const visible = ROUTES.filter((r) => r.show(app));
  const gated = app.availabilityMissing.length > 0;
  let route = visible.find((r) => r.path === path) || visible.find((r) => r.path === "") || visible[0];
  if (gated && !OPEN_WHEN_GATED.has(route.path)) route = ROUTES.find((r) => r.path === "availability");
  useEffect(() => setMenuOpen(false), [path]);
  // Once per sign-in: open the Info page, or, for people who switched that off,
  // show updates posted since their last visit in a pop-up.
  useEffect(() => {
    const key = `pc:info-shown:${app.user.id}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch { /* storage unavailable */ }
    if (!app.profile.skip_info) { if (currentPath() === "") location.hash = "#/info"; return; }
    const seen = app.profile.updates_seen_at || app.profile.created_at || "";
    api.listUpdates().then((ups) => {
      const fresh = ups.filter((u) => u.created_at > seen && u.created_by !== app.user.id && (app.seesAdminMessages || u.audience !== "admins"));
      if (fresh.length) setFreshUpdates(fresh); // a pop-up instead of the full Info page
    }).catch(() => { /* not important enough to interrupt sign-in */ });
  }, []);
  // "/" focuses the page's search field, Esc clears it.
  useEffect(() => {
    const onKey = (e) => {
      const field = document.querySelector("input[data-search]");
      if (!field) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if (e.key === "/" && !typing) { e.preventDefault(); field.focus(); }
      if (e.key === "Escape" && document.activeElement === field && field.value) {
        field.value = "";
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { document.title = `${titleOf(route, app)} · ${app.settings.app_name || "Coffee & Drinks"}`; }, [route]);

  const sections = [...new Set(visible.map((r) => r.section))];
  const Page = route.page;
  const appName = app.settings.app_name || "Coffee & Drinks";
  const toggleTheme = () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* storage unavailable */ }
  };
  return html`<div class="shell">
    <div class="topbar">
      <span class="brand">${appName}</span>
      <button class="btn-text" aria-expanded=${menuOpen} onClick=${() => setMenuOpen(!menuOpen)}>${menuOpen ? "Close" : "Menu"}</button>
    </div>
    <aside class="sidebar ${menuOpen ? "open" : ""}">
      <div class="brand">${appName}</div>
      ${api.isDemo && html`<div style="padding:0 10px 6px"><span class="badge warn">Demo mode</span></div>`}
      <nav class="nav" aria-label="Main">
        ${sections.map((s) => html`<div class="nav-section">${s}</div>
          ${visible.filter((r) => r.section === s).map((r) => html`
            <a href="#/${r.path}" class="${r === route ? "active" : ""} ${gated && !OPEN_WHEN_GATED.has(r.path) ? "locked" : ""}"
              aria-current=${r === route ? "page" : undefined}>
              ${titleOf(r, app)}${r.path === "availability" && gated && html`<span class="task-dot" title="Weeks missing"></span>`}</a>`)}`)}
      </nav>
      <div class="who">
        <div><b>${app.person ? personName(app.person) : app.profile.email}</b></div>
        <div class="email">${app.profile.email}</div>
        <div class="row">
          <span class="badge ${app.isAdmin || app.isGroupAdmin ? "accent" : ""}">${app.isAdmin ? "Admin" : app.isGroupAdmin ? `Group admin · ${app.managedGroup}` : "Member"}</span>
          ${app.canManageDuties && !app.isAdmin && html`<span class="badge">Duty manager</span>`}
          ${app.canUpload && !app.isAdmin && html`<span class="badge">Invoices</span>`}
        </div>
        <div class="row" style="justify-content:space-between">
          <span class="row" style="gap:12px">
            <button class="btn-text" onClick=${() => api.auth.signOut().catch(toastError)}>Sign out</button>
            ${api.isDemo && html`<button class="btn-text" onClick=${() => api.sb.resetDemo()}>Reset demo</button>`}
          </span>
          <button class="theme-toggle" aria-label="Switch light or dark mode" title="Light / dark" onClick=${toggleTheme}></button>
        </div>
      </div>
    </aside>
    <div>
      <main class="main">
        ${gated && html`<div class="notice warn">${`You haven't answered ${app.availabilityMissing.length} week${app.availabilityMissing.length > 1 ? "s" : ""} of kitchen-duty availability yet. The rest of the app opens once you have.`}</div>`}
        <${Page} key=${route.path} />
        ${freshUpdates && html`<${NewUpdatesDialog} app=${app} updates=${freshUpdates} onClose=${() => setFreshUpdates(null)} />`}
      </main>
    </div>
  </div>`;
}

/** New updates since the last visit, for people who don't want the Info page at sign-in. */
function NewUpdatesDialog({ app, updates, onClose }) {
  const markSeen = () => api.updateProfile(app.user.id, { updates_seen_at: new Date().toISOString() }).catch(() => {});
  const close = () => { markSeen(); onClose(); };
  return html`<${Modal} title=${updates.length === 1 ? "New update" : `${updates.length} new updates`} onClose=${close}>
    <div class="update-dialog">
      ${updates.map((u) => html`<article class="update" key=${u.id}>
        <div class="update-meta">${fmtDate(u.created_at.slice(0, 10))}${u.audience === "admins" && html`<span class="badge accent">admins only</span>`}</div>
        <h3>${u.title}</h3>
        ${u.body && html`<div class="prose" dangerouslySetInnerHTML=${{ __html: markdown(u.body) }}></div>`}
      </article>`)}
    </div>
    <div class="row end" style="margin-top:16px;gap:16px">
      <a class="btn-text" href="#/info" onClick=${close}>Open Info page</a>
      <button class="btn primary" onClick=${close}>Got it</button>
    </div>
  <//>`;
}

function App() {
  const [state, setState] = useState({ phase: "boot" });
  const [publicData, setPublicData] = useState({ settings: {}, groups: [] });

  const loadPublic = useCallback(async () => {
    try {
      const [settings, groups] = await Promise.all([api.loadSettings(), api.listGroups()]);
      setPublicData({ settings, groups });
    } catch (e) { toastError(e); }
  }, []);

  const loadApp = useCallback(async (session) => {
    if (!session) { setState({ phase: "signed-out" }); return; }
    try {
      const uid = session.user.id;
      const [profile, settings] = await Promise.all([api.getMyProfile(uid), api.loadSettings()]);
      if (!profile) throw new Error("Your account has no profile yet. Please contact an admin.");
      const person = profile.person_id ? await api.getPerson(profile.person_id) : null;
      let availabilityMissing = [];
      if (availabilityRequired(settings, person)) {
        const weeks = weeksFrom(availabilityRules(settings).weeksAhead);
        const rows = await api.listAvailability(weeks[0], weeks[weeks.length - 1], person.id);
        availabilityMissing = missingAvailability(settings, rows);
      }
      const isAdmin = profile.role === "admin";
      const isGroupAdmin = profile.role === "group_admin" && !!profile.managed_group;
      setState({
        phase: "ready",
        app: {
          session, user: session.user, profile, person, settings, isAdmin,
          isGroupAdmin,
          managedGroup: isGroupAdmin ? profile.managed_group : null,
          seesAdminMessages: isAdmin || isGroupAdmin,
          canResolve: isAdmin || !!profile.can_resolve_reports,
          canUpload: isAdmin || profile.can_upload_invoices,
          canManageDuties: isAdmin || profile.can_manage_duties,
          availabilityMissing,
          refresh: () => loadApp(session),
        },
      });
    } catch (e) {
      toastError(e);
      setState({ phase: "error", error: e });
    }
  }, []);

  useEffect(() => {
    loadPublic();
    const recovering = new URLSearchParams(location.search).has("reset");
    let loadedUid = null;
    const sub = api.auth.onChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setState({ phase: "recovery" });
      else if (event === "SIGNED_OUT") {
        loadedUid = null;
        try { Object.keys(sessionStorage).filter((k) => k.startsWith("pc:info-shown:")).forEach((k) => sessionStorage.removeItem(k)); } catch { /* storage unavailable */ }
        // The next sign-in starts from the beginning, not from the page the last person was on.
        if (location.hash) history.replaceState(null, "", location.pathname + location.search);
        loadApp(null);
      }
      // supabase-js repeats SIGNED_IN on token refresh; only reload for a different user.
      else if (event === "SIGNED_IN" && session?.user.id !== loadedUid) { loadedUid = session.user.id; loadApp(session); }
    });
    api.auth.session().then((s) => {
      if (recovering && s) return setState({ phase: "recovery" });
      loadedUid = s?.user.id ?? null;
      loadApp(s);
    }).catch((e) => {
      toastError(e);
      setState({ phase: "signed-out" });
    });
    return () => sub.unsubscribe();
  }, []);

  let body;
  if (state.phase === "boot") body = html`<div class="boot">Loading…</div>`;
  else if (state.phase === "signed-out") body = html`<${AuthScreen} ...${publicData} />`;
  else if (state.phase === "recovery") {
    body = html`<${SetPasswordScreen} onDone=${() => { history.replaceState(null, "", api.appUrl()); api.auth.session().then(loadApp); }} />`;
  } else if (state.phase === "error") {
    body = html`<div class="auth-wrap"><div class="card auth-card"><h1>Something went wrong</h1>
      <p>${state.error.message}</p><button class="btn" onClick=${() => api.auth.signOut()}>Sign out</button></div></div>`;
  } else {
    body = html`<${AppContext.Provider} value=${state.app}><${Shell} app=${state.app} /><//>`;
  }
  return html`${body}<${Toasts} />`;
}

render(html`<${App} />`, document.getElementById("app"));
