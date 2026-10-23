// Printable coffee / drinks lists: configuration, row building, pagination and .docx export.

import { sortPeople } from "./accounting.js";
import { isoWeek, isoDate } from "./dates.js";

export const PAGE = { portrait: [210, 297], landscape: [297, 210] }; // mm

export function defaultConfig(kind) {
  const base = {
    title: kind === "coffee" ? "THE COFFEE LIST" : "THE DRINKS LIST",
    titleSize: 20,
    datePosition: "header", // "header" (top right of every page) | "title" | "none"
    dateSize: 10,
    // Rich text: a list of runs { text, color } — color null means black. "\n" starts a new line.
    intro: toRuns(kind === "coffee"
      ? "If you want to sign up for coffee, you first need to transfer a starting credit of 20 euro to the PayPal account: ecker@cs.uni-goettingen.de\nYou also need to undertake kitchen duties (see rules on the left)."
      : "If you want to sign up for drinks, you first need to transfer a starting credit of 20 euro to the PayPal account: ecker@cs.uni-goettingen.de"),
    introSize: 10,
    introAlign: "left",
    footer: toRuns(kind === "coffee"
      ? "Please put a mark for every drink. One coffee costs 40 ct.\nPlease only put 5 marks per cell to facilitate counting. Thank you!"
      : "Please put a mark for every drink. One drink costs 1€.\nPlease put only 5 marks per cell to facilitate counting and write new entries readable! Thank you!"),
    footerSize: 9,
    footerAlign: "center",
    orientation: "portrait",
    margins: { top: 12, side: 8, bottom: 10 },
    fontSize: 10,
    headerSize: 12,
    rowHeight: 5.8,
    sortBy: "group",
    showGroup: true,
    shading: "none", // "none" | "people" (alternate people) | "groups" (alternate groups)
    shadeLevel: 12, // % grey of the shaded band
    nameWidths: { last: 34, first: 22, group: 26 },
    tally: { start: 5, step: 5, count: 12, width: 0 },
    extraColumns: kind === "coffee" ? [{ label: "Kitchen duties", width: 20, fill: "blank" }] : [],
    blankRows: 8,
    excluded: [],
    included: [],
    rowsPerPerson: {}, // personId → number of rows
    image: null, // { dataUrl, widthMm, position: 'left' | 'right' }
  };
  return base;
}

/** Merge a saved config over the defaults so new options get sensible values. */
export function normalizeConfig(kind, cfg) {
  const d = defaultConfig(kind);
  // Options replaced in later versions of the designer.
  const legacy = {};
  if (cfg && "showDate" in cfg && !("datePosition" in cfg)) legacy.datePosition = cfg.showDate ? "title" : "none";
  if (cfg?.zebra && !("shading" in cfg)) legacy.shading = "people";
  // Plain-text intro/footer with one paragraph colour → runs.
  if (cfg && "intro" in cfg) legacy.intro = toRuns(cfg.intro, cfg.introColor);
  if (cfg && "footer" in cfg) legacy.footer = toRuns(cfg.footer, cfg.footerColor);
  const { introColor, footerColor, ...rest } = cfg || {};
  return {
    ...d, ...rest, ...legacy,
    rowsPerPerson: cfg?.rowsPerPerson ?? {},
    margins: { ...d.margins, ...cfg?.margins },
    nameWidths: { ...d.nameWidths, ...cfg?.nameWidths },
    tally: { ...d.tally, ...cfg?.tally },
    extraColumns: cfg?.extraColumns ?? d.extraColumns,
    excluded: cfg?.excluded ?? [],
    included: cfg?.included ?? [],
  };
}

// ── Rich text (intro and footer) ──
const isDefaultColor = (c) => !c || /^#0{6}$/i.test(c) || c === "#000";

