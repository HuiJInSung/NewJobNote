// Client-side Word export: converts the cleaned note HTML into docx paragraphs, keeping the web formatting.
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  type ParagraphChild,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { BASE_PT, FONT_NAME, type ExportMeta, type ExportNode } from "./model";

// ---------- page & colors ----------
const PAGE_W = 11906; // A4, twips
const PAGE_H = 16838;
const MARGIN = 1020; // 18 mm
const CONTENT_TW = PAGE_W - MARGIN * 2;
const CONTENT_PX = Math.floor((CONTENT_TW / 1440) * 96); // ≈ 661px at 96 dpi
/** line spacing: Word 最小行高 0 pt, i.e. each line is as tall as its font needs */
const LINE = { line: 0, lineRule: LineRuleType.AT_LEAST } as const;

const INK = "0F1A2B";
const INK_2 = "1C2A40";
const TEXT = "15171C";
const TEXT_2 = "565B66";
const TEXT_3 = "9B9DA4";
const GOLD = "A98450";
const GOLD_2 = "C7A571";
const BORDER = "E8E3DA";
const BORDER_STRONG = "D6CFC2";
const SURFACE_2 = "FAF8F5";
const MARK = "FDF0B8";

const FONT = { ascii: FONT_NAME, eastAsia: FONT_NAME, hAnsi: FONT_NAME, cs: FONT_NAME };
const half = (pt: number) => Math.round(pt * 2);

// ---------- images ----------
type Img = { data: Uint8Array; type: "png" | "jpg" | "gif"; w: number; h: number };

async function loadImage(src: string): Promise<Img | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const { width: w, height: h } = bmp;
    let type: Img["type"] | null =
      blob.type === "image/png" ? "png" : blob.type === "image/jpeg" ? "jpg" : blob.type === "image/gif" ? "gif" : null;
    let data: Uint8Array;
    if (type) {
      data = new Uint8Array(await blob.arrayBuffer());
    } else {
      // Word can't show WebP etc. — re-encode as PNG
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(bmp, 0, 0);
      const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!png) return null;
      data = new Uint8Array(await png.arrayBuffer());
      type = "png";
    }
    bmp.close();
    return { data, type, w, h };
  } catch {
    return null;
  }
}

async function loadAllImages(tree: ExportNode[]): Promise<Map<string, Img | null>> {
  const srcs = new Set<string>();
  const visit = (n: ExportNode) => {
    if (n.html) {
      const doc = new DOMParser().parseFromString(n.html, "text/html");
      for (const img of Array.from(doc.images)) {
        const s = img.getAttribute("src");
        if (s) srcs.add(s);
      }
    }
    n.children.forEach(visit);
  };
  tree.forEach(visit);
  const out = new Map<string, Img | null>();
  const list = [...srcs];
  // a few at a time
  for (let i = 0; i < list.length; i += 4) {
    const batch = list.slice(i, i + 4);
    const loaded = await Promise.all(batch.map(loadImage));
    batch.forEach((s, j) => out.set(s, loaded[j]));
  }
  return out;
}

// ---------- HTML → docx ----------
type Fmt = {
  sizePt: number;
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  shade?: string;
  sup?: boolean;
  sub?: boolean;
};

type Block = {
  kind: "p" | "h2" | "h3" | "h4" | "quote" | "pre";
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  list?: { ordered: boolean; level: number; instance: number };
  /** inside a table cell: tighter spacing; width limits images */
  cellPx?: number;
};

type Out = Paragraph | Table;
const BR = Symbol("br");
type Item = ParagraphChild | typeof BR;

function toHex(c: string): string | undefined {
  const s = c.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return m[1].split("").map((x) => x + x).join("").toUpperCase();
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return m[1].toUpperCase();
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
  if (m) return [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, "0")).join("").toUpperCase();
  const named: Record<string, string> = { black: "000000", white: "FFFFFF", red: "FF0000", blue: "0000FF", green: "008000", gray: "808080", grey: "808080" };
  return named[s];
}

