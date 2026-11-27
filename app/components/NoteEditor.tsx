"use client";

import { useEffect, useRef, useState } from "react";
import { sanitizeHtml, htmlHasText, normalizeFonts, fontMarker, HIGHLIGHT_COLOR } from "@/lib/sanitize";
import { uploadImage } from "@/lib/images";

type Props = {
  nodeId: string;
  initialHtml: string;
  onChange: (html: string) => void;
  onError: (msg: string) => void;
};

let uploadSeq = 0;

type Tool = { label: React.ReactNode; title: string; cmd: string; value?: string; cls?: string };

const INLINE: Tool[] = [
  { label: "B", title: "粗體 (Ctrl+B)", cmd: "bold", cls: "b" },
  { label: "I", title: "斜體 (Ctrl+I)", cmd: "italic", cls: "i" },
  { label: "U", title: "底線 (Ctrl+U)", cmd: "underline", cls: "u" },
  { label: "S", title: "刪除線", cmd: "strikeThrough", cls: "s" },
  { label: "標記", title: "螢光標記", cmd: "hiliteColor", value: HIGHLIGHT_COLOR },
];
const BLOCKS: Tool[] = [
  { label: "H1 標題", title: "大標題", cmd: "formatBlock", value: "<h2>" },
  { label: "H2 副標", title: "小標題", cmd: "formatBlock", value: "<h3>" },
  { label: "內文", title: "一般段落", cmd: "formatBlock", value: "<p>" },
  { label: "引言", title: "引言區塊", cmd: "formatBlock", value: "<blockquote>" },
];

/** Little "lines" icon: each entry is [x, width] of a line. */
const alignIcon = (lines: [number, number][]) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    {lines.map(([x, w], i) => (
      <rect key={i} x={x} y={2.5 + i * 3.5} width={w} height="1.6" rx=".8" fill="currentColor" />
    ))}
  </svg>
);
const ALIGN: Tool[] = [
  { label: alignIcon([[1, 14], [1, 9], [1, 14], [1, 7]]), title: "靠左對齊", cmd: "justifyLeft" },
  { label: alignIcon([[1, 14], [3.5, 9], [1, 14], [4.5, 7]]), title: "置中對齊", cmd: "justifyCenter" },
  { label: alignIcon([[1, 14], [6, 9], [1, 14], [8, 7]]), title: "靠右對齊", cmd: "justifyRight" },
  { label: alignIcon([[1, 14], [1, 14], [1, 14], [1, 8]]), title: "左右對齊", cmd: "justifyFull" },
];
const LISTS: Tool[] = [
  { label: "• 條列", title: "項目符號", cmd: "insertUnorderedList" },
  { label: "1. 編號", title: "編號清單", cmd: "insertOrderedList" },
  { label: "分隔線", title: "插入分隔線", cmd: "insertHorizontalRule" },
];
const TAIL: Tool[] = [
  { label: "＋ 圖片", title: "插入圖片（也可直接 Ctrl+V 貼上或拖曳）", cmd: "image", cls: "accent" },
  { label: "清除格式", title: "清除選取文字的格式", cmd: "removeFormat" },
  { label: "↶", title: "復原 (Ctrl+Z)", cmd: "undo" },
  { label: "↷", title: "重做 (Ctrl+Y)", cmd: "redo" },
];

const COLORS = [
  { v: "#15171c", n: "墨黑" },
  { v: "#6b7280", n: "灰" },
  { v: "#c0392b", n: "紅" },
  { v: "#d35400", n: "橘" },
  { v: "#a98450", n: "金" },
  { v: "#2f855a", n: "綠" },
  { v: "#2457a6", n: "藍" },
  { v: "#6b46c1", n: "紫" },
];
const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40];
const GRID_ROWS = 8;
const GRID_COLS = 8;

type Pop = "color" | "table" | null;

/** The table cell holding the start of `r`, if it is inside `root`. */
function tableCellAt(r: Range | null, root: HTMLElement | null) {
  const n = r?.startContainer;
  const el = n ? (n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement) : null;
  const cell = el?.closest<HTMLTableCellElement>("td, th");
  return cell && root?.contains(cell) ? cell : null;
}