/** Accepts a plain string (older templates) or runs; returns runs with adjacent same-colour runs merged. */
export function toRuns(value, color = null) {
  const runs = Array.isArray(value) ? value : value ? [{ text: String(value), color }] : [];
  const out = [];
  for (const r of runs) {
    if (!r?.text) continue;
    const c = isDefaultColor(r.color) ? null : r.color.toLowerCase();
    const last = out[out.length - 1];
    if (last && last.color === c) last.text += r.text;
    else out.push({ text: r.text, color: c });
  }
  return out;
}

export const runsText = (runs) => toRuns(runs).map((r) => r.text).join("");

/** Runs split into lines: [[{ text, color }, …], …] */
export function runLines(runs) {
  const lines = [[]];
  for (const r of toRuns(runs)) {
    r.text.split("\n").forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, color: r.color });
    });
  }
  return lines;
}

/** People printed on the list: active for this kind, minus exclusions, plus manual additions. */
export function listPeople(kind, people, cfg) {
  const flag = kind === "coffee" ? "active_coffee" : "active_drinks";
  const ex = new Set(cfg.excluded);
  const inc = new Set(cfg.included);
  return sortPeople(people.filter((p) => (p[flag] && !ex.has(p.id)) || inc.has(p.id)), cfg.sortBy);
}

/** Column layout in mm. Tally columns share the width that is left over. */
export function columns(cfg) {
  const [pageW] = PAGE[cfg.orientation];
  const usable = pageW - 2 * cfg.margins.side;
  const cols = [
    { key: "last", label: "Last name", width: cfg.nameWidths.last },
    { key: "first", label: "First name", width: cfg.nameWidths.first },
  ];
  if (cfg.showGroup) cols.push({ key: "group", label: "Group", width: cfg.nameWidths.group });
  const extras = cfg.extraColumns.map((c, i) => ({ key: `extra${i}`, label: c.label, width: Number(c.width) || 20, fill: c.fill }));
  const fixed = [...cols, ...extras].reduce((s, c) => s + c.width, 0);
  const n = Math.max(0, Number(cfg.tally.count) || 0);
  const tallyW = Number(cfg.tally.width) || (n ? Math.max(4, (usable - fixed) / n) : 0);
  const tallies = Array.from({ length: n }, (_, i) => ({
    key: `t${i}`, label: String(Number(cfg.tally.start) + i * Number(cfg.tally.step)), width: tallyW, tally: true,
  }));
  return [...cols, ...tallies, ...extras];
}

/** Text for the "duties" extra column: the weeks a person is assigned from `fromDate` on. */
function dutyText(personId, duties, fromDate) {
  return duties.filter((d) => d.person_id === personId && d.week_start >= fromDate)
    .map((d) => `W${isoWeek(d.week_start)}`).slice(0, 4).join(", ");
}

/**
 * Table rows. A person may span several rows: their name/group/extra cells are on the first row
 * (`span` rows high) and continuation rows (`cont`) only have tally cells.
 * `band` is 1 for shaded rows, 0 otherwise.
 */
export function buildRows(kind, people, cfg, duties = [], fromDate = isoDate()) {
  const cols = columns(cfg);
  const rows = [];
  let band = 1;
  let lastGroup;
  const value = (p, c) => {
    if (c.key === "last") return p.last_name;
    if (c.key === "first") return p.first_name;
    if (c.key === "group") return p.group_name || "";
    if (c.fill === "duties") return dutyText(p.id, duties, fromDate);
    return "";
  };
  for (const p of listPeople(kind, people, cfg)) {
    if (cfg.shading === "people" || (cfg.shading === "groups" && p.group_name !== lastGroup)) band = 1 - band;
    lastGroup = p.group_name;
    const span = Math.max(1, Math.min(10, Number(cfg.rowsPerPerson?.[p.id]) || 1));
    for (let i = 0; i < span; i++) {
      rows.push({
        cells: cols.map((c) => (i === 0 ? value(p, c) : c.tally ? "" : null)),
        span: i === 0 ? span : 0, cont: i > 0, band: cfg.shading === "none" ? 0 : band,
      });
    }
  }
  for (let i = 0; i < Number(cfg.blankRows || 0); i++) {
    if (cfg.shading === "people") band = 1 - band;
    rows.push({ cells: cols.map(() => ""), span: 1, cont: false, band: cfg.shading === "people" ? band : 0 });
  }
  return { cols, rows };
}

