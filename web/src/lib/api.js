// All reads and writes go through here. Permissions are enforced by the database;
// filters such as `person_id = me` are repeated here so the demo backend behaves the same.

import { createClient } from "@supabase/supabase-js";
import { createDemoClient } from "./demo-backend.js";
import { toast } from "./ui.js";

const cfg = window.APP_CONFIG || {};
export const isDemo = !cfg.supabaseUrl || !cfg.supabaseAnonKey;

export const sb = isDemo
  ? createDemoClient((m) => toast(m))
  : createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { flowType: "implicit", persistSession: true, detectSessionInUrl: true },
    });

/** Site URL without query/hash: where auth e-mails should send people back to. */
export const appUrl = () => location.origin + location.pathname;

async function q(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message || String(error));
  return data;
}

// ── Auth ──
export const auth = {
  session: async () => (await q(sb.auth.getSession())).session,
  onChange: (fn) => sb.auth.onAuthStateChange(fn).data.subscription,
  signIn: (email, password) => q(sb.auth.signInWithPassword({ email, password })),
  signUp: (email, password, meta) =>
    q(sb.auth.signUp({ email, password, options: { data: meta, emailRedirectTo: appUrl() } })),
  signOut: () => q(sb.auth.signOut()),
  resetPassword: (email) => q(sb.auth.resetPasswordForEmail(email, { redirectTo: `${appUrl()}?reset=1` })),
  setPassword: (password) => q(sb.auth.updateUser({ password })),
};

