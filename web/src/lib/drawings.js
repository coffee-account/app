// Playfulcrema visual pieces: status cups, key-figure bar, dictionary entry, empty states, line drawings.

import { html } from "./ui.js";

// ── Status cup ──
// state: "available" (full) | "if_needed" (half) | "unavailable" (empty) | anything else (no answer, dashed)
const BODY = "M2.5 4.5 H11.5 V10 A3.5 3.5 0 0 1 8 13.5 H6 A3.5 3.5 0 0 1 2.5 10 Z";
const LOWER = "M2.5 9 H11.5 V10 A3.5 3.5 0 0 1 8 13.5 H6 A3.5 3.5 0 0 1 2.5 10 Z";
const HANDLE = "M11.5 6 H12.5 A2 2 0 0 1 12.5 10 H11.5";

export const CUP_WORDS = {
  available: "Available",
  if_needed: "If needed",
  unavailable: "Not available",
  none: "No answer",
};

export function StatusCup({ state, size = 16, label }) {
  const s = CUP_WORDS[state] && state !== "none" ? state : "none";
  const dashed = s === "none";
  const stroke = dashed ? "var(--ink-mute)" : "currentColor";
  return html`<span class="cup" title=${label ?? CUP_WORDS[s]}>
    <svg width=${size} height=${size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      ${s === "available" && html`<path d=${BODY} fill="var(--layer-coffee)" />`}
      ${s === "if_needed" && html`<path d=${LOWER} fill="var(--layer-caramel)" />`}
      <path d=${BODY} fill="none" stroke=${stroke} stroke-width="1.3" stroke-linejoin="round" stroke-dasharray=${dashed ? "2 1.6" : undefined} />
      <path d=${HANDLE} fill="none" stroke=${stroke} stroke-width="1.3" stroke-linecap="round" stroke-dasharray=${dashed ? "2 1.6" : undefined} />
    </svg>
    <span class="sr-only">${label ?? CUP_WORDS[s]}</span>
  </span>`;
}

export function CupLegend() {
  return html`<div class="legend" aria-label="Legend">
    ${["available", "if_needed", "unavailable", "none"].map((s) => html`<span><${StatusCup} state=${s} label="" />${CUP_WORDS[s]}</span>`)}
  </div>`;
}

/** Horizontal fill level: value of max, shown as a number too. */
export function FillLevel({ value, max, label }) {
  const pct = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return html`<div class="fill-level">
    <div class="fill-track" role="meter" aria-valuemin="0" aria-valuemax=${max} aria-valuenow=${value} aria-label=${label}>
      <div class="fill-pour" style=${`width:${pct}%`}></div>
    </div>
    <span class="fill-number">${value} of ${max}</span>
  </div>`;
}

// ── Key-figure bar ──
// items: [{ label, value, sub, tone: "neg" | "pos" | undefined }]
export function Figures({ items }) {
  return html`<div class="figures">
    ${items.map((f) => html`<div class="figure">
      <div class="figure-label">${f.label}</div>
      <div class="figure-value ${f.tone || ""}">${f.value}</div>
      ${f.sub && html`<div class="figure-sub">${f.sub}</div>`}
    </div>`)}
  </div>`;
}

// ── Dictionary entry ──
export function DictEntry({ word, pos, children }) {
  return html`<div class="dict">
    <span class="dict-word">${word}</span> <span class="dict-pos">(${pos})</span>
    <p class="dict-def">${children}</p>
  </div>`;
}

export function EmptyState({ drawing, children, action }) {
  return html`<div class="empty">
    ${drawing}
    <p>${children}</p>
    ${action}
  </div>`;
}

