// Sends e-mail through Resend (default) or any SMTP server (MAIL_PROVIDER=smtp).

export interface Attachment {
  filename: string;
  content: Uint8Array;
}

export interface Mail {
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  attachments?: Attachment[];
}

const env = (k: string, fallback = "") => Deno.env.get(k) ?? fallback;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function sendResend(mail: Mail) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env("MAIL_FROM"),
      to: mail.to,
      cc: mail.cc?.length ? mail.cc : undefined,
      reply_to: mail.replyTo,
      subject: mail.subject,
      html: mail.html,
      attachments: mail.attachments?.map((a) => ({ filename: a.filename, content: toBase64(a.content) })),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

async function sendSmtp(mail: Mail) {
  const { default: nodemailer } = await import("npm:nodemailer@6.9.16");
  const port = Number(env("SMTP_PORT", "465"));
  const transport = nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port,
    secure: port === 465,
    auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS") },
  });
  await transport.sendMail({
    from: env("MAIL_FROM"),
    to: mail.to.join(", "),
    cc: mail.cc?.join(", "),
    replyTo: mail.replyTo,
    subject: mail.subject,
    html: mail.html,
    attachments: mail.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
  });
}

export async function sendMail(mail: Mail) {
  if (!mail.to.length) throw new Error("No recipient");
  if (env("MAIL_PROVIDER", "resend") === "smtp") return sendSmtp(mail);
  return sendResend(mail);
}

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
}

export function layout(title: string, body: string, appName: string, appUrl: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f2ee;font-family:Arial,Helvetica,sans-serif;color:#2b2623">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:10px;padding:24px 28px;border:1px solid #e6dfd7">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a6d55">${escapeHtml(appName)}</div>
<h1 style="font-size:20px;margin:6px 0 16px">${escapeHtml(title)}</h1>
${body}
<p style="margin-top:24px;font-size:13px;color:#7a716a"><a href="${escapeHtml(appUrl)}" style="color:#8a4b2a">Open ${escapeHtml(appName)}</a></p>
</div></body></html>`;
}

// ── Editable e-mail texts (table email_templates) ──
// The same Markdown as the Info page (web/src/lib/markdown.js), so the editor's preview matches:
// "## " / "### " headings, "- " and "1. " lists, blank-line paragraphs, single line breaks, **bold**, *italic*,
// [text](https://… or mailto:…), bare URLs and e-mail addresses. Links to anything else stay plain text.
// {name} is replaced by vars[name], escaped; a line whose placeholders are all empty is left out
// ({app_url} doesn't count); a placeholder alone on a line may be a ready-made HTML block (blocks[name]).

const P = 'style="font-size:14px"';
const A = 'style="color:#8a4b2a"';

function inline(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => (/^(https?:\/\/|mailto:)/.test(u) ? `<a href="${u}" ${A}>${t}</a>` : t));
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, u) => `${pre}<a href="${u}" ${A}>${u}</a>`);
  s = s.replace(/(^|[\s(])([\w.+-]+@[\w-]+\.[\w.-]+\w)/g, (_, pre, e) => `${pre}<a href="mailto:${e}" ${A}>${e}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");
  return s;
}

export function renderTemplate(
  tpl: { subject: string; body: string },
  vars: Record<string, unknown>,
  blocks: Record<string, string> = {},
): { subject: string; html: string } {
  const value = (k: string) => String(vars[k] ?? "");
  const fill = (text: string) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? value(k) : m));
  const subject = fill(tpl.subject).replace(/\s+/g, " ").trim();
  // Placeholders become markers first, so their values are escaped and never read as Markdown.
  // Inside a link target they are filled in directly, so the target can be checked as a whole.
  const mark = (k: string) => `\u0001${k}\u0002`;
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: string; items: string[] } | null = null;
  const flushPara = () => { if (para.length) { out.push(`<p ${P}>${para.map(inline).join("<br>")}</p>`); para = []; } };
  const flushList = () => {
    if (list) { out.push(`<${list.tag} ${P}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; }
  };
  for (const raw of tpl.body.split("\n")) {
    const line = raw.trimEnd();
    const block = line.trim().match(/^\{(\w+)\}$/)?.[1];
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (block && block in blocks) { flushPara(); flushList(); if (blocks[block]) out.push(blocks[block]); continue; }
    const keys = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => k in vars && k !== "app_url");
    if (keys.length && keys.every((k) => !value(k))) continue;
    const marked = line
      .replace(/\]\(([^)\s]*)\)/g, (_, u) => `](${fill(u)})`)
      .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? mark(k) : m));
    let m;
    if ((m = marked.match(/^(#{2,3})\s+(.*)$/))) {
      flushPara(); flushList();
      const size = m[1].length === 2 ? 17 : 15;
      out.push(`<h${m[1].length + 1} style="font-size:${size}px;margin:18px 0 6px">${inline(m[2])}</h${m[1].length + 1}>`);
    } else if ((m = marked.match(/^\s*[-*]\s+(.*)$/)) || (m = marked.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      const tag = /^\s*\d/.test(marked) ? "ol" : "ul";
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(m[1]);
    } else {
      flushList();
      para.push(marked.trim());
    }
  }
  flushPara();
  flushList();
  // deno-lint-ignore no-control-regex
  const html = out.join("\n").replace(/\u0001(\w+)\u0002/g, (_, k) => escapeHtml(value(k)));
  return { subject, html };
}
