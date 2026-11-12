// Shared UI primitives: Preact via htm, toasts, modal, formatting, data loading hook.

export {
  html, render, useState, useEffect, useMemo, useCallback, useRef, createContext, useContext,
} from "preact-htm";
import { html, useState, useEffect, useLayoutEffect, useCallback, useRef } from "preact-htm";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
export const fmtEUR = (x) => eur.format(Number(x || 0));

// ── Toasts ──
let toastListener = null;
let dismissListener = null;
let toastId = 0;
/** Shows a message. `action`: optional { label, onClick } button, e.g. Undo. */
export function toast(message, kind = "info", action = null, duration = null) {
  const id = ++toastId;
  toastListener?.({ id, message: String(message), kind, action, duration: duration ?? (kind === "error" || action ? 8000 : 4000) });
  return id;
}
export function toastError(e) {
  console.error(e);
  toast(e?.message || String(e), "error");
}
export function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const drop = (id) => setItems((xs) => xs.filter((x) => x.id !== id));
    toastListener = (t) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => drop(t.id), t.duration);
    };
    dismissListener = drop;
    return () => { toastListener = null; dismissListener = null; };
  }, []);
  return html`<div class="toasts" role="status">
    ${items.map((t) => html`<div key=${t.id} class="toast ${t.kind}">
      <span>${t.message}</span>
      ${t.action && html`<button class="toast-action" onClick=${() => { dismissListener?.(t.id); t.action.onClick(); }}>${t.action.label}</button>`}
    </div>`)}
  </div>`;
}

// ── Deletes with Undo ──
// The item disappears at once; the real deletion runs when the Undo window ends.
const UNDO_MS = 8000;
const pending = new Map(); // key → { timer, run }
const pendingListeners = new Set();
const notifyPending = () => pendingListeners.forEach((fn) => fn());

/** Returns isPending(key) and re-renders the caller when pending deletes change. */
export function usePendingDeletes() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    pendingListeners.add(fn);
    return () => pendingListeners.delete(fn);
  }, []);
  return (key) => pending.has(key);
}

/**
 * key: unique id such as "payment:<id>"; message: toast text ("Payment deleted");
 * commit: async function doing the real deletion; onDone: called after commit (e.g. reload).
 */
export function deferDelete({ key, message, commit, onDone }) {
  const run = async () => {
    if (!pending.has(key)) return;
    pending.delete(key);
    try { await commit(); } catch (e) { toastError(e); }
    notifyPending();
    onDone?.();
  };
  const timer = setTimeout(run, UNDO_MS);
  pending.set(key, { timer, run });
  notifyPending();
  toast(message, "info", {
    label: "Undo",
    onClick: () => {
      clearTimeout(timer);
      pending.delete(key);
      notifyPending();
      toast("Restored");
    },
  }, UNDO_MS);
}

// Leaving the page ends the Undo window: carry out what is still pending.
window.addEventListener("pagehide", () => {
  for (const p of [...pending.values()]) { clearTimeout(p.timer); p.run(); }
});

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return html`<div class="modal-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose?.()}>
    <div class="modal" style=${wide ? "width:min(900px,100%)" : ""} role="dialog" aria-modal="true">
      <div class="row"><h2>${title}</h2><span class="spacer"></span>
        ${onClose && html`<button class="icon-btn" aria-label="Close" onClick=${onClose}>×</button>`}</div>
      ${children}
    </div>
  </div>`;
}

/** Runs an async loader; returns { data, error, loading, reload }. */
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ data: await loader(), error: null, loading: false });
    } catch (error) {
      console.error(error);
      setState({ data: null, error, loading: false });
    }
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

export function Loading({ state, children }) {
  if (state.error) return html`<div class="notice bad">Could not load: ${state.error.message || String(state.error)}</div>`;
  if (state.loading && !state.data) return html`<p class="muted">Loading…</p>`;
  return children(state.data);
}

export function Field({ label, children, hint }) {
  return html`<label class="field"><span>${label}</span>${children}${hint && html`<small class="muted">${hint}</small>`}</label>`;
}

/** Wraps an async click handler with a busy flag and error toast. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn) => {
    setBusy(true);
    try { return await fn(); } catch (e) { toastError(e); } finally { setBusy(false); }
  }, []);
  return [busy, run];
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

export async function loadExcelJS() {
  await loadScript("https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js");
  return window.ExcelJS;
}

/**
 * Destructive action confirmed in place: a quiet text button; the question
 * "Question? [Action] [Cancel]" floats over the row so the table keeps its layout.
 * `actions` overrides the single default action.
 */
