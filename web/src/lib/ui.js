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
