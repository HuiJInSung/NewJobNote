"use client";

import { useEffect, useRef, useState } from "react";
import type { NodeDetail, TreeNode } from "@/lib/types";

type Format = "docx" | "pdf";

type Props = {
  roots: TreeNode[];
  rootNumber: (id: string) => string;
  /** top-level category to preselect (the one being viewed), or null for all */
  defaultRoot: string | null;
  /** save pending edits first */
  beforeExport: () => Promise<void>;
  onClose: () => void;
  onDone: (msg: string) => void;
};

const pad = (n: number) => String(n).padStart(2, "0");
const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 80);

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function ExportDialog({ roots, rootNumber, defaultRoot, beforeExport, onClose, onDone }: Props) {
  const [scope, setScope] = useState<string>(defaultRoot ?? "all");
  const [format, setFormat] = useState<Format>("docx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const rootLabel = (r: TreeNode) => `${rootNumber(r.id)}、${r.name || "未命名大類"}`;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await beforeExport();
      const res = await fetch(`/api/export?root=${encodeURIComponent(scope)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `讀取筆記失敗 (${res.status})`);

      const { buildTree, buildPdfBody } = await import("@/lib/export/model");
      const numbers = new Map(roots.map((r) => [r.id, rootNumber(r.id)]));
      const tree = buildTree(data.nodes as NodeDetail[], numbers);
      const root = roots.find((r) => r.id === scope);
      const now = new Date();
      const meta = {
        scope: root ? rootLabel(root) : "全部大類",
        date: `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
      };
      const fileBase = `工作學習筆記_${safeFileName(meta.scope)}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;

      let blob: Blob;
      if (format === "docx") {
        const { buildDocx } = await import("@/lib/export/docx");
        blob = await buildDocx(tree, meta);
      } else {
        const pdf = await fetch("/api/export/pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: `工作學習筆記－${meta.scope}`, body: buildPdfBody(tree, meta) }),
        });
        if (!pdf.ok) {
          const err = await pdf.json().catch(() => ({}));
          throw new Error(err.error ?? `PDF 產生失敗 (${pdf.status})`);
        }
        blob = await pdf.blob();
      }
      const name = `${fileBase}.${format}`;
      saveBlob(blob, name);
      onDone(`已下載 ${name}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title" tabIndex={-1} ref={dialogRef}>
        <div className="modal-head">
          <p className="eyebrow">Export</p>
          <h2 id="export-title" className="modal-title">
            匯出筆記
          </h2>
          <p className="modal-desc">將大類及其下所有中類、小分類的筆記打包成一個檔案下載，保留網頁上的排版。</p>
        </div>

        <label className="field">
          <span className="field-label">匯出範圍</span>
          <select className="field-select" value={scope} onChange={(e) => setScope(e.target.value)} disabled={busy}>
            <option value="all">全部大類（共 {roots.length} 個）</option>
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {rootLabel(r)}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="field">
          <legend className="field-label">檔案格式</legend>
          <div className="format-grid">
            {(
              [
                ["docx", "Word", ".docx，可再編輯"],
                ["pdf", "PDF", ".pdf，適合列印與分享"],
              ] as const
            ).map(([v, name, desc]) => (
              <label key={v} className={`format-card ${format === v ? "on" : ""}`}>
                <input type="radio" name="format" value={v} checked={format === v} onChange={() => setFormat(v)} disabled={busy} />
                <span className={`format-icon ${v}`} aria-hidden>
                  {v === "docx" ? "W" : "PDF"}
                </span>
                <span className="format-text">
                  <strong>{name}</strong>
                  <small>{desc}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <p className="modal-note">字體：jf open 粉圓 2.1　字級：14 pt　紙張：A4</p>
        {format === "docx" && <p className="modal-note muted">Word 檔需在已安裝「jf open 粉圓 2.1」字型的電腦上開啟，才會以粉圓顯示。</p>}
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn primary" onClick={() => void run()} disabled={busy}>
            {busy ? "產生中…" : "下載"}
          </button>
        </div>
      </div>
    </div>
  );
}