export function ConfirmAction({ label = "Delete", question, onConfirm, actions, disabled, align = "right", ariaLabel }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const pop = useRef(null);
  // Keep the question inside its frame (table, card or dialog): shift it sideways, wrap if needed.
  useLayoutEffect(() => {
    if (open && pop.current) fitInside(pop.current, anchor.current);
  }, [open]);
  useEffect(() => {
    const row = anchor.current?.closest("tr");
    row?.classList.toggle("confirming", open); // tint the row while asking
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); row?.classList.remove("confirming"); };
  }, [open]);
  const list = actions || [{ label, onClick: onConfirm, danger: true }];
  return html`<span class="confirm-anchor" ref=${anchor}>
    <button type="button" class="btn-text" disabled=${disabled} aria-expanded=${open} aria-label=${ariaLabel} onClick=${() => setOpen(!open)}>${label}</button>
    ${open && html`<span class="confirm-pop ${align}" ref=${pop} role="group" aria-label=${question}>
      <span>${question}</span>
      ${list.map((a) => html`<button type="button" class="btn-text ${a.danger ? "danger" : ""}" disabled=${disabled}
        onClick=${() => { setOpen(false); a.onClick(); }}>${a.label}</button>`)}
      <button type="button" class="btn-text" onClick=${() => setOpen(false)}>Cancel</button>
    </span>`}
  </span>`;
}

/** Positions an absolutely placed popover so it stays within the nearest frame and the window. */
function fitInside(el, anchorEl) {
  const frame = anchorEl.closest(".table-wrap, .card, .modal, main") || document.body;
  const f = frame.getBoundingClientRect();
  const left = Math.max(f.left, 0) + 8;
  const right = Math.min(f.right, window.innerWidth) - 8;
  const a = anchorEl.getBoundingClientRect();
  const room = Math.max(160, right - left);
  // An absolute box is only as wide as its small anchor unless told otherwise: use its natural width,
  // and wrap onto more lines only when that doesn't fit in the frame.
  el.style.width = "max-content";
  el.style.whiteSpace = "nowrap";
  if (el.getBoundingClientRect().width > room) {
    el.style.width = `${room}px`;
    el.style.whiteSpace = "normal";
  }
  let r = el.getBoundingClientRect();
  let x = r.left;
  if (r.right > right) x -= r.right - right;
  if (x < left) x = left;
  el.style.left = `${x - a.left}px`;
  el.style.right = "auto";
  r = el.getBoundingClientRect();
  const bottom = Math.min(f.bottom, window.innerHeight) - 4;
  const top = Math.max(f.top, 0) + 4;
  if (r.bottom > bottom) el.style.top = `${parseFloat(getComputedStyle(el).top) - (r.bottom - bottom)}px`;
  else if (r.top < top) el.style.top = `${parseFloat(getComputedStyle(el).top) + (top - r.top)}px`;
}

