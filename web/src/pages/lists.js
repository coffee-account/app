import { html, useState, useRef, useEffect, useLoad, Loading, Field, toast, useBusy, downloadBlob, ConfirmAction, deferDelete, usePendingDeletes } from "../lib/ui.js";
import * as api from "../lib/api.js";
import { sortPeople } from "../lib/accounting.js";
import { isoDate, addDays } from "../lib/dates.js";
import { defaultConfig, normalizeConfig, buildRows, paginate, listTitle, exportDocx, PAGE, listPeople, shadeColor, headerTintColor, runLines, runsText, cellFontSize, MIN_FIT_SIZE } from "../lib/listgen.js";
import { RichText } from "../lib/richtext.js";

export function ListsPage() {
  const [kind, setKind] = useState("coffee");
  return html`
    <div class="page-head"><div><h1>Print lists</h1>
      <p>Generated from each person's "active" switch. Adjust the layout, save it as a template, then print to PDF or export to Word.</p></div></div>
    <div class="tabs">
      <button class=${kind === "coffee" ? "active" : ""} onClick=${() => setKind("coffee")}>Coffee list</button>
      <button class=${kind === "drinks" ? "active" : ""} onClick=${() => setKind("drinks")}>Drinks list</button>
    </div>
    <${Designer} key=${kind} kind=${kind} />`;
}

function Designer({ kind }) {
  const state = useLoad(async () => {
    const [people, templates, duties] = await Promise.all([
      api.listPeople(), api.listTemplates(kind), api.listDuties(addDays(isoDate(), -60), addDays(isoDate(), 400)),
    ]);
    return { people, templates, duties };
  }, [kind]);
  return html`<${Loading} state=${state}>${(data) => html`<${DesignerBody} kind=${kind} data=${data} reload=${state.reload} />`}<//>`;
}

