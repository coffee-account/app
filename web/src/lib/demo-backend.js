// In-browser stand-in for Supabase, used when config.js has no project configured.
// Implements just the subset of the supabase-js API the app uses. Data lives in
// localStorage, sample people are fictional, and e-mails are shown as toasts.
// There is no access control here: the real rules live in the database.

import { isoDate, addDays, mondayOf } from "./dates.js";

const KEY = "coffee-demo-v1";
const uuid = () => crypto.randomUUID();

const DEFAULT_SETTINGS = {
  app_name: "Coffee & Drinks",
  signup_domains: [],
  reimbursement: { to: "finance@example.org", cc_submitter: true },
  availability: { weeks_ahead: 6, required_for: "active", reminders: true },
  duty: { people_per_week: 2, info: "Empty the dishwasher, wipe the counters, refill milk and coffee beans.", reminders: true, round: 3 },
  balance: { low_threshold: -10, starting_label: "Starting balance 19.1.2026" },
  payment_info: "Transfer to the PayPal account coffee@example.org and tell the accounting manager.",
  notifications: { refund: "", issues: { milk: "kitchen@example.org", coffee: "", supplies: "", kitchen: "", machine: "", other: "", app: "" } },
};

function seed() {
  const groups = ["Group A", "Group B", "Group C"].map((name, i) => ({ name, sort_order: i }));
  const names = [
    ["Admin", "Ada", "Group A"], ["Member", "Bob", "Group A"], ["Fischer", "Clara", "Group A"],
    ["Novak", "David", "Group B"], ["Okafor", "Esther", "Group B"], ["Lindqvist", "Finn", "Group B"],
    ["García", "Greta", "Group B"], ["Hoffmann", "Hannes", "Group C"], ["Ivanova", "Irina", "Group C"],
    ["Jansen", "Jonas", "Group C"], ["Kowalski", "Kasia", "Group C"], ["Lehmann", "Lukas", "Group A"],
    ["Meyer", "Mia", "Group B"], ["Nakamura", "Noah", "Group C"],
  ];
  const people = names.map(([last_name, first_name, group_name], i) => ({
    id: uuid(), last_name, first_name, group_name, legacy_id: `${last_name}.${first_name}`.toLowerCase(),
    email: i < 3 ? `${first_name.toLowerCase()}@example.org` : null,
    active_coffee: i !== 13, active_drinks: i % 3 !== 2, starting_balance: [5, -4.4, 0, 12, -8.8, 3, 0, -2, 7.5, 0, 1, -14.8, 4, 0][i],
    active_duty: i !== 13, duty_carryover: [2, 1, 1, 2, 1, 0, 2, 1, 0, 1, 2, 0, 1, 0][i], duty_rounds_before: i === 12 ? 2 : 0,
    notes: null, created_at: new Date().toISOString(),
  }));
  const users = [
    { id: uuid(), email: "ada@example.org", role: "admin", person: people[0] },
    { id: uuid(), email: "bob@example.org", role: "member", person: people[1] },
    { id: uuid(), email: "clara@example.org", role: "group_admin", person: people[2], group: "Group A" },
  ];
  const profiles = users.map((u) => ({
    id: u.id, email: u.email, first_name: u.person.first_name, last_name: u.person.last_name, group_name: u.person.group_name,
    role: u.role, managed_group: u.group || null, can_upload_invoices: false, can_manage_duties: false, can_resolve_reports: false,
    person_id: u.person.id, suggested_person_id: null,
    created_at: new Date().toISOString(),
  }));
  const today = isoDate();
  const sessions = [];
  const counts = [];
  [-180, -120, -60].forEach((d, k) => {
    for (const kind of ["coffee", "drinks"]) {
      const s = { id: uuid(), kind, session_date: addDays(today, d), note: null, created_at: new Date().toISOString() };
      sessions.push(s);
      people.forEach((p, i) => {
        const on = kind === "coffee" ? p.active_coffee : p.active_drinks;
        if (on) counts.push({ session_id: s.id, person_id: p.id, quantity: kind === "coffee" ? (i * 7 + k * 5) % 30 : (i + k) % 6 });
      });
    }
  });
  const payments = people.filter((_, i) => i % 2 === 0).map((p, i) => ({
    id: uuid(), person_id: p.id, paid_on: addDays(today, -100 + i), amount: 20, method: "PayPal", note: null, source: "manual",
    created_at: new Date().toISOString(),
  }));
  const thisWeek = mondayOf(today);
  const availability = [];
  // Sample availability only for people without a demo login (Ada, Bob and Clara fill in their own).
  people.slice(3, 10).forEach((p, i) => {
    for (let w = 0; w < 6; w++) {
      availability.push({ person_id: p.id, week_start: addDays(thisWeek, w * 7), status: ["available", "if_needed", "unavailable"][(i + w) % 3], note: null });
    }
  });
  // Two people a week: some past weeks (done) and this week's pair.
  const duty_assignments = [[-3, 5], [-3, 8], [-2, 9], [-2, 2], [-1, 11], [-1, 7], [0, 3], [0, 4]].map(([w, i]) => (
    { id: uuid(), week_start: addDays(thisWeek, w * 7), person_id: people[i].id, note: null, notified_at: new Date().toISOString(), created_at: new Date().toISOString() }));
  const duty_free_weeks = [{ week_start: addDays(thisWeek, 8 * 7), note: "Holiday", created_at: new Date().toISOString() }];
  return {
    settings: Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })),
    groups, people, profiles, users: users.map(({ id, email }) => ({ id, email })),
    prices: [
      { id: 1, kind: "coffee", price: 0.4, valid_from: "2000-01-01" },
      { id: 2, kind: "drinks", price: 1, valid_from: "2000-01-01" },
    ],
    count_sessions: sessions, counts, payments, list_templates: [], invoices: [], availability, duty_assignments, duty_free_weeks,
    updates: [{ id: uuid(), title: "Welcome to the new coffee app", body: "The paper lists stay as they are. Please register and fill in your kitchen-duty availability.", audience: "all", pinned: true, created_at: new Date().toISOString() }],
    refund_requests: [],
    issues: [{ id: uuid(), category: "milk", title: "Oat milk is empty", description: "Only one carton of normal milk left.", reporter_name: "Bob Member", status: "open", created_at: new Date().toISOString() }],
    files: {}, session: null,
  };
}

