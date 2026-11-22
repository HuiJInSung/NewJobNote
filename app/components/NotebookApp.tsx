"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NoteEditor from "./NoteEditor";
import { LEVEL_LABEL, cjkNumber, type Level, type NodeDetail, type TreeNode } from "@/lib/types";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `請求失敗 (${res.status})`);
  return data as T;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function displayName(n: TreeNode) {
  return n.name || `未命名${LEVEL_LABEL[n.level]}`;
}

export default function NotebookApp() {
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [navOpen, setNavOpen] = useState(false);

  const pending = useRef<{ id: string; html: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadSeq = useRef(0);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  }, []);

  // ---------- derived ----------
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const childrenOf = useMemo(() => {
    const m = new Map<string | null, TreeNode[]>();
    for (const n of nodes) {
      if (!m.has(n.parentId)) m.set(n.parentId, []);
      m.get(n.parentId)!.push(n);
    }
    for (const list of m.values()) list.sort((a, b) => a.order - b.order);
    return m;
  }, [nodes]);
  const roots = useMemo(() => childrenOf.get(null) ?? [], [childrenOf]);

  const pathOf = useCallback(
    (id: string | null): TreeNode[] => {
      const out: TreeNode[] = [];
      let cur = id ? byId.get(id) : undefined;
      while (cur) {
        out.unshift(cur);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      return out;
    },
    [byId],
  );

  const descendantCount = useCallback(
    (id: string): number => {
      let count = 0;
      const stack = [id];
      while (stack.length) {
        const kids = childrenOf.get(stack.pop()!) ?? [];
        count += kids.length;
        stack.push(...kids.map((k) => k.id));
      }
      return count;
    },
    [childrenOf],
  );

  /** "一" for the first root, etc. */
  const rootNumber = useCallback(
    (id: string) => {
      const i = roots.findIndex((r) => r.id === id);
      return i >= 0 ? cjkNumber(i + 1) : "";
    },
    [roots],
  );

  // ---------- saving ----------
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const job = pending.current;
    if (!job) return;
    pending.current = null;
    setSaveState("saving");
    try {
      const { node } = await api<{ node: TreeNode }>(`/api/nodes/${job.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: job.html }),
      });
      setNodes((ns) => ns.map((n) => (n.id === node.id ? node : n)));
      setDetail((d) => (d && d.id === node.id ? { ...d, updatedAt: node.updatedAt, hasNote: node.hasNote } : d));
      setSaveState(pending.current ? "dirty" : "saved");
    } catch (e) {
      if (!pending.current) pending.current = job;
      setSaveState("error");
      showToast(e instanceof Error ? `儲存失敗：${e.message}` : "儲存失敗");
    }
  }, [showToast]);

  const onContentChange = useCallback(
    (id: string, html: string) => {
      pending.current = { id, html };
      setSaveState("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 1200);
    },
    [flush],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (pending.current) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [flush]);

  // ---------- loading ----------
  const loadDetail = useCallback(
    (id: string | null) => {
      const seq = ++loadSeq.current;
      if (!id) {
        setDetail(null);
        setDetailLoading(false);
        return;
      }
      setDetailLoading(true);
      api<{ node: NodeDetail }>(`/api/nodes/${id}`)
        .then(({ node }) => {
          if (seq === loadSeq.current) setDetail(node);
        })
        .catch((e) => {
          if (seq === loadSeq.current) showToast(e instanceof Error ? e.message : "讀取失敗");
        })
        .finally(() => {
          if (seq === loadSeq.current) setDetailLoading(false);
        });
    },
    [showToast],
  );

  useEffect(() => {
    api<{ nodes: TreeNode[] }>("/api/tree")
      .then(({ nodes }) => {
        setNodes(nodes);
        const fromHash = window.location.hash.slice(1);
        if (fromHash && nodes.some((n) => n.id === fromHash)) {
          setSelectedId(fromHash);
          loadDetail(fromHash);
          const ids = new Set<string>();
          let cur = nodes.find((n) => n.id === fromHash);
          while (cur?.parentId) {
            ids.add(cur.parentId);
            cur = nodes.find((n) => n.id === cur!.parentId);
          }
          setExpanded(ids);
        }
      })
      .catch((e) => setFatal(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [loadDetail]);

  const select = useCallback(
    async (id: string | null) => {
      await flush();
      setSaveState("idle");
      setSelectedId(id);
      loadDetail(id);
      setNavOpen(false);
      history.replaceState(null, "", id ? `#${id}` : window.location.pathname);
      if (id) {
        setExpanded((prev) => {
          const next = new Set(prev);
          for (const p of pathOf(id).slice(0, -1)) next.add(p.id);
          return next;
        });
      }
    },
    [flush, pathOf, loadDetail],
  );

  // ---------- mutations ----------
  const addNode = async (parentId: string | null, name: string) => {
    const { node } = await api<{ node: TreeNode }>("/api/nodes", {
      method: "POST",
      body: JSON.stringify({ parentId, name }),
    });
    setNodes((ns) => [...ns, node]);
    if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
    return node;
  };

  const rename = async (id: string, name: string) => {
    const { node } = await api<{ node: TreeNode }>(`/api/nodes/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    setNodes((ns) => ns.map((n) => (n.id === id ? node : n)));
    setDetail((d) => (d && d.id === id ? { ...d, name: node.name, updatedAt: node.updatedAt } : d));
  };

  const move = async (id: string, dir: "up" | "down") => {
    const { order } = await api<{ order: string[] }>(`/api/nodes/${id}/move`, {
      method: "POST",
      body: JSON.stringify({ dir }),
    });
    const pos = new Map(order.map((oid, i) => [oid, i]));
    setNodes((ns) => ns.map((n) => (pos.has(n.id) ? { ...n, order: pos.get(n.id)! } : n)));
  };

  const remove = async (id: string) => {
    const target = byId.get(id);
    if (pending.current?.id === id) pending.current = null;
    const { deleted } = await api<{ deleted: string[] }>(`/api/nodes/${id}`, { method: "DELETE" });
    const gone = new Set(deleted);
    if (pending.current && gone.has(pending.current.id)) pending.current = null;
    setNodes((ns) => ns.filter((n) => !gone.has(n.id)));
    if (selectedId && gone.has(selectedId)) void select(target?.parentId ?? null);
    showToast(
      `已刪除「${target ? displayName(target) : ""}」${deleted.length > 1 ? `及其下 ${deleted.length - 1} 個分類` : ""}`,
    );
  };

  const report = (e: unknown) => showToast(e instanceof Error ? e.message : String(e));

  // ---------- sidebar tree ----------
  const q = filter.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    const keep = new Set<string>();
    for (const n of nodes) {
      if (n.name.toLowerCase().includes(q)) {
        let cur: TreeNode | undefined = n;
        while (cur) {
          keep.add(cur.id);
          cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
      }
    }
    return keep;
  }, [q, nodes, byId]);

  const renderTree = (parentId: string | null, depth: number) => {
    const all = childrenOf.get(parentId) ?? [];
    const list = all.filter((n) => !matches || matches.has(n.id));
    if (!list.length) return null;
    return (
      <ul className={`tree depth-${depth}`}>
        {list.map((n) => {
          const kids = childrenOf.get(n.id) ?? [];
          const open = !!matches || expanded.has(n.id);
          return (
            <li key={n.id}>
              <div className={`tree-row lv${n.level} ${selectedId === n.id ? "active" : ""}`}>
                {kids.length > 0 ? (
                  <button
                    className={`twisty ${open ? "open" : ""}`}
                    aria-label={open ? "收合" : "展開"}
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(n.id)) next.delete(n.id);
                        else next.add(n.id);
                        return next;
                      })
                    }
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                      <path d="M3 1.5 7 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  </button>
                ) : (
                  <span className="twisty" aria-hidden />
                )}
                <button className="tree-name" onClick={() => void select(n.id)}>
                  {n.level === 1 && <span className="num-badge">{rootNumber(n.id)}</span>}
                  <span className={`label ${n.name ? "" : "placeholder"}`}>{displayName(n)}</span>
                  {n.hasNote && <span className="note-dot" title="已有筆記" />}
                  {kids.length > 0 && <span className="count">{kids.length}</span>}
                </button>
              </div>
              {open && renderTree(n.id, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => void select(null)}>
            <span className="brand-mark" aria-hidden>
              筆
            </span>
            <span className="brand-text">
              <strong>工作學習筆記</strong>
              <small>Knowledge Workspace</small>
            </span>
          </button>
          <div className="topbar-right">
            <span className={`status-pill ${saveState}`}>
              {{ idle: "已同步", dirty: "編輯中", saving: "儲存中…", saved: "已儲存", error: "儲存失敗" }[saveState]}
            </span>
            <button className="nav-toggle" onClick={() => setNavOpen((o) => !o)}>
              {navOpen ? "關閉目錄" : "分類目錄"}
            </button>
          </div>
        </div>
      </header>

      {fatal ? (
        <div className="fatal">
          <h2>無法連線資料庫</h2>
          <p>{fatal}</p>
          <p className="muted">請確認 .env.local 的 MONGODB_URI 正確，且 MongoDB Atlas 已允許目前的 IP 連線。</p>
        </div>
      ) : (
        <div className="layout">
          <aside className={`sidebar ${navOpen ? "open" : ""}`}>
            <div className="side-head">
              <span>分類目錄</span>
              <span className="side-meta">{nodes.length} 項</span>
            </div>
            <div className="search-wrap">
              <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden>
                <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="m20 20-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                className="search"
                placeholder="搜尋分類…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <nav className="tree-wrap">
              {loading ? <p className="muted pad">載入中…</p> : renderTree(null, 0)}
              {!loading && !roots.length && <p className="muted pad">尚無大類，請新增。</p>}
              {matches && matches.size === 0 && <p className="muted pad">找不到符合的分類。</p>}
            </nav>
            <AddInline
              label="新增大類"
              placeholder="大類名稱"
              onAdd={(name) =>
                addNode(null, name).then(
                  () => true,
                  (e) => {
                    report(e);
                    return false;
                  },
                )
              }
            />
          </aside>

          <main className="main">
            {loading ? (
              <p className="muted">載入中…</p>
            ) : !selectedId ? (
              <Home
                roots={roots}
                childrenOf={childrenOf}
                onOpen={(id) => void select(id)}
                onAdd={(name) =>
                  addNode(null, name).then(
                    () => true,
                    (e) => {
                      report(e);
                      return false;
                    },
                  )
                }
              />
            ) : (
              <NodePage
                key={selectedId}
                node={byId.get(selectedId)}
                detail={detail && detail.id === selectedId ? detail : null}
                detailLoading={detailLoading}
                path={pathOf(selectedId)}
                siblings={childrenOf.get(byId.get(selectedId)?.parentId ?? null) ?? []}
                kids={childrenOf.get(selectedId) ?? []}
                descendants={descendantCount(selectedId)}
                rootNumber={rootNumber}
                onSelect={(id) => void select(id)}
                onRename={(id, name) => rename(id, name).catch(report)}
                onAdd={(name) =>
                  addNode(selectedId, name).then(
                    () => true,
                    (e) => {
                      report(e);
                      return false;
                    },
                  )
                }
                onMove={(id, dir) => move(id, dir).catch(report)}
                onDelete={(id) => remove(id).catch(report)}
                onContentChange={onContentChange}
                onError={showToast}
              />
            )}
          </main>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

// ======================================================================

function AddInline({
  label,
  placeholder,
  onAdd,
}: {
  label: string;
  placeholder: string;
  onAdd: (name: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    const ok = await onAdd(v);
    setBusy(false);
    if (ok) setValue("");
  };
  return (
    <form className="add-form" onSubmit={submit}>
      <input value={value} maxLength={80} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} />
      <button className="btn primary" type="submit" disabled={!value.trim() || busy}>
        ＋ {label}
      </button>
    </form>
  );
}

// ======================================================================

function Home({
  roots,
  childrenOf,
  onOpen,
  onAdd,
}: {
  roots: TreeNode[];
  childrenOf: Map<string | null, TreeNode[]>;
  onOpen: (id: string) => void;
  onAdd: (name: string) => Promise<boolean>;
}) {
  const total = roots.reduce(
    (acc, r) => {
      const mids = childrenOf.get(r.id) ?? [];
      acc.mid += mids.length;
      acc.small += mids.reduce((s, m) => s + (childrenOf.get(m.id)?.length ?? 0), 0);
      return acc;
    },
    { mid: 0, small: 0 },
  );
  return (
    <section>
      <div className="page-head">
        <div>
          <p className="eyebrow">Overview</p>
          <h1 className="page-title">總覽</h1>
          <p className="page-desc">選擇一個大類開始；每個大類、中類、小分類都可以撰寫筆記並貼上圖片。</p>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <span className="stat-num">{roots.length}</span>
          <span className="stat-label">大類</span>
        </div>
        <div className="stat">
          <span className="stat-num">{total.mid}</span>
          <span className="stat-label">中類</span>
        </div>
        <div className="stat">
          <span className="stat-num">{total.small}</span>
          <span className="stat-label">小分類</span>
        </div>
      </div>

      <div className="card-grid">
        {roots.map((r, i) => {
          const mids = childrenOf.get(r.id) ?? [];
          const smalls = mids.reduce((s, m) => s + (childrenOf.get(m.id)?.length ?? 0), 0);
          return (
            <button key={r.id} className="cat-card" onClick={() => onOpen(r.id)}>
              <span className="cat-num">{cjkNumber(i + 1)}</span>
              <span className="cat-body">
                <span className={`cat-name ${r.name ? "" : "placeholder"}`}>{r.name || "點此命名"}</span>
                <span className="cat-meta">
                  中類 {mids.length}　小分類 {smalls}
                  {r.hasNote && <span className="tag">有筆記</span>}
                </span>
              </span>
              <span className="cat-arrow" aria-hidden>
                →
              </span>
            </button>
          );
        })}
      </div>

      <div className="panel add-panel">
        <h3 className="panel-title">新增大類</h3>
        <AddInline label="新增" placeholder="輸入大類名稱，例如：業務開發" onAdd={onAdd} />
      </div>
    </section>
  );
}

// ======================================================================

function NodePage(props: {
  node: TreeNode | undefined;
  detail: NodeDetail | null;
  detailLoading: boolean;
  path: TreeNode[];
  siblings: TreeNode[];
  kids: TreeNode[];
  descendants: number;
  rootNumber: (id: string) => string;
  onSelect: (id: string | null) => void;
  onRename: (id: string, name: string) => void;
  onAdd: (name: string) => Promise<boolean>;
  onMove: (id: string, dir: "up" | "down") => void;
  onDelete: (id: string) => void;
  onContentChange: (id: string, html: string) => void;
  onError: (msg: string) => void;
}) {
  const { node, detail, path, siblings, kids } = props;
  const [editing, setEditing] = useState(() => !!props.node && !props.node.name);
  const [nameDraft, setNameDraft] = useState(props.node?.name ?? "");
  const [confirmDel, setConfirmDel] = useState(false);

  if (!node) return <p className="muted">找不到這個分類。</p>;

  const level = node.level as Level;
  const childLevel = (level + 1) as Level;
  const idx = siblings.findIndex((s) => s.id === node.id);
  const crumbLabel = (p: TreeNode) =>
    p.level === 1 ? `${props.rootNumber(p.id)}、${displayName(p)}` : displayName(p);

  const commitName = () => {
    const v = nameDraft.trim();
    if (!v) {
      if (node.name) setEditing(false);
      return;
    }
    setEditing(false);
    if (v !== node.name) props.onRename(node.id, v);
  };

  return (
    <article className="node-page">
      <nav className="crumbs" aria-label="位置">
        <button onClick={() => props.onSelect(null)}>總覽</button>
        {path.map((p, i) => (
          <span key={p.id}>
            <span className="sep">/</span>
            {i === path.length - 1 ? (
              <span className="here">{crumbLabel(p)}</span>
            ) : (
              <button onClick={() => props.onSelect(p.id)}>{crumbLabel(p)}</button>
            )}
          </span>
        ))}
      </nav>

      <div className="page-head">
        <div className="head-main">
          <div className="badges">
            <span className={`level-badge lv${level}`}>
              {level === 1 ? `大類 ${props.rootNumber(node.id)}` : LEVEL_LABEL[level]}
            </span>
            {detail && <span className="meta">最後更新 {fmtDate(detail.updatedAt)}</span>}
          </div>
          {editing ? (
            <div className="title-edit">
              {level === 1 && <span className="title-num">{props.rootNumber(node.id)}、</span>}
              <input
                className="title-input"
                autoFocus
                value={nameDraft}
                maxLength={80}
                placeholder={`輸入${LEVEL_LABEL[level]}名稱後按 Enter`}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitName();
                  if (e.key === "Escape" && node.name) {
                    setNameDraft(node.name);
                    setEditing(false);
                  }
                }}
              />
            </div>
          ) : (
            <h1
              className="page-title editable"
              title="點擊修改名稱"
              onClick={() => {
                setNameDraft(node.name);
                setEditing(true);
              }}
            >
              {level === 1 && <span className="title-num">{props.rootNumber(node.id)}、</span>}
              {node.name}
              <span className="edit-hint">修改名稱</span>
            </h1>
          )}
        </div>

        <div className="head-actions">
          <button className="btn" disabled={idx <= 0} onClick={() => props.onMove(node.id, "up")} title="上移">
            ↑ 上移
          </button>
          <button
            className="btn"
            disabled={idx < 0 || idx >= siblings.length - 1}
            onClick={() => props.onMove(node.id, "down")}
            title="下移"
          >
            ↓ 下移
          </button>
          <button className="btn danger-outline" onClick={() => setConfirmDel(true)}>
            刪除
          </button>
        </div>
      </div>

      {confirmDel && (
        <div className="confirm-bar" role="alert">
          <span>
            確定刪除「{displayName(node)}」？
            {props.descendants > 0 && `底下 ${props.descendants} 個分類與所有筆記、圖片也會一併刪除，`}
            此動作無法復原。
          </span>
          <span className="confirm-actions">
            <button className="btn" onClick={() => setConfirmDel(false)}>
              取消
            </button>
            <button className="btn danger" onClick={() => props.onDelete(node.id)}>
              確定刪除
            </button>
          </span>
        </div>
      )}

      {level < 3 && (
        <section className="panel">
          <div className="panel-head">
            <h3 className="panel-title">
              {LEVEL_LABEL[childLevel]}
              <span className="panel-count">{kids.length}</span>
            </h3>
          </div>
          {kids.length > 0 ? (
            <ul className="kid-list">
              {kids.map((k, i) => (
                <li key={k.id}>
                  <button onClick={() => props.onSelect(k.id)}>
                    <span className="kid-index">{i + 1}</span>
                    <span className="kid-name">{displayName(k)}</span>
                    {k.hasNote && <span className="tag">有筆記</span>}
                    <span className="kid-arrow" aria-hidden>
                      →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">尚未建立{LEVEL_LABEL[childLevel]}。</p>
          )}
          <AddInline
            label={`新增${LEVEL_LABEL[childLevel]}`}
            placeholder={`${LEVEL_LABEL[childLevel]}名稱`}
            onAdd={props.onAdd}
          />
        </section>
      )}

      <section className="panel note-panel">
        <div className="panel-head">
          <h3 className="panel-title">筆記內容</h3>
        </div>
        {detail ? (
          <NoteEditor
            key={detail.id}
            nodeId={detail.id}
            initialHtml={detail.content}
            onChange={(html) => props.onContentChange(detail.id, html)}
            onError={props.onError}
          />
        ) : (
          <p className="muted">{props.detailLoading ? "載入中…" : "無法載入筆記"}</p>
        )}
      </section>
    </article>
  );
}