function sizeFrom(v: string, current: number): number | undefined {
  const m = /^([\d.]+)(em|pt|px|rem|%)$/.exec(v.trim().toLowerCase());
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case "em":
      return n * current;
    case "rem":
      return n * BASE_PT;
    case "%":
      return (n / 100) * current;
    case "pt":
      return n;
    case "px":
      return n * 0.75;
  }
}

const ALIGN: Record<string, Block["align"]> = {
  left: AlignmentType.LEFT,
  start: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  end: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

const INLINE_FMT: Record<string, Partial<Fmt>> = {
  B: { bold: true },
  STRONG: { bold: true },
  I: { italics: true },
  EM: { italics: true },
  U: { underline: true },
  S: { strike: true },
  STRIKE: { strike: true },
  DEL: { strike: true },
  MARK: { shade: MARK },
  CODE: { shade: "F2EFE9" },
  SUB: { sub: true },
  SUP: { sup: true },
  A: { color: INK, underline: true },
};
const BLOCK_KIND: Record<string, Block["kind"]> = {
  P: "p",
  DIV: "p",
  LI: "p",
  H2: "h2",
  H3: "h3",
  H4: "h4",
  BLOCKQUOTE: "quote",
  PRE: "pre",
};
const HEADING_EM: Record<string, number> = { H2: 1.5, H3: 1.2, H4: 1.02 };

class Converter {
  out: Out[] = [];
  private items: Item[] = [];
  private olCount = 0;

  constructor(private images: Map<string, Img | null>) {}

  private styleFmt(el: HTMLElement, fmt: Fmt): Fmt {
    const s = el.style;
    const next = { ...fmt };
    const color = s.color && toHex(s.color);
    if (color) next.color = color;
    const size = s.fontSize && sizeFrom(s.fontSize, fmt.sizePt);
    if (size) next.sizePt = Math.min(96, Math.max(6, size));
    return next;
  }

  private run(text: string, f: Fmt): TextRun {
    return new TextRun({
      text,
      bold: f.bold,
      italics: f.italics,
      underline: f.underline ? {} : undefined,
      strike: f.strike,
      color: f.color,
      size: half(f.sizePt),
      shading: f.shade ? { type: ShadingType.CLEAR, fill: f.shade, color: "auto" } : undefined,
      superScript: f.sup,
      subScript: f.sub,
    });
  }

  private paragraph(children: ParagraphChild[], b: Block): Paragraph {
    const inCell = b.cellPx !== undefined;
    const base = {
      children,
      alignment: b.align,
      spacing: { after: inCell ? 40 : 200, ...LINE },
    };
    const list = b.list
      ? b.list.ordered
        ? { numbering: { reference: "ol", level: Math.min(b.list.level, 5), instance: b.list.instance } }
        : { bullet: { level: Math.min(b.list.level, 5) } }
      : {};
    switch (b.kind) {
      case "h2":
        return new Paragraph({ ...base, ...list, style: "NoteH2" });
      case "h3":
        return new Paragraph({ ...base, ...list, style: "NoteH3" });
      case "h4":
        return new Paragraph({ ...base, ...list, style: "NoteH4" });
      case "quote":
        return new Paragraph({
          ...base,
          ...list,
          indent: { left: 340, right: 120 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 10 } },
          shading: { type: ShadingType.CLEAR, fill: SURFACE_2, color: "auto" },
        });
      case "pre":
        return new Paragraph({
          ...base,
          ...list,
          shading: { type: ShadingType.CLEAR, fill: SURFACE_2, color: "auto" },
          border: {
            top: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 4 },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 4 },
            left: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 4 },
            right: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 4 },
          },
        });
      default:
        return new Paragraph({ ...base, ...list, ...(b.list ? { spacing: { after: 60, ...LINE } } : {}) });
    }
  }

  /** End the current paragraph. `keepEmpty` turns an empty block (like <p><br></p>) into a blank line. */
  flush(b: Block, keepEmpty = false) {
    const items = [...this.items];
    this.items = [];
    while (items.length && items[items.length - 1] === BR) items.pop();
    if (!items.length) {
      if (keepEmpty) this.out.push(this.paragraph([], b));
      return;
    }
    const children = items.map((i) => (i === BR ? new TextRun({ text: "", break: 1 }) : i));
    this.out.push(this.paragraph(children, b));
  }

  private image(el: HTMLImageElement, b: Block) {
    const img = this.images.get(el.getAttribute("src") ?? "");
    if (!img) {
      this.items.push(this.run("［圖片無法載入］", { sizePt: BASE_PT * 0.85, color: TEXT_3 }));
      return;
    }
    const maxW = b.cellPx ?? CONTENT_PX;
    const scale = Math.min(1, maxW / img.w);
    this.flush(b);
    this.out.push(
      new Paragraph({
        alignment: b.align,
        spacing: { before: 120, after: 160 },
        children: [
          new ImageRun({
            type: img.type,
            data: img.data,
            transformation: { width: Math.round(img.w * scale), height: Math.round(img.h * scale) },
            altText: { name: el.alt || "圖片", description: el.alt || "圖片", title: el.alt || "圖片" },
          }),
        ],
      }),
    );
  }

  walkChildren(el: Node, fmt: Fmt, b: Block) {
    for (const child of Array.from(el.childNodes)) this.walk(child, fmt, b);
  }

  walk(node: Node, fmt: Fmt, b: Block) {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent ?? "";
      const text = b.kind === "pre" ? raw : raw.replace(/[\t\n\r ]+/g, " ");
      if (!text || (text === " " && !this.items.length)) return;
      if (b.kind === "pre" && text.includes("\n")) {
        text.split("\n").forEach((line, i) => {
          if (i) this.items.push(BR);
          if (line) this.items.push(this.run(line, fmt));
        });
      } else this.items.push(this.run(text, fmt));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName;

    if (tag === "BR") {
      this.items.push(BR);
      return;
    }
    if (tag === "IMG") {
      this.image(el as HTMLImageElement, b);
      return;
    }
    if (tag === "HR") {
      this.flush(b);
      this.out.push(
        new Paragraph({
          spacing: { before: 240, after: 240 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD_2, space: 1 } },
          children: [],
        }),
      );
      return;
    }
    if (tag === "TABLE") {
      this.flush(b);
      this.out.push(this.table(el as HTMLTableElement, fmt, b));
      return;
    }
    if (tag === "UL" || tag === "OL") {
      this.flush(b);
      const level = b.list ? b.list.level + 1 : 0;
      const instance = tag === "OL" ? ++this.olCount : 0;
      for (const li of Array.from(el.children)) {
        const lb: Block = { ...b, kind: "p", list: { ordered: tag === "OL", level, instance } };
        if (li.tagName !== "LI") {
          this.walk(li, fmt, lb);
          this.flush(lb);
          continue;
        }
        const align = (li as HTMLElement).style.textAlign;
        if (align && ALIGN[align]) lb.align = ALIGN[align];
        const before = this.out.length;
        this.walkChildren(li, this.styleFmt(li as HTMLElement, fmt), lb);
        this.flush(lb, this.out.length === before);
      }
      return;
    }
    if (tag in BLOCK_KIND && tag !== "LI") {
      this.flush(b);
      const nb: Block = { ...b, kind: b.kind === "quote" && tag === "P" ? "quote" : BLOCK_KIND[tag] };
      if (tag === "DIV" && b.kind !== "p") nb.kind = b.kind;
      const align = el.style.textAlign;
      if (align && ALIGN[align]) nb.align = ALIGN[align];
      let f = fmt;
      if (tag in HEADING_EM) f = { ...f, sizePt: BASE_PT * HEADING_EM[tag], bold: true, color: f.color ?? INK };
      if (tag === "BLOCKQUOTE") f = { ...f, color: f.color ?? TEXT_2 };
      f = this.styleFmt(el, f);
      const before = this.out.length;
      this.walkChildren(el, f, nb);
      // an empty <p><br></p> is a blank line; but not a <p> that only held an image / table
      this.flush(nb, (tag === "P" || tag === "DIV") && this.out.length === before);
      return;
    }
    if (tag === "A") {
      const href = el.getAttribute("href");
      const saved = this.items;
      this.items = [];
      this.walkChildren(el, this.styleFmt(el, { ...fmt, ...INLINE_FMT.A }), b);
      const inner = this.items.filter((i): i is ParagraphChild => i !== BR);
      this.items = saved;
      if (href && /^https?:\/\//i.test(href) && inner.length) {
        this.items.push(new ExternalHyperlink({ link: href, children: inner }));
      } else this.items.push(...inner);
      return;
    }
    // inline formatting (and anything unknown: just its text)
    this.walkChildren(el, this.styleFmt(el, { ...fmt, ...(INLINE_FMT[tag] ?? {}) }), b);
  }

  private table(el: HTMLTableElement, fmt: Fmt, outer: Block): Table {
    const rows = Array.from(el.rows);
    const cols = Math.max(1, ...rows.map((r) => Array.from(r.cells).reduce((s, c) => s + (c.colSpan || 1), 0)));
    const width = outer.cellPx ? Math.round((outer.cellPx / 96) * 1440) : CONTENT_TW;
    const colTw = Math.floor(width / cols);
    const cellPx = Math.floor((colTw / 1440) * 96) - 16;
    const line = { style: BorderStyle.SINGLE, size: 4, color: BORDER_STRONG };

    const tableRows = rows.map((tr, ri) => {
      const isHeader = Array.from(tr.cells).every((c) => c.tagName === "TH");
      return new TableRow({
        tableHeader: ri === 0 && isHeader,
        cantSplit: true,
        children: Array.from(tr.cells).map((cell) => {
          const th = cell.tagName === "TH";
          const sub = new Converter(this.images);
          sub.olCount = this.olCount;
          const cb: Block = { kind: "p", cellPx: cellPx * (cell.colSpan || 1) };
          const align = cell.style.textAlign;
          if (align && ALIGN[align]) cb.align = ALIGN[align];
          const cf = this.styleFmt(cell, { ...fmt, sizePt: fmt.sizePt * 0.95, ...(th ? { color: "FFFFFF" } : {}) });
          sub.walkChildren(cell, cf, cb);
          sub.flush(cb);
          this.olCount = sub.olCount;
          return new TableCell({
            children: sub.out.length ? sub.out : [new Paragraph({ children: [] })],
            columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
            rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
            width: { size: colTw * (cell.colSpan || 1), type: WidthType.DXA },
            margins: { top: 100, bottom: 100, left: 150, right: 150 },
            shading: th
              ? { type: ShadingType.CLEAR, fill: INK, color: "auto" }
              : ri % 2 === 1
                ? { type: ShadingType.CLEAR, fill: SURFACE_2, color: "auto" }
                : undefined,
            borders: { top: line, bottom: line, left: line, right: line },
          });
        }),
      });
    });
    return new Table({
      rows: tableRows,
      width: { size: colTw * cols, type: WidthType.DXA },
      columnWidths: Array(cols).fill(colTw),
    });
  }
}

