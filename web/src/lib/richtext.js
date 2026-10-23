// Small rich-text field: plain text plus a colour per piece of text.
// The value is a list of runs { text, color } (see toRuns in listgen.js).

import { html, useRef, useEffect } from "./ui.js";
import { toRuns } from "./listgen.js";

const SWATCHES = ["#000000", "#b00020", "#c75b00", "#1f7a3a", "#1f4e79", "#6b2c91", "#777777"];

const escape = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function runsToHtml(runs) {
  const body = toRuns(runs).map((r) => {
    const text = escape(r.text).replace(/\n/g, "<br>");
    return r.color ? `<span style="color:${r.color}">${text}</span>` : text;
  }).join("");
  // A trailing line break needs a second <br> to be visible in contenteditable.
  return /<br>(<\/span>)?$/.test(body) ? `${body}<br>` : body;
}

function toHex(color) {
  if (!color) return null;
  if (color.startsWith("#")) return color.length === 4 ? `#${[...color.slice(1)].map((c) => c + c).join("")}` : color;
  const m = color.match(/\d+/g);
  return m ? `#${m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}` : null;
}

/** Reads the editor's DOM back into runs. */
function domToRuns(root) {
  const runs = [];
  const walk = (node, color) => {
    for (const n of node.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) {
        runs.push({ text: n.nodeValue.replace(/ /g, " "), color });
      } else if (n.nodeName === "BR") {
        runs.push({ text: "\n", color });
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const c = toHex(n.style?.color) || toHex(n.getAttribute("color")) || color;
        const block = n.nodeName === "DIV" || n.nodeName === "P";
        if (block && runs.length && !runs[runs.length - 1].text.endsWith("\n")) runs.push({ text: "\n", color });
        walk(n, c);
      }
    }
  };
  walk(root, null);
  const out = toRuns(runs);
  // Drop the extra trailing break that contenteditable keeps at the end.
  const last = out[out.length - 1];
  if (last?.text.endsWith("\n")) last.text = last.text.slice(0, -1);
  return toRuns(out);
}

export function RichText({ value, onChange, label }) {
  const ref = useRef(null);
  const saved = useRef(null);

  // Load content on mount; the parent remounts the editor (via `key`) when a template is switched.
  useEffect(() => { ref.current.innerHTML = runsToHtml(value); }, []);

  const emit = () => onChange(domToRuns(ref.current));
  const remember = () => {
    const sel = window.getSelection();
    if (sel.rangeCount && ref.current.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
  };
  const color = (c) => {
    ref.current.focus();
    if (saved.current) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(saved.current);
    }
    document.execCommand("styleWithCSS", false, true);
    document.execCommand("foreColor", false, c);
    remember();
    emit();
  };
  const onKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); document.execCommand("insertLineBreak"); emit(); }
  };
  const onPaste = (e) => {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  };
  const keep = (e) => e.preventDefault(); // clicking a swatch must not move the selection

  return html`<div class="field">
    <span class="rt-label">${label}</span>
    <div class="rt-toolbar" role="toolbar" aria-label=${`${label}: text colour`}>
      <span class="small muted">Colour of selected text:</span>
      ${SWATCHES.map((c) => html`<button type="button" class="rt-swatch" style=${`background:${c}`} title=${c} aria-label=${`Colour ${c}`}
        onMouseDown=${keep} onClick=${() => color(c)}></button>`)}
      <label class="rt-custom" title="Other colour" onMouseDown=${remember}>
        <input type="color" aria-label="Other colour" onChange=${(e) => color(e.target.value)} />
      </label>
    </div>
    <div ref=${ref} class="rt-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label=${label}
      onInput=${emit} onKeyDown=${onKeyDown} onPaste=${onPaste} onKeyUp=${remember} onMouseUp=${remember} onBlur=${remember}></div>
  </div>`;
}
