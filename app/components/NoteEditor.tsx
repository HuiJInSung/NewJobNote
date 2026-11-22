"use client";

import { useEffect, useRef, useState } from "react";
import { sanitizeHtml, htmlHasText } from "@/lib/sanitize";
import { uploadImage } from "@/lib/images";

type Props = {
  nodeId: string;
  initialHtml: string;
  onChange: (html: string) => void;
  onError: (msg: string) => void;
};

let uploadSeq = 0;

type Tool = { label: string; title: string; cmd: string; value?: string; cls?: string };

const TOOLS: (Tool | "|")[] = [
  { label: "B", title: "粗體 (Ctrl+B)", cmd: "bold", cls: "b" },
  { label: "I", title: "斜體 (Ctrl+I)", cmd: "italic", cls: "i" },
  { label: "U", title: "底線 (Ctrl+U)", cmd: "underline", cls: "u" },
  { label: "S", title: "刪除線", cmd: "strikeThrough", cls: "s" },
  { label: "標記", title: "螢光標記", cmd: "hiliteColor", value: "#fde68a" },
  "|",
  { label: "H1 標題", title: "大標題", cmd: "formatBlock", value: "<h2>" },
  { label: "H2 副標", title: "小標題", cmd: "formatBlock", value: "<h3>" },
  { label: "內文", title: "一般段落", cmd: "formatBlock", value: "<p>" },
  { label: "引言", title: "引言區塊", cmd: "formatBlock", value: "<blockquote>" },
  "|",
  { label: "• 條列", title: "項目符號", cmd: "insertUnorderedList" },
  { label: "1. 編號", title: "編號清單", cmd: "insertOrderedList" },
  { label: "分隔線", title: "插入分隔線", cmd: "insertHorizontalRule" },
  "|",
  { label: "＋ 圖片", title: "插入圖片（也可直接 Ctrl+V 貼上或拖曳）", cmd: "image", cls: "accent" },
  { label: "清除格式", title: "清除選取文字的格式", cmd: "removeFormat" },
  { label: "↶", title: "復原 (Ctrl+Z)", cmd: "undo" },
  { label: "↷", title: "重做 (Ctrl+Y)", cmd: "redo" },
];

export default function NoteEditor({ nodeId, initialHtml, onChange, onError }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = sanitizeHtml(initialHtml);
    // only on mount: the component is keyed by node id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = () => {
    if (ref.current) onChange(ref.current.innerHTML);
  };

  const exec = (cmd: string, value?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, value);
    emit();
  };

  const insertImages = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    ref.current?.focus();
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
    }
    void insertImages(files);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      emit();
    }
  };


  return (
    <div className="editor">
      <div className="toolbar" role="toolbar" aria-label="排版工具">
        {TOOLS.map((t, i) =>
          t === "|" ? (
            <span key={i} className="tb-sep" aria-hidden />
          ) : (
            <button
              key={i}
              type="button"
              className={`key ${t.cls ?? ""}`}
              title={t.title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (t.cmd === "image" ? fileRef.current?.click() : exec(t.cmd, t.value))}
            >
              {t.label}
            </button>
          ),
        )}
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
      </div>
      <div
        ref={ref}
        className={`page-body ${dragOver ? "drag" : ""}`}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder="開始撰寫筆記…（支援 Ctrl+V 貼上圖片）"
        onInput={emit}
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
      <p className="editor-hint">提示：可直接貼上截圖或拖曳圖片；雙擊圖片可放大檢視；內容會自動儲存。</p>
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
