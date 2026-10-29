# Coffee & Drinks accounting

A web app for running the kitchen coffee and drinks lists:

- **Balances**: starting balance + payments − marks × price. Each count uses the price that was valid on its date.
- **Counting**: type in the marks from a collected paper list, in the same order as the printed list.
- **Payments**: record PayPal, cash and other payments, plus corrections.
- **Print lists**: coffee and drinks lists are generated from each person's two "active" switches. You can customise the layout (texts, columns, tally range, widths, empty rows, image or QR code, A4 portrait or landscape), save it as a template, and export it as PDF (via the print dialog) or Word.
- **Kitchen duty**:
  - Everyone fills in their availability for the coming weeks. This is mandatory: the app stays locked until it's done, and a weekly reminder email goes out.
  - Duty managers assign one or more people per week, and everyone assigned gets an email.
- **Invoices**: permitted people upload a receipt. The reimbursement address you set in Settings gets an email with the file attached and a download link, and you track each invoice as submitted, reimbursed or rejected.
- **Import and export**: a one-time import from the old `Coffee Accounting` .xlsx, and an export back to Excel in the same sheet layout.

## Roles

| | Member | Member + "Upload invoices" | Member + "Manage kitchen duty" | Admin |
|---|---|---|---|---|
| See own balance and history | ✓ | ✓ | ✓ | ✓ |
| Fill in own availability, see duty schedule | ✓ | ✓ | ✓ | ✓ |
| Upload invoices and email the reimbursement contact | | ✓ | | ✓ |
| See everyone's availability, assign duties | | | ✓ | ✓ |
| People, counting, payments, balances, lists, settings, roles | | | | ✓ |

- Anyone can register as a member. You can restrict registration to email domains in **Settings**, e.g. `uni-goettingen.de`.
- When someone registers, their account is linked to their row on the list in one of three ways:
  - **By email:** automatically, if you stored their email on the person.
  - **By name:** an admin confirms the match under **Accounts & roles**.
  - **New person:** a new, inactive person is created.

Access control is enforced **in the database** (Postgres row-level security), not in the browser. The website code can therefore be public: a member who edits the page's JavaScript still can't read anyone else's balance.

## How it is built

```
GitHub Pages (static site: web/)  ──►  Supabase (EU region)
  plain HTML/JS, no build step          ├─ Postgres + row-level security  (supabase/migrations)
  libraries from jsDelivr               ├─ Auth: email + password, confirmation, password reset
                                        ├─ Storage: private "invoices" bucket
                                        └─ Edge Function "notify": all emails (Resend or SMTP)
```

With no Supabase project configured in `web/config.js`, the site runs as a **demo**: fictional sample data stored in your browser. Use it to try everything before setting up.

To try it locally:

```bash
python3 serve.py
```

Then open <http://localhost:8000>. Run it from the project folder. It serves `web/` and tells the browser not to cache, so every reload shows your latest changes. (A plain `python3 -m http.server` lets the browser keep old files, which can mix old and new code after an edit.)

---

## Setup (about 20 minutes)

### 1. Supabase project

1. Create a free account at <https://supabase.com>, then a new project. Choose region **Central EU (Frankfurt)** for GDPR.
2. Open **SQL Editor**, paste the whole of `supabase/migrations/20261021000000_init.sql`, and run it. Then do the same with every later file in `supabase/migrations/`, oldest first (currently `20261029000000_info_refunds_issues.sql`: Info page, refunds, issue reports, advance payments). Each script only needs to run once per project.
3. Under **Project Settings → API**, copy the **Project URL** and the **anon public** key.

### 2. Email sending

Every email the app sends goes through the `notify` function: invoices, duty assignments and reminders. Sign-up confirmations and password resets come from Supabase Auth itself. You need a sending service for both.

**Option A: Resend (recommended).** Free up to 3,000 emails a month.
1. Create an account at <https://resend.com>.
2. Add and verify a domain you control, under **Domains**. Without a verified domain, Resend only delivers to your own address.
3. Create an API key.