// ── Settings ──
export async function loadSettings() {
  const rows = await q(sb.from("settings").select("key, value"));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
export const saveSetting = (key, value) => q(sb.from("settings").upsert({ key, value }));

// ── Groups ──
export const listGroups = () => q(sb.from("groups").select("*").order("sort_order").order("name"));
export const addGroup = (name) => q(sb.from("groups").insert({ name }));
export const renameGroup = (from, to) => q(sb.from("groups").update({ name: to }).eq("name", from));
export const deleteGroup = (name) => q(sb.from("groups").delete().eq("name", name));

// ── People & accounts ──
export const listPeople = () => q(sb.from("people").select("*").order("last_name").order("first_name"));
export const getPerson = (id) => q(sb.from("people").select("*").eq("id", id).maybeSingle());
export const listDirectory = () => q(sb.from("people_directory").select("*").order("last_name"));
export async function savePerson(p) {
  const row = { ...p };
  if ("email" in row) row.email = row.email?.trim() || null;
  if ("group_name" in row) row.group_name = row.group_name || null;
  if (row.id) return q(sb.from("people").update(row).eq("id", row.id).select().single());
  delete row.id;
  return q(sb.from("people").insert(row).select().single());
}
export async function deletePerson(id) {
  try {
    await q(sb.from("people").delete().eq("id", id));
  } catch (e) {
    if (/foreign key|violates|counts or payments/i.test(e.message)) {
      throw new Error("This person has counts or payments, so they can't be deleted. Switch both lists off instead.");
    }
    throw e;
  }
}

export const getMyProfile = (uid) => q(sb.from("profiles").select("*").eq("id", uid).maybeSingle());
export const listProfiles = () => q(sb.from("profiles").select("*").order("email"));
export const updateProfile = (id, patch) => q(sb.from("profiles").update(patch).eq("id", id));

// ── Prices ──
export const listPrices = () => q(sb.from("prices").select("*").order("kind").order("valid_from"));
export const addPrice = (row) => q(sb.from("prices").upsert(row, { onConflict: "kind,valid_from" }));
export const deletePrice = (id) => q(sb.from("prices").delete().eq("id", id));

// ── Counting sessions ──
export const listSessions = () => q(sb.from("count_sessions").select("*").order("session_date", { ascending: false }));
export const listCounts = (sessionId) => q(sb.from("counts").select("*").eq("session_id", sessionId));

/** Creates or updates a session and replaces its counts. `counts`: Map personId → quantity. */
export async function saveSession({ id, kind, session_date, note }, counts) {
  const row = id
    ? await q(sb.from("count_sessions").update({ kind, session_date, note }).eq("id", id).select().single())
    : await q(sb.from("count_sessions").insert({ kind, session_date, note }).select().single());
  const keep = [...counts].filter(([, n]) => n > 0).map(([person_id, quantity]) => ({ session_id: row.id, person_id, quantity }));
  const drop = [...counts].filter(([, n]) => !(n > 0)).map(([pid]) => pid);
  if (keep.length) await q(sb.from("counts").upsert(keep, { onConflict: "session_id,person_id" }));
  if (drop.length) await q(sb.from("counts").delete().eq("session_id", row.id).in("person_id", drop));
  return row;
}
export const deleteSession = (id) => q(sb.from("count_sessions").delete().eq("id", id));

// ── Payments ──
export const listPayments = () => q(sb.from("payments").select("*").order("paid_on", { ascending: false }));
export const addPayment = (row) => q(sb.from("payments").insert(row));
export const deletePayment = (id) => q(sb.from("payments").delete().eq("id", id));

/** Everything needed for balances. Pass a personId to load one member's own data. */
export async function loadLedgerData(personId) {
  const only = (query) => (personId ? query.eq("person_id", personId) : query);
  const [people, sessions, counts, payments, prices] = await Promise.all([
    personId ? q(sb.from("people").select("*").eq("id", personId)) : listPeople(),
    q(sb.from("count_sessions").select("*")),
    q(only(sb.from("counts").select("*"))),
    q(only(sb.from("payments").select("*"))),
    listPrices(),
  ]);
  return { people, sessions, counts, payments, prices };
}

// ── Kitchen duty ──
export const listAvailability = (from, to, personId) => {
  let query = sb.from("availability").select("*").gte("week_start", from).lte("week_start", to);
  if (personId) query = query.eq("person_id", personId);
  return q(query);
};
export const saveAvailability = (rows) => q(sb.from("availability").upsert(rows, { onConflict: "person_id,week_start" }));

export const listDuties = (from, to) =>
  q(sb.from("duty_assignments").select("*").gte("week_start", from).lte("week_start", to).order("week_start"));
export const listAllDuties = () => q(sb.from("duty_assignments").select("*"));

export async function assignDuty(week_start, person_id, note) {
  const [row] = await q(sb.from("duty_assignments").insert({ week_start, person_id, note: note || null }).select());
  const res = await sb.functions.invoke("notify", { body: { type: "duty_assigned", assignment_ids: [row.id] } });
  return { row, mailError: res.error ? await errorMessage(res.error) : res.data?.results?.[0]?.error };
}
export async function unassignDuty(a, notifyPerson) {
  await q(sb.from("duty_assignments").delete().eq("id", a.id));
  if (notifyPerson) await sb.functions.invoke("notify", { body: { type: "duty_removed", person_id: a.person_id, week_start: a.week_start } });
}
export async function resendDuty(id) {
  const res = await sb.functions.invoke("notify", { body: { type: "duty_assigned", assignment_ids: [id] } });
  if (res.error) throw new Error(await errorMessage(res.error));
  const err = res.data?.results?.[0]?.error;
  if (err) throw new Error(err);
}

// ── Invoices ──
export async function listInvoices(mineOnly, uid) {
  let query = sb.from("invoices").select("*").order("created_at", { ascending: false });
  if (mineOnly) query = query.eq("submitted_by", uid);
  return q(query);
}

export async function submitInvoice(uid, meta, file) {
  let file_path = null;
  if (file) {
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    file_path = `${uid}/${crypto.randomUUID()}-${safe}`;
    await q(sb.storage.from("invoices").upload(file_path, file, { contentType: file.type || undefined }));
  }
  const [row] = await q(sb.from("invoices").insert({
    ...meta, submitted_by: uid, file_path, file_name: file?.name ?? null, file_size: file?.size ?? null,
  }).select());
  const res = await sb.functions.invoke("notify", { body: { type: "invoice_submitted", invoice_id: row.id } });
  return { row, mailError: res.error ? await errorMessage(res.error) : null };
}
export async function resendInvoice(id) {
  const res = await sb.functions.invoke("notify", { body: { type: "invoice_submitted", invoice_id: id } });
  if (res.error) throw new Error(await errorMessage(res.error));
}
export const updateInvoice = (id, patch) => q(sb.from("invoices").update(patch).eq("id", id));
export async function deleteInvoice(inv) {
  if (inv.file_path) await sb.storage.from("invoices").remove([inv.file_path]);
  return q(sb.from("invoices").delete().eq("id", inv.id));
}
export async function invoiceFileUrl(path) {
  return (await q(sb.storage.from("invoices").createSignedUrl(path, 600))).signedUrl;
}

// ── List templates ──
export const listTemplates = (kind) => q(sb.from("list_templates").select("*").eq("kind", kind).order("name"));
export async function saveTemplate(t) {
  if (t.id) return q(sb.from("list_templates").update({ name: t.name, config: t.config, is_default: t.is_default }).eq("id", t.id).select().single());
  return q(sb.from("list_templates").insert({ kind: t.kind, name: t.name, config: t.config, is_default: t.is_default }).select().single());
}
export async function makeDefaultTemplate(kind, id) {
  await q(sb.from("list_templates").update({ is_default: false }).eq("kind", kind));
  await q(sb.from("list_templates").update({ is_default: true }).eq("id", id));
}
export const deleteTemplate = (id) => q(sb.from("list_templates").delete().eq("id", id));

// ── Misc ──
export const importWorkbook = (payload) => q(sb.rpc("import_workbook", { payload }));
export async function invitePerson(person_id) {
  const res = await sb.functions.invoke("notify", { body: { type: "invite", person_id } });
  if (res.error) throw new Error(await errorMessage(res.error));
}
export async function sendWeeklyReminders() {
  const res = await sb.functions.invoke("notify", { body: { type: "weekly" } });
  if (res.error) throw new Error(await errorMessage(res.error));
  return res.data;
}

// supabase-js wraps function errors; the useful message is in the response body.
async function errorMessage(err) {
  try {
    const body = await err.context?.json?.();
    if (body?.error) return body.error;
  } catch { /* not JSON */ }
  return err.message || String(err);
}

// ── Updates (info page news) ──
export const listUpdates = () => q(sb.from("updates").select("*").order("pinned", { ascending: false }).order("created_at", { ascending: false }));
export async function saveUpdate(u, uid) {
  const row = { title: u.title, body: u.body || "", audience: u.audience || "all", pinned: !!u.pinned };
  if (u.id) return q(sb.from("updates").update(row).eq("id", u.id));
  return q(sb.from("updates").insert({ ...row, created_by: uid }));
}
export const deleteUpdate = (id) => q(sb.from("updates").delete().eq("id", id));

// ── Refunds ──
export async function listRefunds(mineOnly, uid) {
  let query = sb.from("refund_requests").select("*").order("created_at", { ascending: false });
  if (mineOnly) query = query.eq("profile_id", uid);
  return q(query);
}
export async function requestRefund(uid, row) {
  const [r] = await q(sb.from("refund_requests").insert({ ...row, profile_id: uid }).select());
  const res = await sb.functions.invoke("notify", { body: { type: "refund_requested", request_id: r.id } });
  return { row: r, mailError: res.error ? await errorMessage(res.error) : null };
}
export const cancelRefund = (id) => q(sb.from("refund_requests").delete().eq("id", id));
export const completeRefund = (id, paidOn, note) => q(sb.rpc("complete_refund", { request_id: id, paid_on: paidOn, note: note || null }));
export const rejectRefund = (id, note) => q(sb.from("refund_requests").update({ status: "rejected", admin_note: note || null, processed_at: new Date().toISOString() }).eq("id", id));

// ── Issues ──
export const listIssues = () => q(sb.from("issues").select("*").order("created_at", { ascending: false }).limit(200));
export async function reportIssue(uid, row) {
  const [it] = await q(sb.from("issues").insert({ ...row, reported_by: uid }).select());
  const res = await sb.functions.invoke("notify", { body: { type: "issue_reported", issue_id: it.id } });
  return { row: it, mailError: res.error ? await errorMessage(res.error) : null };
}
export async function resolveIssue(uid, id, resolution, tellReporter) {
  await q(sb.from("issues").update({ status: "resolved", resolution: resolution || null, resolved_by: uid, resolved_at: new Date().toISOString() }).eq("id", id));
  if (tellReporter) await sb.functions.invoke("notify", { body: { type: "issue_resolved", issue_id: id } });
}
export const reopenIssue = (id) => q(sb.from("issues").update({ status: "open", resolution: null, resolved_by: null, resolved_at: null }).eq("id", id));
export const deleteIssue = (id) => q(sb.from("issues").delete().eq("id", id));
export async function resendIssue(id) {
  const res = await sb.functions.invoke("notify", { body: { type: "issue_reported", issue_id: id } });
  if (res.error) throw new Error(await errorMessage(res.error));
}

// ── PayPal import ──
export const listAliases = () => q(sb.from("payer_aliases").select("*").order("value"));
export const deleteAlias = (id) => q(sb.from("payer_aliases").delete().eq("id", id));
export const listIgnored = () => q(sb.from("ignored_transactions").select("*"));
export const unignore = (externalId) => q(sb.from("ignored_transactions").delete().eq("external_id", externalId));

/**
 * Books PayPal payments and remembers who they came from.
 * payments: [{ person_id, paid_on, amount, external_id, payer, note }]; aliases: [{ person_id, kind, value }];
 * ignored: [{ external_id, payer, amount, paid_on }]
 */
export async function importPaypal({ payments, aliases, ignored }) {
  if (payments.length) {
    await q(sb.from("payments").upsert(
      payments.map((p) => ({ ...p, method: "PayPal", source: "paypal" })),
      { onConflict: "external_id", ignoreDuplicates: true },
    ));
  }
  if (aliases.length) await q(sb.from("payer_aliases").upsert(aliases, { onConflict: "kind,value" }));
  if (ignored.length) await q(sb.from("ignored_transactions").upsert(ignored, { onConflict: "external_id", ignoreDuplicates: true }));
}
