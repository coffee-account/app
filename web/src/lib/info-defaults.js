// Starting text for the Info page. Admins can replace it on the page itself.
// Placeholders: {coffee_price}, {drinks_price}, {low_threshold}, {weeks_ahead}, {app_url}

export const DEFAULT_INFO = `## Using this app
- **My account**: your balance and every count and payment. Please top up when it gets close to **{low_threshold}**. It can take a few days for a payment to show up.
- **My availability**: answer the next **{weeks_ahead} weeks** for kitchen duty. You'll be asked again once only a few weeks are left. You'll get an e-mail when you're assigned.
- **Report an issue**: something has run out or is broken, or something in this app isn't working.
- **Refunds**: leaving? Ask for your remaining balance here.

Each coffee is **{coffee_price}** and each drink **{drinks_price}**. Make your marks on the paper list next to the machine.

## Kitchen duty
What to do during your duty week: [Kitchen duties](https://pad.gwdg.de/r4sTfbuzTH6UCXbkppGjJA?both#Kitchen-duties).
`;

export const DEFAULT_ADMIN_INFO = `## Counting
When a paper list has been collected, an admin opens a count under **Counting**. Open that count from the list there (don't start a new one), enter the marks for the people in your group, then tick your group as counted. The list shows which groups are still missing.

## Your group
- New people register themselves. Connect each new account to their entry under **Accounts**, then switch them on for coffee and/or drinks under **People**.
- People with counts or payments can't be deleted; switch both lists off instead.
- Record payments from your group under **Payments**.
- Check **Balances** and remind everyone below **{low_threshold}**.
`;

export const DEFAULT_INVOICE_INFO = `- Bought something for the kitchen? Upload the receipt under **Invoices** to get the money back.
- Need the money before you buy? Choose **Advance payment** there, then send the receipt to the accounting contact once you've bought it.
- Say how you want to be paid (PayPal address or IBAN). The status in the list shows when it has been paid out.
`;