export function shadeColor(cfg) {
  const v = Math.round(255 * (1 - Math.max(0, Math.min(60, Number(cfg.shadeLevel) || 0)) / 100));
  return `#${v.toString(16).padStart(2, "0").repeat(3)}`;
}

/** Split rows into pages, estimating heights in mm. First page carries title/intro, last the footer. */
export function paginate(cfg, rows) {
  const [pageW, pageH] = PAGE[cfg.orientation];
  const pt = 0.3528; // mm per point
  const usable = pageW - 2 * cfg.margins.side;
  // Wrapped line count, assuming an average Arial glyph is ~0.55 em wide.
  const lines = (s, size, width) => (s ? s.split("\n")
    .reduce((n, line) => n + Math.max(1, Math.ceil((line.length * size * pt * 0.55) / width)), 0) : 0);
  const introH = cfg.title || cfg.datePosition === "title" ? cfg.titleSize * pt * 1.3 + 2 : 0;
  const introW = usable - (cfg.image ? cfg.image.widthMm + 3 : 0);
  const intro = runsText(cfg.intro);
  const footer = runsText(cfg.footer);
  const textH = lines(intro, cfg.introSize, introW) * cfg.introSize * pt * 1.5 + (intro ? 3 : 0);
  const imgH = cfg.image ? (cfg.image.heightMm || 0) : 0;
  const headH = Math.max(cfg.rowHeight, cfg.headerSize * pt * 1.4) + 0.5;
  const footerH = lines(footer, cfg.footerSize, usable) * cfg.footerSize * pt * 1.5 + (footer ? 4 : 0);
  const body = pageH - cfg.margins.top - cfg.margins.bottom;
  // Rows of one person stay on the same page.
  const blocks = [];
  for (const r of rows) {
    if (r.cont) blocks[blocks.length - 1].push(r);
    else blocks.push([r]);
  }
  const pages = [[]];
  const pageCapacity = (first) => {
    const top = first ? Math.max(introH + textH, imgH) : 0;
    return Math.max(1, Math.floor((body - top - headH - footerH) / (cfg.rowHeight + 0.1)));
  };
  let used = 0;
  let capacity = pageCapacity(true);
  for (const b of blocks) {
    if (used + b.length > capacity && used > 0) {
      pages.push([]);
      used = 0;
      capacity = pageCapacity(false);
    }
    pages[pages.length - 1].push(...b);
    used += b.length;
  }
  return pages;
}

export function listTitle(cfg, date) {
  return cfg.datePosition === "title" ? `${cfg.title} ${date}`.trim() : cfg.title;
}