/** The page's open tab, which a link can choose (#/duties?tab=rounds), e.g. from the tour. */
export function useLinkTab(initial) {
  const fromLink = () => new URLSearchParams(location.hash.split("?")[1] || "").get("tab");
  const [tab, setTab] = useState(() => fromLink() || initial);
  useEffect(() => {
    const on = () => { const t = fromLink(); if (t) setTab(t); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [tab, setTab];
}

/** useState that remembers its value in this browser (sort order, filters). */
export function usePersisted(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(`pc:${key}`);
      return raw == null ? initial : JSON.parse(raw);
    } catch { return initial; }
  });
  const set = useCallback((v) => {
    setValue((old) => {
      const next = typeof v === "function" ? v(old) : v;
      try { localStorage.setItem(`pc:${key}`, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, [key]);
  return [value, set];
}

// ── Searchable pick list ──
const fold = (s) => String(s || "").toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * A text box that searches a list, with the whole list showing underneath while you type.
 * options: [{ value, label, sub? }]; arrow keys and Enter pick, Escape closes.
 */
export function SearchSelect({ options, value, onChange, placeholder = "Search…", ariaLabel, required }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const list = useRef(null);
  const input = useRef(null);
  const chosen = options.find((o) => o.value === value);
  const words = fold(q).split(/[\s,]+/).filter(Boolean);
  const shown = words.length ? options.filter((o) => { const t = fold(`${o.label} ${o.sub || ""}`); return words.every((w) => t.includes(w)); }) : options;
  const pick = (o) => { onChange(o.value); setQ(""); setOpen(false); };
  useEffect(() => { setHi(q ? 0 : Math.max(0, shown.findIndex((o) => o.value === value))); }, [q, open]);
  useEffect(() => { list.current?.children[hi]?.scrollIntoView({ block: "nearest" }); }, [hi, open]);
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) setOpen(true); else setHi((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && open) { e.preventDefault(); if (shown[hi]) pick(shown[hi]); }
    else if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); setQ(""); }
  };
  return html`<div class="search-select ${open ? "open" : ""}">
    <input ref=${input} role="combobox" aria-expanded=${open} aria-autocomplete="list" aria-label=${ariaLabel} autocomplete="off"
      required=${required && !value} placeholder=${chosen ? "" : placeholder}
      value=${open ? q : chosen?.label || ""}
      onFocus=${() => setOpen(true)} onMouseDown=${() => setOpen(true)} onBlur=${() => { setOpen(false); setQ(""); }}
      onInput=${(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown=${onKey} />
    ${open && chosen && !q && html`<span class="search-select-current">${chosen.label}</span>`}
    <button type="button" class="search-select-toggle" tabindex="-1" aria-label="Show the list"
      onMouseDown=${(e) => { e.preventDefault(); if (open) setOpen(false); else input.current?.focus(); setOpen(!open); }}>▾</button>
    ${open && html`<ul class="search-select-list" role="listbox" ref=${list}>
      ${shown.length ? shown.map((o, i) => html`<li role="option" aria-selected=${o.value === value} class=${`${i === hi ? "hi" : ""} ${o.value === value ? "chosen" : ""}`}
          onMouseDown=${(e) => { e.preventDefault(); pick(o); }} onMouseEnter=${() => setHi(i)}>
          <span>${o.label}</span>${o.sub && html`<small>${o.sub}</small>`}</li>`)
        : html`<li class="empty">No match</li>`}
    </ul>`}
  </div>`;
}

// ── Links in Markdown texts ──
/** "name@example.org" → mailto:, "www.…" → https://; spaces in the address are encoded. */
export function linkTarget(raw) {
  let u = String(raw || "").trim();
  if (!u) return "";
  if (/^mailto:/i.test(u)) u = `mailto:${u.slice(7)}`;
  else if (/^[^\s/:@]+@[^\s/:@]+\.[^\s/:@]+(\?.*)?$/.test(u)) u = `mailto:${u}`;
  else if (!/^https?:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, "")}`;
  return u.replace(/ /g, "%20").replace(/\)/g, "%29");
}

/**
 * "Insert link" for a Markdown textarea: asks for the text and a web or e-mail address and writes [text](address)
 * at the cursor (around the selected text, if any). `textarea` is a ref; `onInsert` gets the new full text.
 */
export function LinkInserter({ textarea, onInsert }) {
  const [form, setForm] = useState(null); // null | { text, url, start, end }
  const first = useRef(null);
  const second = useRef(null);
  const opened = !!form;
  useEffect(() => { if (opened) (form.text ? second : first).current?.focus(); }, [opened]);
  const begin = () => {
    const t = textarea.current;
    const start = t?.selectionStart ?? t?.value.length ?? 0;
    const end = t?.selectionEnd ?? start;
    const text = t ? t.value.slice(start, end) : "";
    setForm(/@|^https?:|^www\./.test(text.trim()) ? { text: "", url: text.trim(), start, end } : { text, url: "", start, end });
  };
  const insert = () => {
    const t = textarea.current;
    const url = linkTarget(form.url);
    if (!url || !t) return;
    const label = form.text.trim().replace(/[[\]]/g, "") || form.url.trim().replace(/^mailto:/i, "");
    const before = t.value.slice(0, form.start);
    const md = `${before && !/\s$/.test(before) && form.start === form.end ? " " : ""}[${label}](${url})`;
    const next = t.value.slice(0, form.start) + md + t.value.slice(form.end);
    onInsert(next);
    setForm(null);
    setTimeout(() => { t.focus(); t.setSelectionRange(form.start + md.length, form.start + md.length); }, 0);
  };
  if (!form) {
    return html`<div class="md-toolbar"><button type="button" class="btn small" onMouseDown=${(e) => e.preventDefault()} onClick=${begin}>Insert link…</button>
      <span class="small muted">Web page or e-mail address; select text first to turn it into the link.</span></div>`;
  }
  const onKey = (e) => { if (e.key === "Enter") { e.preventDefault(); insert(); } if (e.key === "Escape") { e.stopPropagation(); setForm(null); } };
  return html`<div class="md-toolbar link-form">
    <input aria-label="Link text" placeholder="Text to show, e.g. Write to us" value=${form.text} ref=${first} onInput=${(e) => { const text = e.target.value; setForm((f) => ({ ...f, text })); }} onKeyDown=${onKey} />
    <input aria-label="Web or e-mail address" placeholder="https://… or name@example.org" value=${form.url} ref=${second}
      onInput=${(e) => { const url = e.target.value; setForm((f) => ({ ...f, url })); }} onKeyDown=${onKey} />
    <button type="button" class="btn small primary" disabled=${!form.url.trim()} onClick=${insert}>Insert</button>
    <button type="button" class="btn-text" onClick=${() => setForm(null)}>Cancel</button>
    ${form.url.trim() && html`<span class="small muted" style="flex-basis:100%">Links to ${linkTarget(form.url)}</span>`}
  </div>`;
}
