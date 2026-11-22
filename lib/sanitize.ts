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
    // highlight from the toolbar (execCommand hiliteColor) arrives as a styled span
    if (tag === "SPAN" && /background(-color)?\s*:\s*(?!transparent|initial|inherit|rgba\(0, 0, 0, 0\))/i.test(el.getAttribute("style") ?? "")) {
      tag = "MARK";
    }
    if (!KEEP.has(tag)) {
      clean(el, doc);
      el.replaceWith(...Array.from(el.childNodes));
      continue;
    }
    const out = doc.createElement(tag);
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