// ── .docx export ──
export async function exportDocx(kind, cfg, cols, rows, date) {
  const d = await import("docx");
  const mm = (x) => Math.round(x * 56.6929); // twips
  const [pw, ph] = PAGE.portrait; // docx swaps these itself for landscape
  const border = { style: d.BorderStyle.SINGLE, size: 4, color: "000000" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const shade = shadeColor(cfg).slice(1).toUpperCase();
  const align = { left: d.AlignmentType.LEFT, center: d.AlignmentType.CENTER, right: d.AlignmentType.RIGHT };
  const cell = (text, c, head, row = {}) => new d.TableCell({
    width: { size: mm(c.width), type: d.WidthType.DXA },
    borders,
    shading: row.band ? { type: d.ShadingType.CLEAR, fill: shade, color: "auto" } : undefined,
    verticalMerge: c.tally || head ? undefined : row.cont ? d.VerticalMergeType.CONTINUE : row.span > 1 ? d.VerticalMergeType.RESTART : undefined,
    margins: { left: mm(1), right: mm(1) },
    verticalAlign: d.VerticalAlign.CENTER,
    children: [new d.Paragraph({
      keepNext: row.keepNext,
      alignment: head && c.tally ? d.AlignmentType.CENTER : d.AlignmentType.LEFT,
      children: [new d.TextRun({ text: String(text ?? ""), bold: head, size: (head ? cfg.headerSize : cfg.fontSize) * 2, font: "Arial" })],
    })],
  });
  const height = { value: mm(cfg.rowHeight), rule: d.HeightRule.ATLEAST };
  const table = new d.Table({
    width: { size: mm(cols.reduce((s, c) => s + c.width, 0)), type: d.WidthType.DXA },
    columnWidths: cols.map((c) => mm(c.width)),
    layout: d.TableLayoutType.FIXED,
    rows: [
      new d.TableRow({ tableHeader: true, height, cantSplit: true, children: cols.map((c) => cell(c.label, c, true)) }),
      ...rows.map((r, i) => {
        const row = { ...r, keepNext: rows[i + 1]?.cont }; // keep a person's rows on one page
        return new d.TableRow({ height, cantSplit: true, children: cols.map((c, j) => cell(r.cells[j] ?? "", c, false, row)) });
      }),
    ],
  });
  const para = (text, size, opts = {}) => runLines(text).map((line) => new d.Paragraph({
    alignment: opts.align, spacing: { after: opts.after ?? 0 },
    children: line.map((r) => new d.TextRun({ text: r.text, size: size * 2, bold: opts.bold, color: r.color?.replace("#", ""), font: "Arial" })),
  }));

  const head = [];
  const floating = [];
  if (cfg.image?.dataUrl) {
    const bytes = Uint8Array.from(atob(cfg.image.dataUrl.split(",")[1]), (ch) => ch.charCodeAt(0));
    const px = (x) => Math.round(x * 3.7795); // mm → px at 96 dpi
    floating.push(new d.ImageRun({
      data: bytes,
      transformation: { width: px(cfg.image.widthMm), height: px(cfg.image.heightMm || cfg.image.widthMm) },
      floating: {
        horizontalPosition: { relative: d.HorizontalPositionRelativeFrom.MARGIN, align: cfg.image.position === "left" ? d.HorizontalPositionAlign.LEFT : d.HorizontalPositionAlign.RIGHT },
        verticalPosition: { relative: d.VerticalPositionRelativeFrom.MARGIN, align: d.VerticalPositionAlign.TOP },
        wrap: { type: d.TextWrappingType.SQUARE },
      },
    }));
  }
  if (listTitle(cfg, date) || floating.length) {
    head.push(new d.Paragraph({
      alignment: d.AlignmentType.CENTER, spacing: { after: 80 },
      children: [...floating, new d.TextRun({ text: listTitle(cfg, date), size: cfg.titleSize * 2, bold: true, font: "Arial" })],
    }));
  }
  if (runsText(cfg.intro)) head.push(...para(cfg.intro, cfg.introSize, { align: align[cfg.introAlign] }), new d.Paragraph({ children: [] }));

  const doc = new d.Document({
    styles: { default: { document: { run: { font: "Arial" } } } },
    sections: [{
      properties: {
        page: {
          size: { width: mm(pw), height: mm(ph), orientation: cfg.orientation === "landscape" ? d.PageOrientation.LANDSCAPE : d.PageOrientation.PORTRAIT },
          margin: { top: mm(cfg.margins.top), bottom: mm(cfg.margins.bottom), left: mm(cfg.margins.side), right: mm(cfg.margins.side), header: mm(Math.max(3, cfg.margins.top / 2 - 2)), footer: mm(4) },
        },
      },
      headers: cfg.datePosition === "header" && date
        ? { default: new d.Header({ children: para(date, cfg.dateSize, { align: d.AlignmentType.RIGHT }) }) } : undefined,
      footers: runsText(cfg.footer)
        ? { default: new d.Footer({ children: para(cfg.footer, cfg.footerSize, { align: align[cfg.footerAlign] }) }) } : undefined,
      children: [...head, table],
    }],
  });
  return d.Packer.toBlob(doc);
}
