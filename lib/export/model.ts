// Client-side: turns exported nodes into an ordered tree of cleaned note HTML, shared by the Word and PDF exports.
import { sanitizeHtml } from "@/lib/sanitize";
import { LEVEL_LABEL, type Level, type NodeDetail } from "@/lib/types";

export const FONT_NAME = "jf open 粉圓 2.1";
/** body text size in the exported files, in points */
export const BASE_PT = 14;
/** body text size on the web page, in px — inline px sizes are scaled relative to this */
const WEB_BASE_PX = 15.5;

export type ExportNode = {
  id: string;
  level: Level;
  /** "一" for a top-level category, "" otherwise */
  number: string;
  name: string;
  /** cleaned note HTML; "" when the note is empty */
  html: string;
  children: ExportNode[];
};

export type ExportMeta = {
  /** what was exported, e.g. "全部大類" or "一、行政及總務" */
  scope: string;
  /** e.g. "2026/11/27 21:40" */
  date: string;
};

const KEYWORD_PX: Record<string, number> = {
  "xx-small": 9, "x-small": 10, small: 13, medium: 16, large: 18, "x-large": 24, "xx-large": 32, "xxx-large": 48,
};

/** Express a font size relative to the body text (em), so it scales with the 14pt export base. */
function relativeSize(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (s in KEYWORD_PX) return `${+(KEYWORD_PX[s] / WEB_BASE_PX).toFixed(3)}em`;
  const m = /^([\d.]+)(px|%|rem)$/.exec(s);
  if (!m) return null; // em and pt are kept as they are
  const n = parseFloat(m[1]);
  if (m[2] === "px") return `${+(n / WEB_BASE_PX).toFixed(3)}em`;
  if (m[2] === "%") return `${+(n / 100).toFixed(3)}em`;
  return `${n}em`;
}

function hasContent(body: HTMLElement) {
  return !!body.querySelector("img, table, hr") || (body.textContent ?? "").replace(/ /g, " ").trim().length > 0;
}

/** Sanitize a note exactly like the editor does, then make its font sizes relative. */
export function prepareNoteHtml(raw: string): string {
  const doc = new DOMParser().parseFromString(`<body>${sanitizeHtml(raw)}</body>`, "text/html");
  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>("[style]"))) {
    if (!el.style.fontSize) continue;
    const rel = relativeSize(el.style.fontSize);
    if (rel) el.style.fontSize = rel;
  }
  return hasContent(doc.body) ? doc.body.innerHTML : "";
}

export function buildTree(nodes: NodeDetail[], rootNumbers: Map<string, string>): ExportNode[] {
  const kids = new Map<string | null, NodeDetail[]>();
  for (const n of nodes) {
    if (!kids.has(n.parentId)) kids.set(n.parentId, []);
    kids.get(n.parentId)!.push(n);
  }
  for (const list of kids.values()) list.sort((a, b) => a.order - b.order);
  const make = (n: NodeDetail): ExportNode => ({
    id: n.id,
    level: n.level,
    number: n.level === 1 ? (rootNumbers.get(n.id) ?? "") : "",
    name: n.name || `未命名${LEVEL_LABEL[n.level]}`,
    html: prepareNoteHtml(n.content),
    children: (kids.get(n.id) ?? []).map(make),
  });
  return (kids.get(null) ?? []).map(make);
}

export const headingText = (n: ExportNode) => (n.level === 1 && n.number ? `${n.number}、${n.name}` : n.name);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Body markup for the PDF; the server wraps it in the print stylesheet. */
export function buildPdfBody(tree: ExportNode[], meta: ExportMeta): string {
  const section = (n: ExportNode): string => {
    const head =
      n.level === 1 && n.number
        ? `<span class="num">${esc(n.number)}、</span>${esc(n.name)}`
        : esc(n.name);
    const tag = `h${n.level}`;
    return (
      `<section class="sec sec-${n.level}">` +
      `<${tag} class="cat cat-${n.level}">${head}</${tag}>` +
      (n.html ? `<div class="note">${n.html}</div>` : "") +
      n.children.map(section).join("") +
      `</section>`
    );
  };
  return (
    `<header class="doc-head"><p class="eyebrow">工作學習筆記</p><p class="doc-title">${esc(meta.scope)}</p>` +
    `<p class="meta">匯出日期 ${esc(meta.date)}</p></header>` +
    tree.map(section).join("")
  );
}
