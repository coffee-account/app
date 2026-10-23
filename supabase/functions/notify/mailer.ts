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
