// Minimal, safe Markdown for the info page and updates:
// "## Heading", "### Heading", "- item", "1. item", blank-line paragraphs, **bold**, *italic*,
// [text](https://… or mailto:…), bare e-mail addresses and URLs. All other HTML is escaped.

const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const emphasis = (s) => s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");

function inline(text) {
  // Finished links are set aside, so an address inside a link's text or target isn't linked a second time.
  const links = [];
  const keep = (h) => `\u0003${links.push(h) - 1}\u0004`;
  let s = escape(text);
  s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, (_, t, u) => keep(`<a href="${u}"${u.startsWith("mailto:") ? "" : ' target="_blank" rel="noopener"'}>${emphasis(t)}</a>`));
  s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, (_, pre, u) => pre + keep(`<a href="${u}" target="_blank" rel="noopener">${u}</a>`));
  s = s.replace(/(^|[\s(])([\w.+-]+@[\w-]+\.[\w.-]+\w)/g, (_, pre, e) => pre + keep(`<a href="mailto:${e}">${e}</a>`));
  // eslint-disable-next-line no-control-regex
  return emphasis(s).replace(/\u0003(\d+)\u0004/g, (_, i) => links[i]);
}

/** Returns HTML for the given Markdown text; `vars` replaces {placeholders}. `breaks`: a single line break stays one (as in e-mails). */
export function markdown(src, vars = {}, { breaks = false } = {}) {
  const text = String(src || "").replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${breaks ? para.map(inline).join("<br>") : inline(para.join(" "))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{2,3})\s+(.*)$/))) {
      flushPara(); flushList();
      out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`);
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      const tag = /^\s*\d/.test(line) ? "ol" : "ul";
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(m[1]);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out.join("\n");
}
