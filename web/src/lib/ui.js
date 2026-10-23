// Shared UI primitives: Preact via htm, toasts, modal, formatting, data loading hook.

export {
  html, render, useState, useEffect, useMemo, useCallback, useRef, createContext, useContext,
} from "preact-htm";
import { html, useState, useEffect, useCallback } from "preact-htm";

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
export const fmtEUR = (x) => eur.format(Number(x || 0));

// ── Toasts ──
let toastListener = null;
let toastId = 0;
export function toast(message, kind = "info") {
  toastListener?.({ id: ++toastId, message: String(message), kind });
}
export function toastError(e) {
  console.error(e);
  toast(e?.message || String(e), "error");
}
export function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    toastListener = (t) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.kind === "error" ? 8000 : 4000);
    };
    return () => { toastListener = null; };
  }, []);
  return html`<div class="toasts" role="status">
    ${items.map((t) => html`<div key=${t.id} class="toast ${t.kind}">${t.message}</div>`)}
  </div>`;
}

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