function noteBlocks(html: string, images: Map<string, Img | null>): Out[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const c = new Converter(images);
  const b: Block = { kind: "p" };
  c.walkChildren(doc.body, { sizePt: BASE_PT }, b);
  // trailing loose text
  c.flush(b);
  return c.out;
}

// ---------- document ----------
export async function buildDocx(tree: ExportNode[], meta: ExportMeta): Promise<Blob> {
  const images = await loadAllImages(tree);
  const body: Out[] = [
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: "工作學習筆記", size: half(10), color: GOLD, characterSpacing: 60 })],
    }),
    new Paragraph({
      spacing: { after: 60, ...LINE },
      children: [new TextRun({ text: meta.scope, size: half(26), bold: true, color: INK })],
    }),
    new Paragraph({
      spacing: { after: 440 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD_2, space: 10 } },
      children: [new TextRun({ text: `匯出日期 ${meta.date}`, size: half(10), color: TEXT_3 })],
    }),
  ];

  const HEADINGS = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 } as const;
  let firstTop = true;
  const add = (n: ExportNode) => {
    const children: ParagraphChild[] =
      n.level === 1 && n.number
        ? [new TextRun({ text: `${n.number}、`, color: GOLD }), new TextRun(n.name)]
        : [new TextRun(n.name)];
    body.push(
      new Paragraph({
        heading: HEADINGS[n.level],
        pageBreakBefore: n.level === 1 && !firstTop,
        children,
      }),
    );
    if (n.level === 1) firstTop = false;
    if (n.html) body.push(...noteBlocks(n.html, images));
    n.children.forEach(add);
  };
  tree.forEach(add);
  if (!tree.length) body.push(new Paragraph({ children: [new TextRun("（沒有可匯出的分類）")] }));

  const doc = new Document({
    title: meta.scope,
    creator: "工作學習筆記",
    styles: {
      default: {
        // noProof: Word skips spelling / grammar checks, so edited text gets no wavy underlines
        document: {
          run: { font: FONT, noProof: true, size: half(BASE_PT), color: TEXT },
          paragraph: { spacing: { ...LINE } },
        },
        heading1: {
          run: { font: FONT, noProof: true, size: half(24), bold: true, color: INK },
          paragraph: {
            spacing: { before: 0, after: 280, ...LINE },
            border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD_2, space: 6 } },
            keepNext: true,
          },
        },
        heading2: {
          run: { font: FONT, noProof: true, size: half(19), bold: true, color: INK },
          paragraph: {
            spacing: { before: 480, after: 200, ...LINE },
            indent: { left: 200 },
            border: { left: { style: BorderStyle.SINGLE, size: 32, color: GOLD, space: 8 } },
            keepNext: true,
          },
        },
        heading3: {
          run: { font: FONT, noProof: true, size: half(16), bold: true, color: INK_2 },
          paragraph: { spacing: { before: 400, after: 160, ...LINE }, keepNext: true },
        },
      },
      paragraphStyles: [
        {
          id: "NoteH2",
          name: "筆記大標題",
          basedOn: "Normal",
          next: "Normal",
          run: { font: FONT, noProof: true, size: half(BASE_PT * 1.5), bold: true, color: INK },
          paragraph: {
            spacing: { before: 520, after: 220, ...LINE },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 4 } },
            keepNext: true,
          },
        },
        {
          id: "NoteH3",
          name: "筆記小標題",
          basedOn: "Normal",
          next: "Normal",
          run: { font: FONT, noProof: true, size: half(BASE_PT * 1.2), bold: true, color: INK },
          paragraph: {
            spacing: { before: 400, after: 120, ...LINE },
            indent: { left: 200 },
            border: { left: { style: BorderStyle.SINGLE, size: 24, color: GOLD, space: 8 } },
            keepNext: true,
          },
        },
        {
          id: "NoteH4",
          name: "筆記標題 4",
          basedOn: "Normal",
          next: "Normal",
          run: { font: FONT, noProof: true, size: half(BASE_PT * 1.02), bold: true },
          paragraph: { spacing: { before: 300, after: 80 }, keepNext: true },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "ol",
          levels: Array.from({ length: 6 }, (_, level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: {
              paragraph: { indent: { left: 480 * (level + 1), hanging: 360 } },
              run: { color: GOLD },
            },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: { top: MARGIN, bottom: 1134, left: MARGIN, right: MARGIN, footer: 567 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: ["第 ", PageNumber.CURRENT, " 頁，共 ", PageNumber.TOTAL_PAGES, " 頁"],
                    size: half(10),
                    color: TEXT_3,
                  }),
                ],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  });
  return Packer.toBlob(doc);
}
