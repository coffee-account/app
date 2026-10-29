// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function "notify": every e-mail the app sends goes through here.
//
// Called by the web app (with the user's login token) or by the weekly cron job
// (with the x-cron-secret header). Deployed with verify_jwt = false because the
// cron call carries no user token; permissions are checked below instead.
//
// Types:
//   invoice_submitted  { invoice_id }            uploader of that invoice or admin
//   duty_assigned      { assignment_ids: [] }    duty manager
//   duty_removed       { person_id, week_start } duty manager
//   invite             { person_id }             admin
//   weekly             {}                        cron or admin: availability + duty reminders
//   refund_requested   { request_id }            the requester or admin
//   issue_reported     { issue_id }              the reporter or admin
//   issue_resolved     { issue_id }              duty manager: tells the reporter

import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { escapeHtml, layout, sendMail } from "./mailer.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// Newer projects get secret keys in SUPABASE_SECRET_KEYS; older ones the legacy service-role key.
function serverKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const key = keys.default ?? Object.values(keys)[0];
    if (typeof key === "string" && key) return key;
  } catch { /* not set or not JSON */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const SERVICE_KEY = serverKey();
const APP_URL = Deno.env.get("APP_URL") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const MAX_ATTACHMENT = 7 * 1024 * 1024;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Caller = { kind: "cron" } | { kind: "user"; id: string; email: string; profile: Record<string, any> };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function identify(req: Request): Promise<Caller> {
  const secret = req.headers.get("x-cron-secret");
  if (CRON_SECRET && secret === CRON_SECRET) return { kind: "cron" };
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Not signed in");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Not signed in");
  const { data: profile, error: profileError } = await db.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  if (profileError) throw new HttpError(500, `Could not read your profile: ${profileError.message}`);
  if (!profile) throw new HttpError(403, "No profile");
  return { kind: "user", id: data.user.id, email: data.user.email ?? "", profile };
}

const isAdmin = (c: Caller) => c.kind === "cron" || c.profile.role === "admin";
const isDutyManager = (c: Caller) => isAdmin(c) || (c.kind === "user" && c.profile.can_manage_duties);

async function settings(): Promise<Record<string, any>> {
  const { data } = await db.from("settings").select("key, value");
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
}

// Person e-mail, falling back to the linked account's e-mail.
async function personEmails(ids: string[]): Promise<Map<string, { name: string; email: string | null }>> {
  const out = new Map<string, { name: string; email: string | null }>();
  if (!ids.length) return out;
  const { data: people } = await db.from("people").select("id, first_name, last_name, email").in("id", ids);
  const { data: profiles } = await db.from("profiles").select("person_id, email").in("person_id", ids);
  for (const p of people ?? []) {
    const fromProfile = profiles?.find((x) => x.person_id === p.id)?.email ?? null;
    out.set(p.id, { name: `${p.first_name} ${p.last_name}`, email: p.email ?? fromProfile });
  }
  return out;
}

// ── Week helpers (weeks start on Monday, Europe/Berlin calendar) ──
function todayBerlin(): Date {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  return new Date(`${s}T00:00:00Z`);
}
function mondayOf(d: Date): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() - ((r.getUTCDay() + 6) % 7));
  return r;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