function DesignerBody({ kind, data, reload }) {
  const initial = data.templates.find((t) => t.is_default) || null;
  const [templateId, setTemplateId] = useState(initial?.id || "");
  const [cfg, setCfg] = useState(() => normalizeConfig(kind, initial?.config));
  const [date, setDate] = useState(isoDate());
  const [zoom, setZoom] = useState(0.7);
  const [editorKey, setEditorKey] = useState(0); // remounts the text editors when the config is replaced
  const [busy, run] = useBusy();
  const previewRef = useRef(null);

  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));
  const setIn = (key, patch) => setCfg((c) => ({ ...c, [key]: { ...c[key], ...patch } }));
  const num = (e) => Number(e.target.value);

  const { cols, rows } = buildRows(kind, data.people, cfg, data.duties, date);
  const pages = paginate(cfg, rows);
  const current = data.templates.find((t) => t.id === templateId);
  const isPending = usePendingDeletes();

  const chooseTemplate = (id) => {
    setTemplateId(id);
    const t = data.templates.find((x) => x.id === id);
    setCfg(normalizeConfig(kind, t?.config));
    setEditorKey((k) => k + 1);
  };
  const saveTemplate = (asNew) => run(async () => {
    let name = current?.name;
    if (asNew || !current) {
      name = prompt("Template name", current ? `${current.name} (copy)` : "Standard");
      if (!name) return;
    }
    const saved = await api.saveTemplate({ id: asNew ? undefined : current?.id, kind, name, config: cfg, is_default: asNew ? !data.templates.length : current?.is_default ?? !data.templates.length });
    toast(`Template "${name}" saved`);
    await reload();
    setTemplateId(saved.id);
  });
  const makeDefault = () => run(async () => { await api.makeDefaultTemplate(kind, templateId); toast("This template now opens by default"); reload(); });
  const removeTemplate = () => {
    const id = templateId;
    chooseTemplate("");
    deferDelete({ key: `template:${id}`, message: `Template "${current.name}" deleted`, commit: () => api.deleteTemplate(id), onDone: reload });
  };

  const onImage = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 400_000) { toast("Please use an image under 400 KB (e.g. a QR code)", "error"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => set({ image: { dataUrl: reader.result, widthMm: 30, heightMm: 30 * (img.height / img.width), ratio: img.height / img.width, position: "right" } });
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const print = () => {
    const root = document.createElement("div");
    root.className = "print-root";
    root.innerHTML = previewRef.current.innerHTML;
    root.querySelectorAll(".paper").forEach((p) => { p.style.zoom = ""; });
    const style = document.createElement("style");
    const [w, h] = PAGE[cfg.orientation];
    style.textContent = `@page { size: ${w}mm ${h}mm; margin: 0; }`;
    document.body.append(root, style);
    const prevTitle = document.title;
    document.title = listTitle(cfg, date);
    const cleanup = () => { root.remove(); style.remove(); document.title = prevTitle; window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup);
    window.print();
    setTimeout(cleanup, 1000);
  };
  const docx = () => run(async () => {
    const blob = await exportDocx(kind, cfg, cols, rows, date);
    downloadBlob(blob, `${cfg.title || kind} ${date}.docx`);
  });

  const flag = kind === "coffee" ? "active_coffee" : "active_drinks";
  const active = sortPeople(data.people.filter((p) => p[flag]), "group");
  const others = sortPeople(data.people.filter((p) => !p[flag]), "last");
  const excluded = new Set(cfg.excluded);
  const toggleExcluded = (id) => set({ excluded: excluded.has(id) ? cfg.excluded.filter((x) => x !== id) : [...cfg.excluded, id] });
  const rowsOf = (id) => cfg.rowsPerPerson[id] || 1;
  const setRows = (id, n) => {
    const next = { ...cfg.rowsPerPerson };
    if (n > 1) next[id] = Math.min(10, n); else delete next[id];
    set({ rowsPerPerson: next });
  };
  const rowsInput = (p) => html`<input type="number" min="1" max="10" class="rows-input" value=${rowsOf(p.id)}
    aria-label=${`Rows for ${p.first_name} ${p.last_name}`} title="Rows on the list" onInput=${(e) => setRows(p.id, Number(e.target.value))} />`;
  const printed = listPeople(kind, data.people, cfg).length;

  return html`<div class="designer">
    <div class="controls">
      <div class="card">
        <h3>Template</h3>
        <select value=${templateId} onChange=${(e) => chooseTemplate(e.target.value)}>
          <option value="">Built-in layout</option>
          ${data.templates.filter((t) => !isPending(`template:${t.id}`)).map((t) => html`<option value=${t.id}>${t.name}${t.is_default ? " (default)" : ""}</option>`)}
        </select>
        <div class="row" style="margin-top:8px">
          ${current && html`<button class="btn small" disabled=${busy} onClick=${() => saveTemplate(false)}>Save</button>`}
          <button class="btn small" disabled=${busy} onClick=${() => saveTemplate(true)}>Save as new…</button>
          ${current && !current.is_default && html`<button class="btn small" disabled=${busy} onClick=${makeDefault}>Make default</button>`}
          ${current && html`<${ConfirmAction} question=${`Delete "${current.name}"?`} disabled=${busy} onConfirm=${removeTemplate} />`}
          <button class="btn small ghost" onClick=${() => { set(defaultConfig(kind)); setEditorKey((k) => k + 1); }}>Reset layout</button>
        </div>
      </div>

      <div class="card">
        <h3>Export</h3>
        <${Field} label="List date (printed in the header and used for duty weeks)"><input type="date" value=${date} onInput=${(e) => setDate(e.target.value)} /><//>
        <div class="row" style="margin-top:10px">
          <button class="btn primary" onClick=${print}>Print / save as PDF</button>
          <button class="btn" disabled=${busy} onClick=${docx}>Word (.docx)</button>
        </div>
        <label class="check" style="margin-top:10px"><input type="checkbox" checked=${cfg.wordArial} onChange=${(e) => set({ wordArial: e.target.checked })} />
          Use Arial in the Word file</label>
        <p class="small muted" style="margin:4px 0 0">The Word file uses Fraunces, Newsreader and Schibsted Grotesk. Word shows other fonts where these aren't installed; they're free from Google Fonts.</p>
        <p class="small muted" style="margin:8px 0 0">${printed} people + ${cfg.blankRows} empty rows · ${pages.length} page${pages.length > 1 ? "s" : ""}.
          In the print dialog choose "Save as PDF" and turn off headers/footers.</p>
      </div>

      <div class="card">
        <h3>Text</h3>
        <div class="grid">
          <div class="form-grid">
            <${Field} label="Title"><input value=${cfg.title} onInput=${(e) => set({ title: e.target.value })} /><//>
            <${Field} label="Size (pt)"><input type="number" min="8" max="40" value=${cfg.titleSize} onInput=${(e) => set({ titleSize: num(e) })} /><//>
          </div>
          <div class="form-grid">
            <${Field} label="Date"><select value=${cfg.datePosition} onChange=${(e) => set({ datePosition: e.target.value })}>
              <option value="header">Top right of every page</option><option value="title">After the title</option><option value="none">Don't print</option></select><//>
            ${cfg.datePosition === "header" && html`<${Field} label="Date size (pt)"><input type="number" min="6" max="20" value=${cfg.dateSize} onInput=${(e) => set({ dateSize: num(e) })} /><//>`}
          </div>
          <${RichText} key=${`intro${editorKey}`} label="Text below the title" value=${cfg.intro} onChange=${(intro) => set({ intro })} />
          <${TextStyle} cfg=${cfg} set=${set} prefix="intro" />
          <${RichText} key=${`footer${editorKey}`} label="Footer (every page)" value=${cfg.footer} onChange=${(footer) => set({ footer })} />
          <${TextStyle} cfg=${cfg} set=${set} prefix="footer" />
        </div>
      </div>

      <div class="card">
        <h3>Table</h3>
        <div class="form-grid">
          <${Field} label="Sort by"><select value=${cfg.sortBy} onChange=${(e) => set({ sortBy: e.target.value })}>
            <option value="group">Group, then last name</option><option value="last">Last name</option><option value="first">First name</option></select><//>
          <${Field} label="Empty rows at the end"><input type="number" min="0" max="80" value=${cfg.blankRows} onInput=${(e) => set({ blankRows: num(e) })} /><//>
          <${Field} label="Font size (pt)"><input type="number" min="6" max="16" value=${cfg.fontSize} onInput=${(e) => set({ fontSize: num(e) })} /><//>
          <${Field} label="Header size (pt)"><input type="number" min="6" max="18" value=${cfg.headerSize} onInput=${(e) => set({ headerSize: num(e) })} /><//>
          <${Field} label="Row height (mm)"><input type="number" min="4" max="15" step="0.1" value=${cfg.rowHeight} onInput=${(e) => set({ rowHeight: num(e) })} /><//>
        </div>
        <div class="row" style="margin:10px 0">
          <label class="check"><input type="checkbox" checked=${cfg.showGroup} onChange=${(e) => set({ showGroup: e.target.checked })} /> Group column</label>
          <label class="check"><input type="checkbox" checked=${cfg.fiveLines} onChange=${(e) => set({ fiveLines: e.target.checked })} /> Heavier line after every 5 people</label>
          <label class="check" title="Long names and duty dates get a smaller font instead of being cut off"><input type="checkbox" checked=${cfg.fitText}
            onChange=${(e) => set({ fitText: e.target.checked })} /> Shrink text to fit its box</label>
        </div>
        <div class="form-grid" style="margin-bottom:10px">
          <${Field} label="Header row grey (%)"><input type="number" min="0" max="30" value=${cfg.headerTint} onInput=${(e) => set({ headerTint: num(e) })} /><//>
        </div>
        <div class="form-grid" style="margin-bottom:10px">
          <${Field} label="Background"><select value=${cfg.shading} onChange=${(e) => set({ shading: e.target.value })}>
            <option value="none">All white</option><option value="groups">Alternate per group</option><option value="people">Alternate per person</option></select><//>
          ${cfg.shading !== "none" && html`<${Field} label=${`Grey level: ${cfg.shadeLevel}%`}>
            <div class="row" style="flex-wrap:nowrap">
              <input type="range" min="2" max="40" value=${cfg.shadeLevel} style="flex:1" onInput=${(e) => set({ shadeLevel: num(e) })} />
              <span class="swatch" style=${`background:${shadeColor(cfg)}`}></span></div><//>`}
        </div>
        <div class="form-grid">
          <${Field} label="Last name width (mm)"><input type="number" min="10" value=${cfg.nameWidths.last} onInput=${(e) => setIn("nameWidths", { last: num(e) })} /><//>
          <${Field} label="First name width (mm)"><input type="number" min="10" value=${cfg.nameWidths.first} onInput=${(e) => setIn("nameWidths", { first: num(e) })} /><//>
          ${cfg.showGroup && html`<${Field} label="Group width (mm)"><input type="number" min="10" value=${cfg.nameWidths.group} onInput=${(e) => setIn("nameWidths", { group: num(e) })} /><//>`}
        </div>
        <h3 style="margin-top:14px">Tally columns</h3>
        <div class="form-grid">
          <${Field} label="Count"><input type="number" min="0" max="30" value=${cfg.tally.count} onInput=${(e) => setIn("tally", { count: num(e) })} /><//>
          <${Field} label="First label"><input type="number" value=${cfg.tally.start} onInput=${(e) => setIn("tally", { start: num(e) })} /><//>
          <${Field} label="Step"><input type="number" value=${cfg.tally.step} onInput=${(e) => setIn("tally", { step: num(e) })} /><//>
          <${Field} label="Width (mm, 0 = fill)"><input type="number" min="0" step="0.5" value=${cfg.tally.width} onInput=${(e) => setIn("tally", { width: num(e) })} /><//>
        </div>
        <h3 style="margin-top:14px">Extra columns</h3>
        ${cfg.extraColumns.map((c, i) => html`<div class="col-editor">
          <input aria-label="Column label" value=${c.label} onInput=${(e) => set({ extraColumns: cfg.extraColumns.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
          <input aria-label="Width in mm" type="number" min="5" value=${c.width} onInput=${(e) => set({ extraColumns: cfg.extraColumns.map((x, j) => (j === i ? { ...x, width: num(e) } : x)) })} />
          <button class="btn small danger" aria-label="Remove column" onClick=${() => set({ extraColumns: cfg.extraColumns.filter((_, j) => j !== i) })}>×</button>
          <label class="check small" style="grid-column:1/-1"><input type="checkbox" checked=${c.fill === "duties"}
            onChange=${(e) => set({ extraColumns: cfg.extraColumns.map((x, j) => (j === i ? { ...x, fill: e.target.checked ? "duties" : "blank" } : x)) })} />
            Fill in assigned kitchen-duty weeks</label>
        </div>`)}
        <button class="btn small" onClick=${() => set({ extraColumns: [...cfg.extraColumns, { label: "Notes", width: 20, fill: "blank" }] })}>+ Add column</button>
      </div>

      <div class="card">
        <h3>Page</h3>
        <div class="form-grid">
          <${Field} label="Orientation"><select value=${cfg.orientation} onChange=${(e) => set({ orientation: e.target.value })}>
            <option value="portrait">A4 portrait</option><option value="landscape">A4 landscape</option></select><//>
          <${Field} label="Top margin (mm)"><input type="number" min="0" value=${cfg.margins.top} onInput=${(e) => setIn("margins", { top: num(e) })} /><//>
          <${Field} label="Side margins (mm)"><input type="number" min="0" value=${cfg.margins.side} onInput=${(e) => setIn("margins", { side: num(e) })} /><//>
          <${Field} label="Bottom margin (mm)"><input type="number" min="0" value=${cfg.margins.bottom} onInput=${(e) => setIn("margins", { bottom: num(e) })} /><//>
        </div>
        <h3 style="margin-top:14px">Image (e.g. QR code)</h3>
        ${cfg.image ? html`<div class="form-grid">
            <${Field} label="Width (mm)"><input type="number" min="5" max="120" value=${cfg.image.widthMm}
              onInput=${(e) => set({ image: { ...cfg.image, widthMm: num(e), heightMm: num(e) * (cfg.image.ratio || 1) } })} /><//>
            <${Field} label="Position"><select value=${cfg.image.position} onChange=${(e) => set({ image: { ...cfg.image, position: e.target.value } })}>
              <option value="right">Top right</option><option value="left">Top left</option></select><//>
          </div>
          <button class="btn small danger" style="margin-top:8px" onClick=${() => set({ image: null })}>Remove image</button>`
          : html`<input type="file" accept="image/png,image/jpeg" onChange=${onImage} />`}
      </div>

      <div class="card">
        <h3>People on this list</h3>
        <p class="small muted">Everyone switched to active for ${kind} (change that under People). Untick to leave someone off just this list layout;
          the number sets how many rows they get.</p>
        <div class="people-pick">
          ${active.map((p) => html`<div class="person-pick"><label class="check"><input type="checkbox" checked=${!excluded.has(p.id)} onChange=${() => toggleExcluded(p.id)} />
            ${p.last_name}, ${p.first_name} <span class="muted small">${p.group_name || ""}</span></label>
            ${!excluded.has(p.id) && rowsInput(p)}</div>`)}
        </div>
        <${Field} label="Also print (not active)">
          <select onChange=${(e) => { if (e.target.value) { set({ included: [...cfg.included, e.target.value] }); e.target.value = ""; } }}>
            <option value="">+ Add person…</option>
            ${others.filter((p) => !cfg.included.includes(p.id)).map((p) => html`<option value=${p.id}>${p.last_name}, ${p.first_name}</option>`)}
          </select><//>
        ${cfg.included.map((id) => {
          const p = data.people.find((x) => x.id === id);
          return p && html`<div class="person-pick"><span class="chip">${p.first_name} ${p.last_name}<button aria-label="Remove" onClick=${() => set({ included: cfg.included.filter((x) => x !== id) })}>×</button></span>
            ${rowsInput(p)}</div>`;
        })}
        <p class="small muted" style="margin:8px 0 0">${printed} people printed.</p>
      </div>
    </div>

    <div>
      <div class="row" style="margin-bottom:8px"><span class="small muted">Preview</span><span class="spacer"></span>
        <select style="max-width:110px" value=${zoom} onChange=${(e) => setZoom(Number(e.target.value))} aria-label="Zoom">
          ${[0.5, 0.7, 0.85, 1].map((z) => html`<option value=${z}>${Math.round(z * 100)}%</option>`)}</select></div>
      <div class="preview-scroll"><div ref=${previewRef}>
        ${pages.map((pageRows, i) => html`<${Paper} cfg=${cfg} cols=${cols} rows=${pageRows} first=${i === 0} date=${date} zoom=${zoom} />`)}
      </div></div>
    </div>
  </div>`;
}

function TextStyle({ cfg, set, prefix }) {
  const k = (name) => `${prefix}${name}`;
  return html`<div class="form-grid text-style">
    <${Field} label="Size (pt)"><input type="number" min="6" max="20" value=${cfg[k("Size")]} onInput=${(e) => set({ [k("Size")]: Number(e.target.value) })} /><//>
    <${Field} label="Alignment"><select value=${cfg[k("Align")]} onChange=${(e) => set({ [k("Align")]: e.target.value })}>
      <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select><//>
  </div>`;
}

function Paper({ cfg, cols, rows, first, date, zoom }) {
  const table = useRef(null);
  // Safety net for "fit text": any cell still wider than its box gets smaller in half points until it fits.
  useEffect(() => {
    if (!cfg.fitText || !table.current) return;
    for (const td of table.current.querySelectorAll("tbody td[data-size]")) {
      let size = Number(td.dataset.size);
      td.style.fontSize = `${size}pt`;
      while (td.scrollWidth > td.clientWidth && size > MIN_FIT_SIZE) {
        size -= 0.5;
        td.style.fontSize = `${size}pt`;
      }
    }
  });
  const [w, h] = PAGE[cfg.orientation];
  const m = cfg.margins;
  const shade = shadeColor(cfg);
  const title = listTitle(cfg, date);
  return html`<div class="paper" style=${`width:${w}mm;height:${h}mm;padding:${m.top}mm ${m.side}mm ${m.bottom}mm;zoom:${zoom}`}>
    ${cfg.datePosition === "header" && date && html`<div class="list-date" style=${`font-size:${cfg.dateSize}pt;top:${Math.max(3, m.top / 2 - 2)}mm;right:${m.side}mm`}>${date}</div>`}
    ${first && cfg.image && html`<img class="list-image" src=${cfg.image.dataUrl} alt=""
      style=${`width:${cfg.image.widthMm}mm;top:${m.top}mm;${cfg.image.position === "left" ? "left" : "right"}:${m.side}mm`} />`}
    ${first && title && html`<div class="list-title" style=${`font-size:${cfg.titleSize}pt`}>${title}</div>`}
    ${first && runsText(cfg.intro) && html`<div class="list-intro" style=${`font-size:${cfg.introSize}pt;text-align:${cfg.introAlign};${cfg.image ? `margin-${cfg.image.position}:${cfg.image.widthMm + 3}mm;min-height:${Math.max(0, (cfg.image.heightMm || 0) - cfg.titleSize * 0.46)}mm` : ""}`}><${Runs} value=${cfg.intro} /></div>`}
    <table class="list" ref=${table} style=${`font-size:${cfg.fontSize}pt;width:${cols.reduce((s, c) => s + c.width, 0)}mm`}>
      <colgroup>${cols.map((c) => html`<col style=${`width:${c.width}mm`} />`)}</colgroup>
      <thead><tr style=${`height:${cfg.rowHeight}mm`}>${cols.map((c) => html`<th class=${c.tally ? "tally" : ""}
        style=${`font-size:${cfg.headerSize}pt${Number(cfg.headerTint) > 0 ? `;background:${headerTintColor(cfg)}` : ""}`}>${c.label}</th>`)}</tr></thead>
      <tbody>${rows.map((r, i) => {
        const blockFive = r.span > 1 && rows[i + r.span - 1]?.fiveEnd; // merged cells end on the block's last row
        return html`<tr class=${r.fiveEnd ? "five" : ""} style=${`height:${cfg.rowHeight}mm${r.band ? `;background:${shade}` : ""}`}>
        ${r.cells.map((v, j) => {
          if (v === null) return null;
          const merged = !cols[j].tally && r.span > 1;
          const duty = cols[j].fill === "duties";
          const size = cols[j].tally ? null : cellFontSize(cfg, cols[j], v, merged ? r.span : 1);
          return html`<td rowspan=${merged ? r.span : undefined} class="${merged && blockFive ? "five" : ""} ${duty ? "duty" : ""}"
            data-size=${size && v ? size : undefined} style=${size ? `font-size:${size}pt` : undefined}>${v}</td>`;
        })}</tr>`;
      })}</tbody>
    </table>
    ${runsText(cfg.footer) && html`<div class="list-footer" style=${`font-size:${cfg.footerSize}pt;text-align:${cfg.footerAlign};bottom:${Math.max(3, m.bottom / 2)}mm;padding:0 ${m.side}mm`}><${Runs} value=${cfg.footer} /></div>`}
  </div>`;
}

function Runs({ value }) {
  return runLines(value).map((line) => html`<div class="list-line">${line.length
    ? line.map((r) => (r.color ? html`<span style=${`color:${r.color}`}>${r.text}</span>` : r.text))
    : "\u00a0"}</div>`);
}
