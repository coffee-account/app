// Balance calculation. Each count is charged at the price valid on its session date.

import { mondayOf, weeksFrom } from "./dates.js";

export const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

export function priceAt(prices, kind, date) {
  let best = null;
  for (const p of prices) {
    if (p.kind === kind && p.valid_from <= date && (!best || p.valid_from > best.valid_from)) best = p;
  }
  return best ? Number(best.price) : 0;
}

/**
 * @returns Map personId → { person, coffees, drinks, coffeeCost, drinksCost, paid, balance, entries }
 * entries: chronological list of { date, kind: 'coffee'|'drinks'|'payment', quantity?, amount }
 */
export function computeLedger({ people, sessions, counts, payments, prices }) {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const ledger = new Map();
  for (const person of people) {
    ledger.set(person.id, {
      person, coffees: 0, drinks: 0, coffeeCost: 0, drinksCost: 0, paid: 0,
      balance: Number(person.starting_balance || 0), entries: [],
    });
  }
  for (const c of counts) {
    const s = sessionById.get(c.session_id);
    const row = ledger.get(c.person_id);
    if (!s || !row || !c.quantity) continue;
    const unit = priceAt(prices, s.kind, s.session_date);
    const cost = c.quantity * unit;
    if (s.kind === "coffee") { row.coffees += c.quantity; row.coffeeCost += cost; }
    else { row.drinks += c.quantity; row.drinksCost += cost; }
    row.entries.push({ date: s.session_date, kind: s.kind, quantity: c.quantity, unit, amount: -cost });
  }
  for (const p of payments) {
    const row = ledger.get(p.person_id);
    if (!row) continue;
    row.paid += Number(p.amount);
    row.entries.push({ date: p.paid_on, kind: "payment", amount: Number(p.amount), note: p.method || p.note || "" });
  }
  for (const row of ledger.values()) {
    row.coffeeCost = round2(row.coffeeCost);
    row.drinksCost = round2(row.drinksCost);
    row.paid = round2(row.paid);
    row.balance = round2(row.balance + row.paid - row.coffeeCost - row.drinksCost);
    row.entries.sort((a, b) => a.date.localeCompare(b.date));
  }
  return ledger;
}

export function personName(p) {
  return p ? `${p.first_name} ${p.last_name}` : "Unknown";
}

export function sortPeople(list, by = "group") {
  const coll = new Intl.Collator("de", { sensitivity: "base" });
  const keyFns = {
    group: (p) => [p.group_name || "~", p.last_name, p.first_name],
    last: (p) => [p.last_name, p.first_name],
    first: (p) => [p.first_name, p.last_name],
  };
  const key = keyFns[by] || keyFns.group;
  return [...list].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      const c = coll.compare(ka[i] || "", kb[i] || "");
      if (c) return c;
    }
    return 0;
  });
}

// ── Kitchen-duty availability rules ──

export function availabilityRules(settings) {
  const a = settings.availability || {};
  return { weeksAhead: Number(a.weeks_ahead ?? 6), requiredFor: a.required_for || "active" };
}

export function availabilityRequired(settings, person) {
  if (!person) return false;
  const { requiredFor } = availabilityRules(settings);
  return requiredFor === "all" || person.active_coffee || person.active_drinks;
}

/** Weeks (Mondays) in the mandatory window the person has not answered yet. */
export function missingAvailability(settings, rows) {
  const { weeksAhead } = availabilityRules(settings);
  const filled = new Set(rows.map((r) => r.week_start));
  return weeksFrom(weeksAhead, mondayOf()).filter((w) => !filled.has(w));
}
