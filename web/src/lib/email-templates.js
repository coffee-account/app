// The e-mails the notify function sends, for the E-mails page. The texts themselves live in the
// email_templates table; these defaults are what the migration seeds (keep both in step) and what the demo uses.
// Text format: Markdown as on the Info page. {placeholder} is filled in per e-mail; a line whose
// placeholders are all empty is left out, and a placeholder alone on a line can stand for a block (a table or list).
// A single line break stays a line break; a blank line starts a new paragraph.

const DUTY_LINK = "https://pad.gwdg.de/r4sTfbuzTH6UCXbkppGjJA?both#Kitchen-duties";

export const EMAIL_TEMPLATES = [
  {
    key: "duty_assigned", editor: "duty", label: "Kitchen duty assigned", to: "The person assigned, right away",
    vars: { first_name: "Ada", week: "week 47 (17 Nov – 23 Nov)", others_on_duty: "Bob Builder, Clara Weiss", note: "Only Mon–Wed", app_url: "https://example.org/" },
    subject: "Kitchen duty: {week}",
    body: `Hi {first_name},

you have been assigned to kitchen duty in **{week}**.
On duty with you: {others_on_duty}.
Note: {note}

What to do during your week: [Kitchen duties](${DUTY_LINK})

If you cannot make it, please swap with someone and tell the duty managers.`,
  },
  {
    key: "duty_removed", editor: "duty", label: "Kitchen duty cancelled", to: "The person taken off a week",
    vars: { first_name: "Ada", week: "week 47 (17 Nov – 23 Nov)", app_url: "https://example.org/" },
    subject: "Kitchen duty cancelled: {week}",
    body: "Hi {first_name}, you are no longer on kitchen duty in **{week}**.",
  },
  {
    key: "duty_reminder", editor: "duty", label: "Kitchen duty this week", to: "Everyone on duty, Monday morning",
    vars: { first_name: "Ada", week: "week 47 (17 Nov – 23 Nov)", others_on_duty: "Bob Builder, Clara Weiss", app_url: "https://example.org/" },
    subject: "Reminder: kitchen duty this week ({week})",
    body: `Hi {first_name}, a reminder that you are on kitchen duty in **{week}**.
On duty with you: {others_on_duty}.

What to do during your week: [Kitchen duties](${DUTY_LINK})`,
  },
  {
    key: "availability_reminder", editor: "duty", label: "Availability reminder", to: "The people a duty manager picks (Kitchen duty → Availability reminders)",
    vars: { first_name: "Ada", weeks: "- week 47 (17 Nov – 23 Nov)\n- week 48 (24 Nov – 30 Nov)", count: "2", weeks_ahead: "6", app_url: "https://example.org/" },
    subject: "Reminder: please fill in your kitchen-duty availability",
    body: `Hi {first_name},

your kitchen-duty availability is running out. Please answer these weeks:

{weeks}

[Fill in availability]({app_url}#/availability)`,
  },
  {
    key: "issue_reported", editor: "reports", label: "Issue reported", to: "The address set for that kind of issue (Settings → Notifications), else all admins",
    vars: { category: "Milk ran out", title: "No oat milk", details: "**What** No oat milk\n**Reported by** Ada Lovelace", app_url: "https://example.org/" },
    subject: "Reported: {category} – {title}",
    body: `{details}

[Open the issue list]({app_url}#/issues) to mark it as resolved.`,
  },
  {
    key: "issue_resolved", editor: "reports", label: "Issue resolved", to: "Whoever reported it, if chosen when resolving",
    vars: { title: "No oat milk", resolution: "Bought two cartons.", app_url: "https://example.org/" },
    subject: "Resolved: {title}",
    body: `Thanks for reporting. "{title}" has been marked as resolved.

{resolution}`,
  },
  {
    key: "invoice_submitted", editor: "admin", label: "Invoice uploaded", to: "The reimbursement address (Settings)",
    vars: { submitter: "Ada Lovelace", amount: "12,49 €", supplier: "Rewe", details: "**Amount** 12,49 €\n**Supplier** Rewe", app_url: "https://example.org/" },
    subject: "Reimbursement request: {amount} – {supplier}",
    body: `{submitter} has uploaded an invoice to be reimbursed.

{details}

Pay it out, then mark it as reimbursed under [Invoices]({app_url}#/invoices).`,
  },
  {
    key: "advance_requested", editor: "admin", label: "Advance payment requested", to: "The reimbursement address (Settings)",
    vars: { submitter: "Ada Lovelace", amount: "30,00 €", supplier: "Metro", details: "**Amount needed** 30,00 €\n**Where** Metro", app_url: "https://example.org/" },
    subject: "Advance payment request: {amount} – {supplier}",
    body: `{submitter} would like the money in advance for something they will buy for the kitchen.

{details}

The receipt will follow once the purchase has been made.`,
  },
  {
    key: "low_balance", editor: "admin", label: "Low balance", to: "The people an admin picks on the Balances page",
    vars: { first_name: "Ada", balance: "-12,40 €", threshold: "-10,00 €", payment_info: "Transfer to the PayPal account coffee@example.org.", app_url: "https://example.org/" },
    subject: "Your coffee balance: {balance}",
    body: `Hi {first_name},

your balance on the coffee and drinks list is **{balance}**, below {threshold}. Please top it up soon.

{payment_info}

[See your balance and history]({app_url})`,
  },
  {
    key: "refund_requested", editor: "admin", label: "Refund requested", to: "The refund address (Settings → Notifications), else all admins",
    vars: { person: "Ada Lovelace", amount: "18,20 €", details: "**Amount** 18,20 €\n**How** PayPal", app_url: "https://example.org/" },
    subject: "Refund request: {amount} – {person}",
    body: `{details}

Pay it out, then mark it as paid under [Refunds]({app_url}#/refunds).`,
  },
  {
    key: "leaving_requested", editor: "admin", label: "Leaving without a refund", to: "The refund address (Settings → Notifications), else all admins",
    vars: { person: "Ada Lovelace", details: "**Leaving the lists** yes", app_url: "https://example.org/" },
    subject: "Leaving: {person}",
    body: `{details}

There is nothing to pay out. Confirm it under [Refunds]({app_url}#/refunds) with "Mark as paid" to take them off the lists.`,
  },
];

export const EDITOR_LABEL = { duty: "Duty managers", reports: "People who resolve reports", admin: "Admins" };

/** Whether the signed-in user may edit this kind of e-mail (the database checks the same). */
export const mayEditEmail = (app, t) => app.isAdmin || (t.editor === "duty" && app.canManageDuties) || (t.editor === "reports" && app.canResolve);