**Option B: any SMTP account** that allows port 465, for example a Gmail account with an app password, or your institute's mail server if it permits this.

Then do both of the following:

- **Function secrets** (Supabase → **Edge Functions → Secrets**):

  | Secret | Value |
  |---|---|
  | `MAIL_FROM` | `Coffee <coffee@your-domain.org>` |
  | `APP_URL` | your site URL, e.g. `https://<user>.github.io/<repo>/` |
  | `CRON_SECRET` | any long random string (used by the weekly reminder job) |
  | `RESEND_API_KEY` | your Resend key (option A) |
  | `MAIL_PROVIDER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | `smtp` and your server details (option B instead of Resend) |

- **Auth emails:** under **Authentication → Emails → SMTP Settings**, turn on **custom SMTP** with the same provider. For Resend the host is `smtp.resend.com`, port `465`, user `resend`, and the password is your API key.

  This step matters: Supabase's built-in mailer only delivers to members of your Supabase team and is heavily rate-limited. Without custom SMTP, people won't receive confirmation emails.

### 3. Deploy the email function

With the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
```
```bash
supabase link --project-ref <PROJECT-REF>
```
```bash
supabase functions deploy notify --no-verify-jwt
```

Without the CLI: go to **Edge Functions → Deploy a new function → Via editor**, name it `notify`, and add the two files `index.ts` and `mailer.ts` from `supabase/functions/notify/`. Then turn off **Enforce JWT verification** in the function's settings.

JWT verification is off because the weekly job calls the function without a user login. The function checks the caller itself: a valid user session with the right role, or the cron secret.

### 4. Weekly reminders

Edit `supabase/cron.sql` to fill in your project reference and `CRON_SECRET`, then run it in the SQL Editor. Reminders go out every Monday at 08:00 UTC. Admins can also send them at any time with **Kitchen duty → Send reminders now**.

### 5. Publish on GitHub Pages

1. Put your Project URL and anon key into `web/config.js`.
2. Create a GitHub repository, then push this folder to it:

   ```bash
   git init -b main
   ```
   ```bash
   git add . && git commit -m "Coffee & Drinks accounting"
   ```
   ```bash
   git remote add origin https://github.com/<user>/<repo>.git && git push -u origin main
   ```
3. On GitHub, go to **Settings → Pages → Source** and choose **GitHub Actions**. The included workflow publishes `web/` on every push to `main`.
4. In Supabase, go to **Authentication → URL Configuration**:
   - Set **Site URL** to `https://<user>.github.io/<repo>/`.
   - Add the same URL under **Redirect URLs**.

### 6. First admin and data import

1. Open the site and **register** yourself, then confirm your email.
2. In the Supabase SQL Editor, make yourself admin:
   ```sql
   update profiles set role = 'admin' where email = 'you@uni-goettingen.de';
   ```
3. Reload the site. Under **Import spreadsheet**, choose the old workbook. The app shows what it found before saving anything:
   - **People not found:** names in the count sheets that don't match anyone in People.
   - **Merged group spellings:** for example "De Vries" and "de Vries".
   - **Balance differences:** every balance that differs from the old Balance sheet.

   Then click **Import now**.
4. Under **Settings**, set:
   - the reimbursement email address
   - the allowed sign-up domains
   - the availability rules
   - the duty instructions text
5. Under **Print lists**, adjust the layout and **Save as new…** to keep it as a template.

## Notes

- **Privacy:** the repository contains no personal data; everything lives in Supabase. `.gitignore` excludes `.xlsx`, `.csv` and `.docx` files so exported lists and spreadsheets aren't committed by accident.
- **The anon key in `config.js` is public by design.** Never put the `service_role` key in the website.
- **Prices:** adding a price with a start date only affects counts from that date on. Older counts keep their price.
- **Deleting people:** someone with counts or payments can't be deleted, to protect the books. Switch both "active" options off instead.
- **Removing an account:** delete it in Supabase under **Authentication → Users**. Their person record and balance stay.
- **Backups:** the free Supabase plan doesn't keep backups for you. Use **Balances → Export Excel** now and then.
