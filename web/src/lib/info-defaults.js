// Suggested starting text for the Info page. Admins can replace it on the page itself.
// Placeholders: {coffee_price}, {drinks_price}, {low_threshold}, {weeks_ahead}, {app_url}

export const DEFAULT_INFO = `## How the coffee corner works
Everyone who drinks coffee or drinks from the kitchen is on a paper list next to the machine. Each time you take one, add a mark behind your name. Every few weeks the lists are collected, the marks are counted, and your balance here is updated.

- One coffee costs **{coffee_price}**, one drink **{drinks_price}**.
- Please put at most five marks per box (four strokes and one across) and write new entries legibly.
- Your current balance and every count and payment are under **My account**.

## Joining
1. Transfer a starting credit of 20 € (see *How to pay* below).
2. Register in this app with your university e-mail address and the same name as on the list.
3. Ask the accounting manager to put you on the coffee and/or drinks list. You'll appear on the next printed list.

## How to pay
Top up your balance whenever it gets low; you'll see a warning in the app below **{low_threshold}**. Payments are entered by the accounting manager, so it can take a few days until they show up.

## Kitchen duty
Everyone on a list takes turns keeping the kitchen usable, one week at a time, usually two people per week.
- Keep your availability for the next **{weeks_ahead} weeks** filled in under **My availability**. It is required, and you'll get a reminder e-mail when weeks are missing.
- You get an e-mail when you're assigned, and a reminder at the start of your week.
- During your week: empty and refill the dishwasher, wipe the counters and the table, descale and clean the coffee machine, take out paper and bottles, and check milk and coffee beans.
- Can't make it? Swap with someone and tell a duty manager.

## Something ran out or is broken?
Use **Report an issue**: milk, coffee beans, other supplies, a dirty kitchen or a broken machine. The right people are notified straight away.

## Bought something for the kitchen?
Upload the receipt under **Invoices** to get reimbursed. If you'd rather have the money before you buy, choose **Advance payment** there instead and send the receipt once you've made the purchase.

## Leaving?
Request your remaining balance under **Refund**. You'll be taken off the lists once it has been paid out.

## Contact
Questions about your balance or the lists: the accounting manager. Kitchen duty: the duty managers. Something not working in this app ({app_url}), or an idea to improve it? Use **Report an issue → App issues and suggestions**.
`;

export const DEFAULT_ADMIN_INFO = `## Regular routine
**Every week**
- Check new **Issues** and make sure someone takes care of them.
- Look at **Kitchen duty → Availability overview** and assign the coming weeks.

**When a paper list is full (every 6–8 weeks)**
1. Collect the coffee and drinks lists and print new ones under **Print lists** (set the list date to today).
2. Enter the marks under **Counting**, one session per list and date. Enter or the arrow keys move between people.
3. Check **Balances**: remind everyone below the threshold.

**Whenever money comes in or goes out**
- Record payments under **Payments** (PayPal, cash, bank transfer).
- Handle **Invoices**: pay out reimbursements and advances, then mark them reimbursed.
- Handle **Refunds**: pay out, then click *Mark as paid*. This records the payout, takes the person off both lists and, for a leaving admin, makes the nominated successor admin.

## People and accounts
- New people register themselves. Connect each account to their entry under **Accounts & roles**, then switch them on for coffee and/or drinks under **People**.
- People with counts or payments can't be deleted; switch both lists off instead.
- Give duty managers the *Manage kitchen duty* right, and invoice helpers *Upload invoices*.

## Notifications
Under **Settings → Notifications** you choose who gets which e-mail: reimbursement and advance requests, refund requests, and each kind of reported issue. Empty fields go to all admins.

## Handing over
Before you leave, request your refund and nominate your successor. Export everything under **Balances → Export Excel** first, and keep a copy of the current templates.

## Prices
A new price only applies from its start date (**Settings → Prices**); older counts keep their old price.
`;