// ── Drawings (viewBox 200×200, ink outlines, one solid ink area) ──
const svgAttrs = { viewBox: "0 0 200 200", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" };

/** A tall cup with four coffee layers and steam. */
export function LayeredCup({ size = 160 }) {
  return html`<svg class="drawing" width=${size} height=${size} ...${svgAttrs}>
    <defs><clipPath id="pc-cup-body"><path d="M52 62 H136 V132 A26 26 0 0 1 110 158 H78 A26 26 0 0 1 52 132 Z" /></clipPath></defs>
    <g clip-path="url(#pc-cup-body)" stroke="none">
      <rect x="40" y="132" width="110" height="30" fill="var(--layer-espresso)" />
      <rect x="40" y="108" width="110" height="24" fill="var(--layer-coffee)" />
      <rect x="40" y="88" width="110" height="20" fill="var(--layer-milk)" />
      <rect x="40" y="62" width="110" height="26" fill="var(--layer-foam)" />
    </g>
    <path d="M52 62 H136 V132 A26 26 0 0 1 110 158 H78 A26 26 0 0 1 52 132 Z" />
    <path d="M136 80 H146 A16 16 0 0 1 146 112 H136" fill="currentColor" />
    <ellipse cx="94" cy="166" rx="62" ry="7" fill="var(--cup)" />
    <path d="M80 50 C74 42 86 36 80 26" /><path d="M96 48 C90 38 104 32 96 20" /><path d="M112 50 C106 42 118 36 112 28" />
  </svg>`;
}

/** A person carrying a receipt as tall as they are. */
export function ReceiptCarrier({ size = 130 }) {
  return html`<svg class="drawing" width=${size} height=${size} ...${svgAttrs}>
    <path d="M98 18 H156 V164 L149 158 L142 164 L135 158 L128 164 L121 158 L114 164 L107 158 L98 164 Z" fill="var(--cup)" />
    <line x1="108" y1="36" x2="146" y2="36" /><line x1="108" y1="52" x2="140" y2="52" /><line x1="108" y1="68" x2="146" y2="68" />
    <line x1="108" y1="84" x2="134" y2="84" /><line x1="108" y1="136" x2="146" y2="136" stroke-width="3" />
    <circle cx="66" cy="62" r="13" fill="var(--cup)" /><circle cx="72" cy="59" r="1.6" fill="currentColor" stroke="none" /><path d="M79 63 L82 66" />
    <path d="M58 78 Q66 74 74 78 L78 124 L56 124 Z" fill="var(--cup)" />
    <path d="M72 88 L100 98" /><ellipse cx="102" cy="99" rx="4.5" ry="3.5" fill="var(--cup)" />
    <path d="M56 124 H78 L82 172 H74 L67 138 L62 172 H54 Z" fill="currentColor" />
    <ellipse cx="57" cy="176" rx="11" ry="4.5" fill="var(--cup)" /><ellipse cx="80" cy="176" rx="11" ry="4.5" fill="var(--cup)" />
  </svg>`;
}

/** A tally sheet with one bundle of five. */
export function TallySheet({ size = 120 }) {
  return html`<svg class="drawing" width=${size} height=${size} ...${svgAttrs}>
    <rect x="40" y="30" width="120" height="140" rx="6" fill="var(--cup)" />
    <line x1="40" y1="62" x2="160" y2="62" /><line x1="40" y1="94" x2="160" y2="94" /><line x1="40" y1="126" x2="160" y2="126" />
    <line x1="80" y1="30" x2="80" y2="170" />
    <rect x="44" y="34" width="32" height="24" fill="currentColor" stroke="none" />
    <line x1="92" y1="70" x2="92" y2="88" /><line x1="102" y1="70" x2="102" y2="88" /><line x1="112" y1="70" x2="112" y2="88" />
    <line x1="122" y1="70" x2="122" y2="88" /><line x1="86" y1="86" x2="130" y2="72" />
  </svg>`;
}

/** A week calendar with one day circled. */
export function WeekCalendar({ size = 120 }) {
  return html`<svg class="drawing" width=${size} height=${size} ...${svgAttrs}>
    <rect x="30" y="44" width="140" height="120" rx="8" fill="var(--cup)" />
    <rect x="30" y="44" width="140" height="26" rx="8" fill="currentColor" stroke="none" />
    <line x1="64" y1="34" x2="64" y2="54" /><line x1="136" y1="34" x2="136" y2="54" />
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => html`<line x1=${44 + i * 19} y1="96" x2=${50 + i * 19} y2="96" />`)}
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => html`<line x1=${44 + i * 19} y1="126" x2=${50 + i * 19} y2="126" />`)}
    <ellipse cx="104" cy="126" rx="14" ry="11" />
  </svg>`;
}