const KEYS = {
  settings: ["key"], groups: ["name"], people: ["id"], profiles: ["id"], prices: ["kind", "valid_from"],
  count_sessions: ["id"], counts: ["session_id", "person_id"], payments: ["id"], list_templates: ["id"],
  invoices: ["id"], availability: ["person_id", "week_start"], duty_assignments: ["id"], duty_free_weeks: ["week_start"], guest_availability: ["id"],
  updates: ["id"], refund_requests: ["id"], issues: ["id"],
  payer_aliases: ["id"], ignored_transactions: ["external_id"], payouts: ["id"],
};
const DEFAULTS = {
  people: () => ({ id: uuid(), active_coffee: false, active_drinks: false, active_duty: false, duty_carryover: 0, duty_rounds_before: 0, starting_balance: 0, created_at: new Date().toISOString() }),
  count_sessions: () => ({ id: uuid(), created_at: new Date().toISOString() }),
  payments: () => ({ id: uuid(), source: "manual", created_at: new Date().toISOString() }),
  list_templates: () => ({ id: uuid(), is_default: false, updated_at: new Date().toISOString() }),
  invoices: () => ({ id: uuid(), status: "submitted", created_at: new Date().toISOString() }),
  duty_assignments: () => ({ id: uuid(), created_at: new Date().toISOString() }),
  prices: () => ({ id: Date.now() }),
  updates: () => ({ id: uuid(), audience: "all", pinned: false, body: "", created_at: new Date().toISOString() }),
  refund_requests: () => ({ id: uuid(), status: "open", leaving: true, created_at: new Date().toISOString() }),
  issues: () => ({ id: uuid(), status: "open", created_at: new Date().toISOString() }),
  payer_aliases: () => ({ id: uuid(), created_at: new Date().toISOString() }),
  ignored_transactions: () => ({ created_at: new Date().toISOString() }),
  payouts: () => ({ id: uuid(), created_at: new Date().toISOString() }),
  guest_availability: () => ({ id: uuid(), status: "pending", created_at: new Date().toISOString() }),
};