function addDays(d: Date | string, n: number): Date {
  const r = typeof d === "string" ? new Date(`${d}T00:00:00Z`) : new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
function isoWeek(d: Date | string): number {
  const t = typeof d === "string" ? new Date(`${d}T00:00:00Z`) : new Date(d);
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
function weekLabel(weekStart: string): string {
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `week ${isoWeek(weekStart)} (${fmt(addDays(weekStart, 0))} – ${fmt(addDays(weekStart, 6))})`;
}

// ── Handlers ──
const addresses = (v: unknown) => String(v ?? "").split(/[,;\s]+/).filter((x) => x.includes("@"));

async function adminEmails(): Promise<string[]> {
  const { data } = await db.from("profiles").select("email").eq("role", "admin");
  return (data ?? []).map((p) => p.email).filter(Boolean);
}

async function profileEmail(id: string | null): Promise<string | undefined> {
  if (!id) return undefined;
  const { data } = await db.from("profiles").select("email").eq("id", id).maybeSingle();
  return data?.email ?? undefined;
}

const row = (k: string, v: unknown) =>
  `<tr><td style="padding:4px 12px 4px 0;color:#7a716a;vertical-align:top">${k}</td><td style="padding:4px 0;white-space:pre-line">${escapeHtml(v)}</td></tr>`;

async function invoiceSubmitted(caller: Caller, body: any, s: Record<string, any>) {
  const { data: inv } = await db.from("invoices").select("*").eq("id", body.invoice_id).single();
  if (!inv) throw new HttpError(404, "Invoice not found");
  if (!isAdmin(caller) && (caller.kind !== "user" || inv.submitted_by !== caller.id)) {
    throw new HttpError(403, "Not allowed");
  }
  const cfg = s.reimbursement ?? {};
  const to = String(cfg.to ?? "").split(/[,;\s]+/).filter(Boolean);
  if (!to.length) throw new HttpError(400, "No reimbursement e-mail address is configured (Settings).");

  let link = "";
  const attachments: { filename: string; content: Uint8Array }[] = [];
  if (inv.file_path) {
    const { data: signed } = await db.storage.from("invoices").createSignedUrl(inv.file_path, 60 * 60 * 24 * 14);
    link = signed?.signedUrl ?? "";
    if ((inv.file_size ?? 0) <= MAX_ATTACHMENT) {
      const { data: file } = await db.storage.from("invoices").download(inv.file_path);
      if (file) attachments.push({ filename: inv.file_name ?? "invoice", content: new Uint8Array(await file.arrayBuffer()) });
    }
  }
  const submitterEmail = await profileEmail(inv.submitted_by);
  const amount = `${Number(inv.amount).toFixed(2)} €`;
  const advance = inv.kind === "advance";
  const html = layout(
    advance ? "Advance payment requested" : "Invoice submitted for reimbursement",
    `${advance ? `<p style="font-size:14px">${escapeHtml(inv.submitter_name ?? "Someone")} would like the money in advance for something they will buy for the kitchen.</p>` : ""}
    <table style="border-collapse:collapse;font-size:14px">
      ${row("Amount", amount)}${row(advance ? "Needed by" : "Invoice date", inv.invoice_date)}${row(advance ? "Where" : "Supplier", inv.supplier)}
      ${row(advance ? "What for" : "Description", inv.description ?? "")}${row("Submitted by", `${inv.submitter_name ?? ""} ${submitterEmail ? `<${submitterEmail}>` : ""}`)}
      ${row(advance ? "Pay to" : "Reimbursement details", inv.reimburse_note ?? "")}
    </table>
    ${link ? `<p style="font-size:14px"><a href="${escapeHtml(link)}" style="color:#8a4b2a">Download the ${advance ? "attached quote" : "invoice"}</a> (link valid for 14 days)${attachments.length ? " — also attached." : ""}</p>` : ""}
    ${advance ? `<p style="font-size:14px">The receipt will follow once the purchase has been made.</p>` : ""}`,
    s.app_name ?? "Coffee & Drinks",
    APP_URL,
  );
  try {
    await sendMail({
      to,
      cc: cfg.cc_submitter && submitterEmail ? [submitterEmail] : [],
      replyTo: submitterEmail,
      subject: `${advance ? "Advance payment request" : "Reimbursement request"}: ${amount} – ${inv.supplier}`,
      html,
      attachments,
    });
    await db.from("invoices").update({ notified_at: new Date().toISOString(), notify_error: null }).eq("id", inv.id);
    return { sent: to.length };
  } catch (e) {
    await db.from("invoices").update({ notify_error: errMsg(e) }).eq("id", inv.id);
    throw e;
  }
}

async function refundRequested(caller: Caller, body: any, s: Record<string, any>) {
  const { data: r } = await db.from("refund_requests").select("*").eq("id", body.request_id).single();
  if (!r) throw new HttpError(404, "Refund request not found");
  if (!isAdmin(caller) && (caller.kind !== "user" || r.profile_id !== caller.id)) throw new HttpError(403, "Not allowed");
  const to = addresses(s.notifications?.refund);
  const recipients = to.length ? to : await adminEmails();
  const person = (await personEmails([r.person_id])).get(r.person_id);
  const successor = r.successor_profile_id ? await profileEmail(r.successor_profile_id) : null;
  const requesterEmail = await profileEmail(r.profile_id);
  const leavingOnly = Number(r.amount) === 0;
  const html = layout(
    leavingOnly ? "Leaving the coffee lists" : "Refund requested",
    `<table style="border-collapse:collapse;font-size:14px">
      ${row("Person", `${person?.name ?? ""} <${requesterEmail ?? ""}>`)}${row("Amount", `${Number(r.amount).toFixed(2)} €`)}
      ${row("How", r.method ?? "")}${row("Details", r.details ?? "")}
      ${row("Leaving the lists", r.leaving ? "yes" : "no")}
      ${successor ? row("Proposed successor as admin", successor) : ""}
    </table>
    <p style="font-size:14px">${leavingOnly ? "There is nothing to pay out. Confirm it" : "Pay it out, then mark it as paid"} under <a href="${escapeHtml(APP_URL)}#/refunds" style="color:#8a4b2a">Refunds</a>${leavingOnly ? " with “Mark as paid” to take them off the lists" : ""}.</p>`,
    s.app_name ?? "Coffee & Drinks",
    APP_URL,
  );
  try {
    await sendMail({ to: recipients, replyTo: requesterEmail, subject: leavingOnly ? `Leaving: ${person?.name ?? ""}` : `Refund request: ${Number(r.amount).toFixed(2)} € – ${person?.name ?? ""}`, html });
    await db.from("refund_requests").update({ notified_at: new Date().toISOString(), notify_error: null }).eq("id", r.id);
    return { sent: recipients.length };
  } catch (e) {
    await db.from("refund_requests").update({ notify_error: errMsg(e) }).eq("id", r.id);
    throw e;
  }
}

const ISSUE_LABEL: Record<string, string> = {
  milk: "Milk ran out", coffee: "Coffee beans ran out", supplies: "Other supplies ran out",
  kitchen: "Kitchen not clean / tidy", machine: "Machine or equipment problem", other: "Other",
  app: "App issue or suggestion",
};

async function issueReported(caller: Caller, body: any, s: Record<string, any>) {
  const { data: it } = await db.from("issues").select("*").eq("id", body.issue_id).single();
  if (!it) throw new HttpError(404, "Issue not found");
  if (!isAdmin(caller) && (caller.kind !== "user" || it.reported_by !== caller.id)) throw new HttpError(403, "Not allowed");
  const to = addresses(s.notifications?.issues?.[it.category]);
  const recipients = to.length ? to : await adminEmails();
  const reporterEmail = await profileEmail(it.reported_by);
  const html = layout(
    `Reported: ${ISSUE_LABEL[it.category] ?? it.category}`,
    `<table style="border-collapse:collapse;font-size:14px">
      ${row("What", it.title)}${it.description ? row("Details", it.description) : ""}${it.context ? row("Where", it.context) : ""}
      ${row("Reported by", `${it.reporter_name ?? ""} ${reporterEmail ? `<${reporterEmail}>` : ""}`)}
    </table>
    <p style="font-size:14px"><a href="${escapeHtml(APP_URL)}#/issues" style="color:#8a4b2a">Open the issue list</a> to mark it as resolved.</p>`,
    s.app_name ?? "Coffee & Drinks",
    APP_URL,
  );
  try {
    await sendMail({ to: recipients, replyTo: reporterEmail, subject: it.category === "app" ? `App issue or suggestion: ${it.title}` : `Kitchen: ${ISSUE_LABEL[it.category] ?? it.category} – ${it.title}`, html });
    await db.from("issues").update({ notified_at: new Date().toISOString(), notify_error: null }).eq("id", it.id);
    return { sent: recipients.length };
  } catch (e) {
    await db.from("issues").update({ notify_error: errMsg(e) }).eq("id", it.id);
    throw e;
  }
}

async function issueResolved(caller: Caller, body: any, s: Record<string, any>) {
  if (!isDutyManager(caller)) throw new HttpError(403, "Not allowed");
  const { data: it } = await db.from("issues").select("*").eq("id", body.issue_id).single();
  const email = it && await profileEmail(it.reported_by);
  if (!email) return { sent: false };
  await sendMail({
    to: [email],
    subject: `Resolved: ${it.title}`,
    html: layout(
      "Thanks for reporting",
      `<p style="font-size:14px">"${escapeHtml(it.title)}" has been marked as resolved.</p>${it.resolution ? `<p style="font-size:14px">${escapeHtml(it.resolution)}</p>` : ""}`,
      s.app_name ?? "Coffee & Drinks",
      APP_URL,
    ),
  });
  return { sent: true };
}

async function dutyAssigned(caller: Caller, body: any, s: Record<string, any>) {
  if (!isDutyManager(caller)) throw new HttpError(403, "Not allowed");
  const ids: string[] = body.assignment_ids ?? [];
  const { data: rows } = await db.from("duty_assignments").select("*").in("id", ids);
  const people = await personEmails([...new Set((rows ?? []).map((r) => r.person_id))]);
  const results: Record<string, unknown>[] = [];
  for (const a of rows ?? []) {
    const p = people.get(a.person_id);
    const { data: mates } = await db.from("duty_assignments").select("person_id").eq("week_start", a.week_start);
    const mateNames = (await personEmails((mates ?? []).map((m) => m.person_id).filter((id) => id !== a.person_id)));
    const names = [...mateNames.values()].map((m) => m.name);
    if (!p?.email) {
      await db.from("duty_assignments").update({ notify_error: "No e-mail address" }).eq("id", a.id);
      results.push({ id: a.id, sent: false, error: "No e-mail address" });
      continue;
    }
    const html = layout(
      `You are on kitchen duty in ${weekLabel(a.week_start)}`,
      `<p style="font-size:14px">Hi ${escapeHtml(p.name.split(" ")[0])},</p>
       <p style="font-size:14px">you have been assigned to kitchen duty in <b>${escapeHtml(weekLabel(a.week_start))}</b>.
       ${names.length ? `You share it with ${escapeHtml(names.join(", "))}.` : ""}</p>
       ${a.note ? `<p style="font-size:14px">Note: ${escapeHtml(a.note)}</p>` : ""}
       ${s.duty?.info ? `<p style="font-size:14px;white-space:pre-line">${escapeHtml(s.duty.info)}</p>` : ""}
       <p style="font-size:14px">If you cannot make it, please swap with someone and tell the coffee duty managers.</p>`,
      s.app_name ?? "Coffee & Drinks",
      APP_URL,
    );
    try {
      await sendMail({ to: [p.email], subject: `Kitchen duty: ${weekLabel(a.week_start)}`, html });
      await db.from("duty_assignments").update({ notified_at: new Date().toISOString(), notify_error: null }).eq("id", a.id);
      results.push({ id: a.id, sent: true });
    } catch (e) {
      await db.from("duty_assignments").update({ notify_error: errMsg(e) }).eq("id", a.id);
      results.push({ id: a.id, sent: false, error: errMsg(e) });
    }
  }
  return { results };
}

async function dutyRemoved(caller: Caller, body: any, s: Record<string, any>) {
  if (!isDutyManager(caller)) throw new HttpError(403, "Not allowed");
  const p = (await personEmails([body.person_id])).get(body.person_id);
  if (!p?.email) return { sent: false };
  await sendMail({
    to: [p.email],
    subject: `Kitchen duty cancelled: ${weekLabel(body.week_start)}`,
    html: layout(
      "Kitchen duty cancelled",
      `<p style="font-size:14px">Hi ${escapeHtml(p.name.split(" ")[0])}, you are no longer on kitchen duty in <b>${escapeHtml(weekLabel(body.week_start))}</b>.</p>`,
      s.app_name ?? "Coffee & Drinks",
      APP_URL,
    ),
  });
  return { sent: true };
}

async function invite(caller: Caller, body: any) {
  if (!isAdmin(caller)) throw new HttpError(403, "Not allowed");
  const { data: p } = await db.from("people").select("*").eq("id", body.person_id).single();
  if (!p?.email) throw new HttpError(400, "This person has no e-mail address");
  const { error } = await db.auth.admin.inviteUserByEmail(p.email, {
    redirectTo: APP_URL || undefined,
    data: { first_name: p.first_name, last_name: p.last_name, group: p.group_name },
  });
  if (error) throw new HttpError(400, error.message);
  return { invited: p.email };
}

// Which of the coming weeks a person still has to fill in.
function missingWeeks(weeksAhead: number, filled: Set<string>): string[] {
  const start = mondayOf(todayBerlin());
  const out: string[] = [];
  for (let i = 0; i < weeksAhead; i++) {
    const w = iso(addDays(start, i * 7));
    if (!filled.has(w)) out.push(w);
  }
  return out;
}

async function weekly(caller: Caller, s: Record<string, any>) {
  if (!isAdmin(caller)) throw new HttpError(403, "Not allowed");
  const appName = s.app_name ?? "Coffee & Drinks";
  const av = s.availability ?? {};
  const weeksAhead = Number(av.weeks_ahead ?? 6);
  const summary = { availability_reminders: 0, duty_reminders: 0, errors: [] as string[] };

  if (av.reminders !== false) {
    const { data: profiles } = await db.from("profiles").select("person_id, email").not("person_id", "is", null);
    const ids = (profiles ?? []).map((p) => p.person_id);
    const { data: people } = await db.from("people").select("*").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const from = iso(mondayOf(todayBerlin()));
    const { data: avail } = await db.from("availability").select("person_id, week_start").gte("week_start", from);
    for (const p of people ?? []) {
      if (av.required_for !== "all" && !p.active_coffee && !p.active_drinks) continue;
      const filled = new Set((avail ?? []).filter((a) => a.person_id === p.id).map((a) => a.week_start));
      const missing = missingWeeks(weeksAhead, filled);
      if (!missing.length) continue;
      const email = p.email ?? profiles?.find((x) => x.person_id === p.id)?.email;
      if (!email) continue;
      try {
        await sendMail({
          to: [email],
          subject: "Reminder: please fill in your kitchen-duty availability",
          html: layout(
            "Please fill in your availability",
            `<p style="font-size:14px">Hi ${escapeHtml(p.first_name)},</p>
             <p style="font-size:14px">filling in your kitchen-duty availability is required. You have not answered for
             ${missing.length} of the next ${weeksAhead} weeks:</p>
             <ul style="font-size:14px">${missing.map((w) => `<li>${escapeHtml(weekLabel(w))}</li>`).join("")}</ul>
             <p style="font-size:14px"><a href="${escapeHtml(APP_URL)}#/availability" style="color:#8a4b2a">Fill in availability</a></p>`,
            appName,
            APP_URL,
          ),
        });
        summary.availability_reminders++;
      } catch (e) {
        summary.errors.push(`${email}: ${errMsg(e)}`);
      }
    }
  }

  if (s.duty?.reminders !== false) {
    const week = iso(mondayOf(todayBerlin()));
    const { data: rows } = await db.from("duty_assignments").select("*").eq("week_start", week);
    const people = await personEmails((rows ?? []).map((r) => r.person_id));
    const names = [...people.values()].map((p) => p.name);
    for (const r of rows ?? []) {
      const p = people.get(r.person_id);
      if (!p?.email) continue;
      try {
        await sendMail({
          to: [p.email],
          subject: `Reminder: kitchen duty this week (${weekLabel(week)})`,
          html: layout(
            "You are on kitchen duty this week",
            `<p style="font-size:14px">Hi ${escapeHtml(p.name.split(" ")[0])}, a reminder that you are on kitchen duty in
             <b>${escapeHtml(weekLabel(week))}</b> together with ${escapeHtml(names.filter((n) => n !== p.name).join(", ") || "nobody else")}.</p>
             ${s.duty?.info ? `<p style="font-size:14px;white-space:pre-line">${escapeHtml(s.duty.info)}</p>` : ""}`,
            appName,
            APP_URL,
          ),
        });
        summary.duty_reminders++;
      } catch (e) {
        summary.errors.push(`${p.email}: ${errMsg(e)}`);
      }
    }
  }
  return summary;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const caller = await identify(req);
    const body = await req.json().catch(() => ({}));
    const s = await settings();
    switch (body.type) {
      case "invoice_submitted": return json(await invoiceSubmitted(caller, body, s));
      case "duty_assigned": return json(await dutyAssigned(caller, body, s));
      case "duty_removed": return json(await dutyRemoved(caller, body, s));
      case "invite": return json(await invite(caller, body));
      case "weekly": return json(await weekly(caller, s));
      case "refund_requested": return json(await refundRequested(caller, body, s));
      case "issue_reported": return json(await issueReported(caller, body, s));
      case "issue_resolved": return json(await issueResolved(caller, body, s));
      default: throw new HttpError(400, `Unknown type: ${body.type}`);
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: errMsg(e) }, status);
  }
});