export default function NoteEditor({ nodeId, initialHtml, onChange, onError }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const customColorRef = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [uploading, setUploading] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pop, setPop] = useState<Pop>(null);
  const [lastColor, setLastColor] = useState("#c0392b");
  const [gridHover, setGridHover] = useState<[number, number]>([0, 0]);
  const [withHeader, setWithHeader] = useState(true);
  const [inTable, setInTable] = useState(false);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = sanitizeHtml(initialHtml);
    // only on mount: the component is keyed by node id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // remember the last caret / selection inside the editor, so toolbar pickers can act on it
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (!sel?.rangeCount || !ref.current) return;
      const r = sel.getRangeAt(0);
      if (!ref.current.contains(r.commonAncestorContainer)) return;
      savedRange.current = r.cloneRange();
      setInTable(!!tableCellAt(r, ref.current));
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  // close popovers on outside click / Escape
  useEffect(() => {
    if (!pop) return;
    const onDown = (e: MouseEvent) => {
      if (!toolbarRef.current?.contains(e.target as Node)) setPop(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPop(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pop]);

  const emit = () => {
    if (ref.current) onChange(ref.current.innerHTML);
  };

  const cellAt = (r: Range | null) => tableCellAt(r, ref.current);

  /** Focus the editor and put back the selection the user last had in it. */
  const restore = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const r = savedRange.current;
    if (r && el.contains(r.commonAncestorContainer)) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
  };

  const exec = (cmd: string, value?: string) => {
    restore();
    document.execCommand(cmd, false, value);
    emit();
  };

  /** Apply a text color or font size (null = back to default) to the selection. */
  const applyStyle = (prop: "color" | "size", value: string | null) => {
    restore();
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand("fontName", false, fontMarker(prop, value));
    if (ref.current) normalizeFonts(ref.current);
    emit();
  };

  const pickColor = (c: string | null) => {
    if (c) setLastColor(c);
    applyStyle("color", c);
    setPop(null);
  };

  // native color picker: apply once the user confirms (the "change" event, not every "input")
  useEffect(() => {
    const input = customColorRef.current;
    if (!input) return;
    const onPick = () => pickColor(input.value);
    input.addEventListener("change", onPick);
    return () => input.removeEventListener("change", onPick);
  });

  // ---------- tables ----------
  const insertTable = (rows: number, cols: number) => {
    const row = (tag: string) => `<tr>${`<${tag}><br></${tag}>`.repeat(cols)}</tr>`;
    const body = (withHeader ? row("th") : "") + row("td").repeat(Math.max(0, withHeader ? rows - 1 : rows));
    restore();
    document.execCommand("insertHTML", false, `<table data-new="1"><tbody>${body}</tbody></table><p><br></p>`);
    const table = ref.current?.querySelector("table[data-new]");
    table?.removeAttribute("data-new");
    const first = table?.querySelector("td, th");
    if (first) placeCaret(first);
    setPop(null);
    emit();
  };

  const placeCaret = (el: Element) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    savedRange.current = r.cloneRange();
  };

  const tableOp = (op: "rowAbove" | "rowBelow" | "colLeft" | "colRight" | "delRow" | "delCol" | "delTable") => {
    const cell = cellAt(savedRange.current);
    const tr = cell?.parentElement as HTMLTableRowElement | undefined;
    const table = cell?.closest("table");
    if (!cell || !tr || !table) return;
    const col = cell.cellIndex;
    const rows = Array.from(table.rows);
    let focus: Element | null = cell;

    if (op === "rowAbove" || op === "rowBelow") {
      const nr = document.createElement("tr");
      for (let i = 0; i < tr.cells.length; i++) {
        const td = document.createElement("td");
        td.innerHTML = "<br>";
        nr.append(td);
      }
      tr.insertAdjacentElement(op === "rowAbove" ? "beforebegin" : "afterend", nr);
      focus = nr.cells[Math.min(col, nr.cells.length - 1)];
    } else if (op === "colLeft" || op === "colRight") {
      for (const r of rows) {
        const refCell = r.cells[Math.min(col, r.cells.length - 1)];
        if (!refCell) continue;
        const nc = document.createElement(refCell.tagName === "TH" ? "th" : "td");
        nc.innerHTML = "<br>";
        refCell.insertAdjacentElement(op === "colLeft" ? "beforebegin" : "afterend", nc);
        if (r === tr) focus = nc;
      }
    } else if (op === "delRow") {
      const idx = rows.indexOf(tr);
      tr.remove();
      const next = table.rows[Math.min(idx, table.rows.length - 1)];
      focus = next?.cells[Math.min(col, next.cells.length - 1)] ?? null;
      if (!table.rows.length) op = "delTable";
    } else if (op === "delCol") {
      for (const r of rows) r.cells[Math.min(col, r.cells.length - 1)]?.remove();
      const left = tr.cells[Math.max(0, col - 1)];
      focus = left ?? null;
      if (!rows.some((r) => r.cells.length)) op = "delTable";
    }
    if (op === "delTable") {
      const after = table.nextElementSibling;
      table.remove();
      focus = after;
    }
    for (const r of Array.from(table.rows)) if (!r.cells.length) r.remove();
    ref.current?.focus();
    if (focus && ref.current?.contains(focus)) placeCaret(focus);
    setInTable(!!cellAt(savedRange.current));
    emit();
  };

  // ---------- images ----------
  const insertImages = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    restore();
    for (const file of imgs) {
      const token = `up-${++uploadSeq}`;
      document.execCommand(
        "insertHTML",
        false,
        `<span class="uploading" data-token="${token}">圖片上傳中…</span>&nbsp;`,
      );
      setUploading((n) => n + 1);
      try {
        const url = await uploadImage(file, nodeId);
        const ph = ref.current?.querySelector(`[data-token="${token}"]`);
        if (ph) {
          const img = document.createElement("img");
          img.src = url;
          img.alt = file.name || "圖片";
          ph.replaceWith(img);
        }
      } catch (e) {
        ref.current?.querySelector(`[data-token="${token}"]`)?.remove();
        onError(e instanceof Error ? e.message : "圖片上傳失敗");
      } finally {
        setUploading((n) => n - 1);
        emit();
      }
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const dt = e.clipboardData;
    const files = Array.from(dt.files).filter((f) => f.type.startsWith("image/"));
    const html = dt.getData("text/html");
    if (files.length && (!html || !htmlHasText(html))) {
      e.preventDefault();
      void insertImages(files);
      return;
    }
    if (html) {
      e.preventDefault();
      document.execCommand("insertHTML", false, sanitizeHtml(html));
      emit();
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    const pos = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (pos) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(pos);
      savedRange.current = pos;
    }
    void insertImages(files);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      emit();
    }
  };

  const keys = (tools: Tool[]) =>
    tools.map((t) => (
      <button
        key={t.title}
        type="button"
        className={`key ${t.cls ?? ""}`}
        title={t.title}
        aria-label={t.title}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (t.cmd === "image" ? fileRef.current?.click() : exec(t.cmd, t.value))}
      >
        {t.label}
      </button>
    ));
  const sep = (k: string) => <span key={k} className="tb-sep" aria-hidden />;
  const noBlur = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="editor">
      <div className="toolbar" role="toolbar" aria-label="排版工具" ref={toolbarRef}>
        {keys(INLINE)}

        {/* text color: main part re-applies the last color, arrow opens the palette */}
        <span className="tb-pop-wrap split">
          <button type="button" className="key color-key" title="文字顏色" onMouseDown={noBlur} onClick={() => pickColor(lastColor)}>
            A<span className="color-bar" style={{ background: lastColor }} />
          </button>
          <button
            type="button"
            className={`key caret ${pop === "color" ? "on" : ""}`}
            title="選擇文字顏色"
            aria-expanded={pop === "color"}
            onMouseDown={noBlur}
            onClick={() => setPop((p) => (p === "color" ? null : "color"))}
          >
            ▾
          </button>
          {pop === "color" && (
            <div className="tb-pop color-pop" onMouseDown={noBlur}>
              <div className="swatches">
                {COLORS.map((c) => (
                  <button
                    key={c.v}
                    type="button"
                    className="swatch"
                    title={c.n}
                    aria-label={c.n}
                    style={{ background: c.v }}
                    onClick={() => pickColor(c.v)}
                  />
                ))}
              </div>
              <div className="pop-row">
                <button type="button" className="pop-link" onClick={() => pickColor(null)}>
                  恢復預設
                </button>
                <label className="pop-link">
                  自訂顏色…
                  <input ref={customColorRef} type="color" defaultValue={lastColor} className="sr-color" />
                </label>
              </div>
            </div>
          )}
        </span>

        <select
          className="key size-select"
          title="文字大小"
          aria-label="文字大小"
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v) applyStyle("size", v === "default" ? null : `${v}px`);
          }}
        >
          <option value="" disabled hidden>
            字級
          </option>
          <option value="default">預設</option>
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {sep("s1")}
        {keys(BLOCKS)}
        {sep("s2")}
        {keys(ALIGN)}
        {sep("s3")}
        {keys(LISTS)}

        <span className="tb-pop-wrap">
          <button
            type="button"
            className={`key ${pop === "table" ? "on" : ""}`}
            title="插入表格"
            aria-expanded={pop === "table"}
            onMouseDown={noBlur}
            onClick={() => {
              setGridHover([0, 0]);
              setPop((p) => (p === "table" ? null : "table"));
            }}
          >
            ▦ 表格
          </button>
          {pop === "table" && (
            <div className="tb-pop table-pop" onMouseDown={noBlur}>
              <div className="grid-pick" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 18px)` }} onMouseLeave={() => setGridHover([0, 0])}>
                {Array.from({ length: GRID_ROWS * GRID_COLS }, (_, i) => {
                  const r = Math.floor(i / GRID_COLS) + 1;
                  const c = (i % GRID_COLS) + 1;
                  const on = r <= gridHover[0] && c <= gridHover[1];
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`cell ${on ? "on" : ""}`}
                      aria-label={`${r} 列 × ${c} 欄`}
                      onMouseEnter={() => setGridHover([r, c])}
                      onFocus={() => setGridHover([r, c])}
                      onClick={() => insertTable(r, c)}
                    />
                  );
                })}
              </div>
              <div className="pop-row">
                <span className="grid-label">{gridHover[0] ? `${gridHover[0]} 列 × ${gridHover[1]} 欄` : "選擇表格大小"}</span>
                <label className="pop-check">
                  <input type="checkbox" checked={withHeader} onChange={(e) => setWithHeader(e.target.checked)} />
                  首列為標題
                </label>
              </div>
            </div>
          )}
        </span>

        {sep("s4")}
        {keys(TAIL)}
        {uploading > 0 && <span className="tb-status">圖片上傳中 ×{uploading}</span>}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            void insertImages(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />

        {inTable && (
          <div className="table-bar" role="group" aria-label="表格工具">
            <span className="table-bar-label">表格</span>
            {(
              [
                ["rowAbove", "上方插入列"],
                ["rowBelow", "下方插入列"],
                ["colLeft", "左側插入欄"],
                ["colRight", "右側插入欄"],
                ["delRow", "刪除列"],
                ["delCol", "刪除欄"],
                ["delTable", "刪除表格"],
              ] as const
            ).map(([op, label]) => (
              <button
                key={op}
                type="button"
                className={`key ${op.startsWith("del") ? "danger" : ""}`}
                onMouseDown={noBlur}
                onClick={() => tableOp(op)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        ref={ref}
        className={`page-body ${dragOver ? "drag" : ""}`}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder="開始撰寫筆記…（支援 Ctrl+V 貼上圖片）"
        onInput={() => {
          if (ref.current?.querySelector("font")) normalizeFonts(ref.current);
          emit();
        }}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onKeyDown={onKeyDown}
        onDoubleClick={(e) => {
          const t = e.target as HTMLElement;
          if (t.tagName === "IMG") setPreview((t as HTMLImageElement).src);
        }}
      />
      <p className="editor-hint">
        提示：可直接貼上截圖或拖曳圖片；雙擊圖片可放大檢視；游標在表格內時可新增或刪除列與欄；內容會自動儲存。
      </p>
      {preview && (
        <div className="lightbox" onClick={() => setPreview(null)} role="dialog" aria-label="圖片預覽">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="放大檢視" />
          <span className="lightbox-close">點擊任意處關閉</span>
        </div>
      )}
    </div>
  );
}