class Store {
  constructor() {
    try { this.db = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { this.db = seed(); }
    // Demo data saved before newer features existed.
    for (const t of ["updates", "refund_requests", "issues", "payer_aliases", "ignored_transactions", "payouts", "duty_free_weeks", "guest_availability"]) this.db[t] ??= [];
    for (const p of this.db.people) if (p.active_duty === undefined) Object.assign(p, { active_duty: p.active_coffee || p.active_drinks, duty_carryover: 0, duty_rounds_before: 0 });
    this.save();
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.db)); } catch { /* storage unavailable */ } }
  reset() { this.db = seed(); this.save(); }
  table(name) {
    if (name === "people_directory") {
      return this.db.people.map((p) => ({
        id: p.id, first_name: p.first_name, last_name: p.last_name, group_name: p.group_name,
        active_coffee: p.active_coffee, active_drinks: p.active_drinks,
        has_account: this.db.profiles.some((x) => x.person_id === p.id),
        active_duty: p.active_duty, duty_carryover: p.duty_carryover, duty_rounds_before: p.duty_rounds_before,
      }));
    }
    if (!this.db[name]) throw new Error(`Unknown table ${name}`);
    return this.db[name];
  }
}

class Query {
  constructor(store, table) {
    this.store = store; this.t = table; this.op = "select"; this.filters = []; this.orders = [];
    this.mode = null; this.max = null;
  }
  select() { return this; }
  insert(rows) { this.op = "insert"; this.payload = [].concat(rows); return this; }
  upsert(rows, opts = {}) {
    this.op = "upsert"; this.payload = [].concat(rows); this.conflict = opts.onConflict?.split(",").map((s) => s.trim());
    this.ignoreDuplicates = !!opts.ignoreDuplicates;
    return this;
  }
  update(values) { this.op = "update"; this.payload = values; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
  neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
  in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
  gte(c, v) { this.filters.push((r) => r[c] >= v); return this; }
  lte(c, v) { this.filters.push((r) => r[c] <= v); return this; }
  lt(c, v) { this.filters.push((r) => r[c] < v); return this; }
  is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  not(c, op, v) { this.filters.push((r) => !((r[c] ?? null) === v)); return this; }
  order(c, { ascending = true } = {}) { this.orders.push([c, ascending]); return this; }
  limit(n) { this.max = n; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  then(resolve, reject) {
    return Promise.resolve().then(() => {
      try { return this.exec(); } catch (e) { return { data: null, error: { message: e.message } }; }
    }).then(resolve, reject);
  }
  match(r) { return this.filters.every((f) => f(r)); }
  exec() {
    const rows = this.store.table(this.t);
    let out;
    if (this.op === "select") {
      out = rows.filter((r) => this.match(r));
      for (const [c, asc] of [...this.orders].reverse()) {
        out = [...out].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
      }
      if (this.max) out = out.slice(0, this.max);
      out = out.map((r) => ({ ...r }));
    } else if (this.op === "insert" || this.op === "upsert") {
      const keys = this.conflict || KEYS[this.t];
      out = this.payload.map((p) => {
        const existing = this.op === "upsert" && rows.find((r) => keys.every((k) => r[k] === p[k]));
        if (existing) { if (!this.ignoreDuplicates) Object.assign(existing, p); return { ...existing }; }
        if (this.op === "insert" && KEYS[this.t].every((k) => p[k] !== undefined) && rows.find((r) => KEYS[this.t].every((k) => r[k] === p[k]))) {
          throw new Error("duplicate key value violates unique constraint");
        }
        const row = { ...(DEFAULTS[this.t]?.() || {}), ...p };
        rows.push(row);
        return { ...row };
      });
      this.store.save();
    } else if (this.op === "update") {
      out = rows.filter((r) => this.match(r)).map((r) => Object.assign(r, this.payload)).map((r) => ({ ...r }));
      this.store.save();
    } else if (this.op === "delete") {
      out = rows.filter((r) => this.match(r));
      if (this.t === "people") {
        const used = out.find((p) => this.store.db.counts.some((c) => c.person_id === p.id) || this.store.db.payments.some((x) => x.person_id === p.id));
        if (used) throw new Error("This person has counts or payments and cannot be deleted. Deactivate them instead.");
      }
      if (this.t === "count_sessions") {
        const ids = new Set(out.map((s) => s.id));
        this.store.db.counts = this.store.db.counts.filter((c) => !ids.has(c.session_id));
      }
      this.store.db[this.t] = rows.filter((r) => !this.match(r));
      this.store.save();
    }
    if (this.mode) {
      if (!out.length && this.mode === "single") return { data: null, error: { message: "No rows found" } };
      return { data: out[0] ?? null, error: null };
    }
    return { data: out, error: null };
  }
}

export function createDemoClient(notify) {
  const store = new Store();
  const listeners = new Set();
  const emit = (event) => listeners.forEach((fn) => fn(event, store.db.session));
  const setSession = (user, event) => {
    store.db.session = user ? { user: { id: user.id, email: user.email }, access_token: "demo" } : null;
    store.save();
    setTimeout(() => emit(event), 0);
  };

  const client = {
    demo: true,
    resetDemo: () => { store.reset(); location.reload(); },
    from: (t) => new Query(store, t),
    auth: {
      async getSession() { return { data: { session: store.db.session }, error: null }; },
      onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; },
      async signInWithPassword({ email }) {
        const u = store.db.users.find((x) => x.email.toLowerCase() === email.toLowerCase());
        if (!u) return { data: null, error: { message: "Invalid login credentials (demo: use one of the demo accounts or sign up)" } };
        setSession(u, "SIGNED_IN");
        return { data: { session: store.db.session }, error: null };
      },
      async signUp({ email, options }) {
        const meta = options?.data || {};
        const db = store.db;
        if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) return { data: null, error: { message: "User already registered" } };
        const user = { id: uuid(), email };
        db.users.push(user);
        let pid = db.people.find((p) => p.email?.toLowerCase() === email.toLowerCase() && !db.profiles.some((x) => x.person_id === p.id))?.id ?? null;
        let sid = null;
        if (!pid && meta.first_name && meta.last_name) {
          sid = db.people.find((p) => p.first_name.toLowerCase() === meta.first_name.toLowerCase() && p.last_name.toLowerCase() === meta.last_name.toLowerCase() && !db.profiles.some((x) => x.person_id === p.id))?.id ?? null;
          if (!sid) {
            const p = { ...DEFAULTS.people(), last_name: meta.last_name, first_name: meta.first_name, group_name: meta.group || null, email, legacy_id: null };
            db.people.push(p);
            pid = p.id;
          }
        }
        db.profiles.push({ id: user.id, email, first_name: meta.first_name, last_name: meta.last_name, group_name: meta.group || null, role: "member", can_upload_invoices: false, can_manage_duties: false, person_id: pid, suggested_person_id: sid, created_at: new Date().toISOString() });
        setSession(user, "SIGNED_IN");
        return { data: { user, session: db.session }, error: null };
      },
      async signOut() { setSession(null, "SIGNED_OUT"); return { error: null }; },
      async resetPasswordForEmail(email) { notify(`Demo: a password-reset e-mail would be sent to ${email}.`); return { error: null }; },
      async updateUser() { return { data: {}, error: null }; },
    },
    storage: {
      from: () => ({
        async upload(path, file) {
          const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
          if (dataUrl.length < 1_500_000) { store.db.files[path] = dataUrl; store.save(); }
          return { data: { path }, error: null };
        },
        async createSignedUrl(path) { return { data: { signedUrl: store.db.files[path] || "about:blank" }, error: null }; },
        async remove(paths) { paths.forEach((p) => delete store.db.files[p]); store.save(); return { error: null }; },
      }),
    },
    functions: {
      async invoke(name, { body }) {
        const db = store.db;
        const who = (id) => db.people.find((p) => p.id === id);
        let msg = "";
        if (body.type === "invoice_submitted") {
          const inv = db.invoices.find((i) => i.id === body.invoice_id);
          const to = db.settings.find((s) => s.key === "reimbursement")?.value?.to;
          if (!to) return { data: null, error: { message: "No reimbursement e-mail address is configured (Settings)." } };
          inv.notified_at = new Date().toISOString();
          msg = `Demo e-mail → ${to}: ${inv.kind === "advance" ? "advance payment" : "reimbursement"} request ${Number(inv.amount).toFixed(2)} € (${inv.supplier})`;
        } else if (body.type === "duty_assigned") {
          const rows = db.duty_assignments.filter((a) => body.assignment_ids.includes(a.id));
          rows.forEach((a) => { a.notified_at = new Date().toISOString(); });
          msg = `Demo e-mail → ${rows.map((a) => who(a.person_id)?.first_name).join(", ")}: kitchen duty assigned`;
        } else if (body.type === "duty_removed") {
          msg = `Demo e-mail → ${who(body.person_id)?.first_name}: kitchen duty cancelled`;
        } else if (body.type === "invite") {
          msg = `Demo: invitation e-mail would be sent to ${who(body.person_id)?.email}`;
        } else if (body.type === "weekly") {
          msg = "Demo: weekly availability and duty reminders would be sent now";
        } else if (body.type === "refund_requested") {
          const r = db.refund_requests.find((x) => x.id === body.request_id);
          if (r) r.notified_at = new Date().toISOString();
          msg = `Demo e-mail → refund contact: refund request of ${Number(r?.amount || 0).toFixed(2)} €`;
        } else if (body.type === "issue_reported") {
          const it = db.issues.find((x) => x.id === body.issue_id);
          if (it) it.notified_at = new Date().toISOString();
          const to = db.settings.find((x) => x.key === "notifications")?.value?.issues?.[it?.category];
          msg = `Demo e-mail → ${to || "all admins"}: ${it?.title}`;
        } else if (body.type === "issue_resolved") {
          msg = "Demo e-mail → reporter: issue resolved";
        }
        store.save();
        notify(msg);
        return { data: { ok: true }, error: null };
      },
    },
    async rpc(name, args) {
      if (name === "connect_account" || name === "disconnect_account") {
        const prof = store.db.profiles.find((x) => x.id === args.profile);
        if (!prof) return { data: null, error: { message: "Account not found" } };
        Object.assign(prof, name === "connect_account" ? { person_id: args.person, suggested_person_id: null } : { person_id: null });
        store.save();
        return { data: null, error: null };
      }
      if (name === "guest_availability_info") {
        const a = store.db.settings.find((s) => s.key === "availability")?.value || {};
        return { data: { weeks_ahead: Number(a.weeks_ahead ?? 6), free_weeks: store.db.duty_free_weeks.map((f) => f.week_start) }, error: null };
      }
      if (name === "submit_guest_availability") {
        const key = (s) => String(s || "").toLowerCase().replace(/[^\p{L}]/gu, "");
        const [f, l, g] = [args.first_name.trim(), args.last_name.trim(), args.group_name?.trim() || null];
        if (!f || !l) return { data: null, error: { message: "Please give your first and last name" } };
        let hits = store.db.people.filter((p) => (key(p.first_name) === key(f) && key(p.last_name) === key(l)) || (key(p.first_name) === key(l) && key(p.last_name) === key(f)));
        if (hits.length > 1) hits = hits.filter((p) => (p.group_name || null) === g);
        const pid = hits.length === 1 ? hits[0].id : null;
        let saved = 0;
        if (pid) {
          for (const a of args.answers) {
            store.db.availability = store.db.availability.filter((x) => !(x.person_id === pid && x.week_start === a.week));
            store.db.availability.push({ person_id: pid, week_start: a.week, status: a.status, note: a.note || null, updated_at: new Date().toISOString() });
            saved++;
          }
        }
        store.db.guest_availability.push({ ...DEFAULTS.guest_availability(), first_name: f, last_name: l, group_name: g, answers: args.answers, person_id: pid, status: pid ? "applied" : "pending" });
        store.save();
        return { data: { matched: !!pid, saved, has_account: !!pid && store.db.profiles.some((x) => x.person_id === pid) }, error: null };
      }
      if (name === "set_duty_target") {
        const round = Number(store.db.settings.find((s) => s.key === "duty")?.value?.round ?? 0);
        Object.assign(store.db.people.find((p) => p.id === args.person) || {}, { duty_rounds_before: round - Number(args.target) });
        store.save();
        return { data: null, error: null };
      }
      if (name === "complete_refund") {
        const db = store.db;
        const r = db.refund_requests.find((x) => x.id === args.request_id);
        if (!r || r.status !== "open") return { data: null, error: { message: "This request has already been handled" } };
        if (Number(r.amount) > 0) db.payments.push({ ...DEFAULTS.payments(), person_id: r.person_id, paid_on: args.paid_on, amount: -Number(r.amount), method: "Refund", note: args.note || r.method, source: "refund" });
        if (r.leaving) Object.assign(db.people.find((p) => p.id === r.person_id) || {}, { active_coffee: false, active_drinks: false, active_duty: false });
        if (r.successor_profile_id) {
          Object.assign(db.profiles.find((p) => p.id === r.successor_profile_id) || {}, { role: "admin" });
          if (r.leaving) Object.assign(db.profiles.find((p) => p.id === r.profile_id) || {}, { role: "member" });
        }
        Object.assign(r, { status: "paid", admin_note: args.note || null, processed_at: new Date().toISOString() });
        store.save();
        return { data: null, error: null };
      }
      if (name !== "import_workbook") return { data: null, error: { message: `Unknown function ${name}` } };
      const db = store.db;
      const p = args.payload;
      (p.groups || []).forEach((g) => { if (!db.groups.some((x) => x.name === g)) db.groups.push({ name: g, sort_order: 0 }); });
      for (const r of p.people || []) {
        const ex = db.people.find((x) => x.legacy_id === r.legacy_id);
        if (ex) Object.assign(ex, r); else db.people.push({ ...DEFAULTS.people(), ...r });
      }
      for (const pr of p.prices || []) {
        const ex = db.prices.find((x) => x.kind === pr.kind && x.valid_from === pr.valid_from);
        if (ex) ex.price = pr.price; else db.prices.push({ id: Date.now() + Math.random(), ...pr });
      }
      const byLegacy = new Map(db.people.map((x) => [x.legacy_id, x.id]));
      let nCounts = 0;
      for (const s of p.sessions || []) {
        let sess = db.count_sessions.find((x) => x.kind === s.kind && x.session_date === s.date);
        if (!sess) { sess = { ...DEFAULTS.count_sessions(), kind: s.kind, session_date: s.date, note: "Imported from spreadsheet" }; db.count_sessions.push(sess); }
        for (const [lid, q] of Object.entries(s.counts)) {
          const pid = byLegacy.get(lid);
          if (!pid) continue;
          const ex = db.counts.find((c) => c.session_id === sess.id && c.person_id === pid);
          if (ex) ex.quantity = Math.round(q); else db.counts.push({ session_id: sess.id, person_id: pid, quantity: Math.round(q) });
          nCounts++;
        }
      }
      db.payments = db.payments.filter((x) => x.source !== "import");
      let nPay = 0;
      for (const x of p.payments || []) {
        const pid = byLegacy.get(x.legacy_id);
        if (!pid) continue;
        db.payments.push({ ...DEFAULTS.payments(), person_id: pid, paid_on: x.date, amount: x.amount, method: "Imported", source: "import" });
        nPay++;
      }
      store.save();
      return { data: { people: (p.people || []).length, sessions: (p.sessions || []).length, counts: nCounts, payments: nPay }, error: null };
    },
  };
  return client;
}
