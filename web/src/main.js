import { html, render, useState, useEffect, useCallback, Toasts, toastError, toast, Field, useBusy } from "./lib/ui.js";
import * as api from "./lib/api.js";
import { AppContext } from "./lib/context.js";
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

const ROUTES = [
  { path: "", title: "My account", icon: "☕", page: HomePage, section: "Me", show: () => true },
  { path: "availability", title: "My availability", icon: "🗓️", page: AvailabilityPage, section: "Me", show: (a) => !!a.person },
  { path: "duties", title: "Kitchen duty", icon: "🧽", page: DutiesPage, section: "Me", show: () => true },
  { path: "invoices", title: "Invoices", icon: "🧾", page: InvoicesPage, section: "Me", show: (a) => a.canUpload },
  { path: "balances", title: "Balances", icon: "📊", page: BalancesPage, section: "Accounting", show: (a) => a.isAdmin },
  { path: "counting", title: "Counting", icon: "✏️", page: CountingPage, section: "Accounting", show: (a) => a.isAdmin },
  { path: "payments", title: "Payments", icon: "💶", page: PaymentsPage, section: "Accounting", show: (a) => a.isAdmin },
  { path: "lists", title: "Print lists", icon: "🖨️", page: ListsPage, section: "Accounting", show: (a) => a.isAdmin },
  { path: "people", title: "People", icon: "👥", page: PeoplePage, section: "Admin", show: (a) => a.isAdmin },
  { path: "accounts", title: "Accounts & roles", icon: "🔑", page: AccountsPage, section: "Admin", show: (a) => a.isAdmin },
  { path: "settings", title: "Settings", icon: "⚙️", page: SettingsPage, section: "Admin", show: (a) => a.isAdmin },
  { path: "import", title: "Import spreadsheet", icon: "📥", page: ImportPage, section: "Admin", show: (a) => a.isAdmin },
];

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

  return html`<div class="auth-wrap"><div class="card auth-card">
    <div class="brand">☕ ${appName}</div>
    <p class="muted small">Coffee & drinks accounting and kitchen duty.</p>
    ${api.isDemo && html`<div class="notice info small"><b>Demo mode</b> — no database is configured, data stays in this browser.
      <div class="row" style="margin-top:8px">
        <button class="btn small" onClick=${() => run(() => api.auth.signIn("ada@example.org", "x"))}>Sign in as admin</button>
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
  return html`<div class="auth-wrap"><div class="card auth-card">
    <h1>Choose a new password</h1>
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
  const visible = ROUTES.filter((r) => r.show(app));
  const gated = app.availabilityMissing.length > 0;
  let route = visible.find((r) => r.path === path) || visible[0];
  if (gated && route.path !== "availability") route = ROUTES.find((r) => r.path === "availability");
  useEffect(() => setMenuOpen(false), [path]);
  useEffect(() => { document.title = `${route.title} · ${app.settings.app_name || "Coffee & Drinks"}`; }, [route]);

  const sections = [...new Set(visible.map((r) => r.section))];
  const Page = route.page;
  return html`<div class="shell">
    <aside class="sidebar ${menuOpen ? "open" : ""}">
      <div class="brand">☕ ${app.settings.app_name || "Coffee & Drinks"}</div>
      ${api.isDemo && html`<div class="badge warn" style="margin:0 10px 6px">Demo mode</div>`}
      <nav class="nav">
        ${sections.map((s) => html`<div class="nav-section">${s}</div>
          ${visible.filter((r) => r.section === s).map((r) => html`
            <a href="#/${r.path}" class="${r === route ? "active" : ""} ${gated && r.path !== "availability" ? "locked" : ""}">
              <span aria-hidden="true">${r.icon}</span>${r.title}</a>`)}`)}
      </nav>
      <div class="who">
        <div><b>${app.person ? personName(app.person) : app.profile.email}</b></div>
        <div>${app.profile.email}</div>
        <div class="row" style="margin-top:6px">
          <span class="badge ${app.isAdmin ? "accent" : ""}">${app.isAdmin ? "Admin" : "Member"}</span>
          ${app.canManageDuties && !app.isAdmin && html`<span class="badge">Duty manager</span>`}
          ${app.canUpload && !app.isAdmin && html`<span class="badge">Invoices</span>`}
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn small" onClick=${() => api.auth.signOut().catch(toastError)}>Sign out</button>
          ${api.isDemo && html`<button class="btn small ghost" onClick=${() => api.sb.resetDemo()}>Reset demo</button>`}
        </div>
      </div>
    </aside>
    <div>
      <div class="topbar">
        <button class="icon-btn" aria-label="Menu" onClick=${() => setMenuOpen(!menuOpen)}>☰</button>
        <b>${route.title}</b>
      </div>
      <main class="main">
        ${gated && html`<div class="notice warn"><b>Availability required.</b> Please answer for every week below
          (${app.availabilityMissing.length} missing) — the rest of the app unlocks once you are done.</div>`}
        <${Page} key=${route.path} />
      </main>
    </div>
  </div>`;
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
      setState({
        phase: "ready",
        app: {
          session, user: session.user, profile, person, settings, isAdmin,
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
      else if (event === "SIGNED_OUT") { loadedUid = null; loadApp(null); }
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
