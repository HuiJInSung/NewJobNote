// Client-side HTML whitelist for pasted / stored note content.

const KEEP = new Set([
  "P", "DIV", "BR", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "H2", "H3", "H4",
  "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE", "HR", "IMG", "A", "SPAN", "MARK",
  "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "SUB", "SUP",
]);
const DROP = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "TITLE", "HEAD",
  "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "SVG", "MATH", "TEMPLATE", "NOSCRIPT",
]);

// ---------- inline styles that survive: text color, font size, alignment ----------
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\)|[a-z]{3,20})$/i;
const SAFE_SIZE = /^(\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)|x{0,3}-?(small|large)|medium)$/i;
const SAFE_ALIGN = /^(left|center|right|justify|start|end)$/i;
const TEXT_STYLE_TAGS = new Set([
  "SPAN", "MARK", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "A", "SUB", "SUP",
  "P", "DIV", "H2", "H3", "H4", "LI", "BLOCKQUOTE", "PRE", "TD", "TH",
]);
const BLOCK_TAGS = new Set(["P", "DIV", "H2", "H3", "H4", "LI", "BLOCKQUOTE", "PRE", "TD", "TH"]);
/** legacy <font size="1..7"> → CSS size */
const FONT_SIZE_ATTR = ["", "10px", "13px", "16px", "18px", "24px", "32px", "48px"];

/**
 * The toolbar applies color / size with `execCommand("fontName", <marker>)`, which wraps the selection in
 * `<font face="jn-color-c0392b">` (or `jn-size-20`, `jn-color-none`). These markers say which style to set.
 */
export const fontMarker = (prop: "color" | "size", value: string | null) =>
  `jn-${prop}-${value === null ? "none" : value.replace(/^#/, "").replace(/px$/, "")}`;

/** CSS properties a <font> element (legacy or marker) stands for; a null value means "remove it". */
function fontProps(el: Element): [string, string | null][] {
  const out: [string, string | null][] = [];
  const family = (el.getAttribute("face") || (el as HTMLElement).style?.fontFamily || "").replace(/["']/g, "");
  const m = /^jn-(color|size)-([0-9a-z.]+)$/i.exec(family.trim());
  if (m) {
    const v = m[2] === "none" ? null : m[1] === "color" ? `#${m[2]}` : `${m[2]}px`;
    if (v === null || (m[1] === "color" ? SAFE_COLOR : SAFE_SIZE).test(v)) out.push([m[1] === "color" ? "color" : "font-size", v]);
  }
  const color = el.getAttribute("color");
  if (color && SAFE_COLOR.test(color)) out.push(["color", color]);
  const size = el.getAttribute("size");
  if (size && /^[1-7]$/.test(size)) out.push(["font-size", FONT_SIZE_ATTR[+size]]);
  return out;
}

/** Turn <font> wrappers (from the toolbar) into styled spans, in place, keeping text nodes (and the caret). */
export function normalizeFonts(root: HTMLElement) {
  const targets = Array.from(root.querySelectorAll<HTMLElement>('font, span[style*="jn-"]'));
  for (const el of targets) {
    if (!el.isConnected) continue;
    const props = fontProps(el);
    // the new value replaces the same property on anything inside the selection
    for (const d of Array.from(el.querySelectorAll<HTMLElement>("[style]"))) {
      for (const [p] of props) d.style.removeProperty(p);
      if (!d.getAttribute("style")?.trim()) d.removeAttribute("style");
      if (d.tagName === "SPAN" && !d.attributes.length) d.replaceWith(...Array.from(d.childNodes));
    }
    let span: HTMLElement;
    if (el.tagName === "SPAN") {
      span = el;
      span.style.removeProperty("font-family");
    } else {
      span = document.createElement("span");
      span.append(...Array.from(el.childNodes));
      el.replaceWith(span);
    }
    for (const [p, v] of props) {
      if (v) span.style.setProperty(p, v);
      else span.style.removeProperty(p);
    }
    if (!span.getAttribute("style")?.trim()) span.replaceWith(...Array.from(span.childNodes));
  }
}

function safeStyle(el: Element, tag: string): string {
  if (!TEXT_STYLE_TAGS.has(tag)) return "";
  const s = (el as HTMLElement).style;
  if (!s) return "";
  const out: string[] = [];
  const color = s.color.trim();
  if (color && SAFE_COLOR.test(color)) out.push(`color: ${color}`);
  const size = s.fontSize.trim();
  if (size && SAFE_SIZE.test(size)) out.push(`font-size: ${size}`);
  const align = s.textAlign.trim();
  if (align && BLOCK_TAGS.has(tag) && SAFE_ALIGN.test(align)) out.push(`text-align: ${align}`);
  return out.join("; ");
}

/** The 「標記」 button's color (browsers report it as rgb(253, 230, 138)). */
export const HIGHLIGHT_COLOR = "#fde68a";

function isToolbarHighlight(el: Element): boolean {
  const bg = ((el as HTMLElement).style?.backgroundColor ?? "").replace(/\s+/g, "").toLowerCase();
  return bg === "rgb(253,230,138)" || bg === HIGHLIGHT_COLOR;
}

function safeImgSrc(src: string): boolean {
  return /^\/api\/images\/[0-9a-f]{24}$/i.test(src) || /^https?:\/\//i.test(src);
}

function clean(node: Node, doc: Document) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    let tag = el.tagName.toUpperCase();
    if (DROP.has(tag)) {
      el.remove();
      continue;
    }
    if (tag === "H1") tag = "H2";
    if (tag === "H5" || tag === "H6") tag = "H4";
    // highlight from the toolbar (execCommand hiliteColor) arrives as a styled span. Only that exact color counts:
    // other backgrounds (pasted text, spans the browser adds when lines merge) must not turn into highlights.
    if (tag === "SPAN" && isToolbarHighlight(el)) {
      tag = "MARK";
    }
    let style = "";
    if (tag === "FONT") {
      style = fontProps(el)
        .filter(([, v]) => v)
        .map(([p, v]) => `${p}: ${v}`)
        .join("; ");
      tag = "SPAN";
    }
    if (!KEEP.has(tag)) {
      clean(el, doc);
      el.replaceWith(...Array.from(el.childNodes));
      continue;
    }
    const out = doc.createElement(tag);
    if (!style) style = safeStyle(el, tag);
    if (style) out.setAttribute("style", style);
    else if (tag === "SPAN") {
      // a bare span adds nothing
      clean(el, doc);
      el.replaceWith(...Array.from(el.childNodes));
      continue;
    }
    if (tag === "IMG") {
      const src = el.getAttribute("src") ?? "";
      if (!safeImgSrc(src)) {
        el.remove();
        continue;
      }
      out.setAttribute("src", src);
      const alt = el.getAttribute("alt");
      if (alt) out.setAttribute("alt", alt);
    } else if (tag === "A") {
      const href = el.getAttribute("href") ?? "";
      if (/^https?:\/\//i.test(href)) {
        out.setAttribute("href", href);
        out.setAttribute("target", "_blank");
        out.setAttribute("rel", "noopener noreferrer");
      }
    } else if (tag === "TD" || tag === "TH") {
      for (const a of ["colspan", "rowspan"]) {
        const v = el.getAttribute(a);
        if (v && /^\d{1,2}$/.test(v)) out.setAttribute(a, v);
      }
    }
    clean(el, doc);
    out.append(...Array.from(el.childNodes));
    el.replaceWith(out);
  }
}

export function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") return "";
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  clean(doc.body, doc);
  return doc.body.innerHTML;
}

export function htmlHasText(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;
}
