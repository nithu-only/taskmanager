"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronRight, Filter, Leaf, MoreHorizontal, PanelRight, Pause, Pencil, Play, Plus, Search, SearchX, Inbox, XCircle } from "lucide-react";
import { api, errorMessage, useLive } from "@/lib/client";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
  SEVERITIES,
  SEVERITY_META,
  SPECS,
  STATUSES,
  STATUS_LABEL,
  fmtMem,
  fmtPct,
  fmtRate,
  type Category,
  type Priority,
  type ProcStatus,
  type ProcessDTO,
  type ProcessesResponse,
  type Severity,
} from "@/lib/types";
import { treeClosure } from "@/lib/selection";
import { BulkEndDialog } from "./bulk-end-dialog";
import { EndTaskDialog } from "./end-task-dialog";
import { ProcessDrawer } from "./process-drawer";
import { ProcessFormDialog, type ProcessFormValues } from "./process-form-dialog";
import { Button, EmptyState, ErrorBanner, PageHeader, Pill, ProcIcon, SEV_BG, SeverityBadge, SkeletonRows, cx, inputClass, useToast } from "./ui";

type Variant = "processes" | "details";
type SortKey = "name" | "pid" | "status" | "user" | "cpu" | "memory" | "disk" | "network" | "severity" | "priority" | "arch" | "threads" | "handles" | "description";

interface Metrics {
  cpu: number;
  memoryMb: number;
  diskMbps: number;
  networkMbps: number;
}
interface RowNode extends Metrics {
  proc: ProcessDTO;
  kids: ProcessDTO[];
  shownKids: ProcessDTO[];
  forceOpen: boolean;
}
interface FlatRow {
  node: RowNode;
  p: ProcessDTO;
  child: boolean;
}
interface Col {
  key: SortKey;
  label: string;
  num?: boolean;
  cls?: string;
}

const PROCESS_COLS: Col[] = [
  { key: "name", label: "Name" },
  { key: "status", label: "Status", cls: "hidden @3xl:table-cell" },
  { key: "severity", label: "Severity", cls: "hidden @md:table-cell" },
  { key: "cpu", label: "CPU", num: true },
  { key: "memory", label: "Memory", num: true },
  { key: "disk", label: "Disk", num: true, cls: "hidden @4xl:table-cell" },
  { key: "network", label: "Network", num: true, cls: "hidden @4xl:table-cell" },
];

const DETAIL_COLS: Col[] = [
  { key: "name", label: "Name" },
  { key: "pid", label: "PID", num: true, cls: "hidden @sm:table-cell" },
  { key: "status", label: "Status", cls: "hidden @2xl:table-cell" },
  { key: "user", label: "User name", cls: "hidden @4xl:table-cell" },
  { key: "cpu", label: "CPU", num: true },
  { key: "memory", label: "Memory", num: true },
  { key: "severity", label: "Severity", cls: "hidden @lg:table-cell" },
  { key: "priority", label: "Priority", cls: "hidden @5xl:table-cell" },
  { key: "arch", label: "Arch", cls: "hidden @5xl:table-cell" },
  { key: "threads", label: "Threads", num: true, cls: "hidden @6xl:table-cell" },
  { key: "handles", label: "Handles", num: true, cls: "hidden @6xl:table-cell" },
  { key: "description", label: "Description", cls: "hidden @7xl:table-cell" },
];

const SORT_KEYS: SortKey[] = ["name", "pid", "status", "user", "cpu", "memory", "disk", "network", "severity", "priority", "arch", "threads", "handles", "description"];

const sortStorageKey = (variant: Variant) => `tm-${variant}-sort`;

// Reads a saved sort and rejects anything that is not a known column of this
// table, so a stale or hand-edited value falls back to the default.
function readSavedSort(variant: Variant, cols: Col[]): { key: SortKey; dir: 1 | -1 } | null {
  try {
    const raw = localStorage.getItem(sortStorageKey(variant));
    if (!raw) return null;
    const saved: unknown = JSON.parse(raw);
    if (typeof saved !== "object" || saved === null) return null;
    const { key, dir } = saved as { key?: unknown; dir?: unknown };
    if (typeof key !== "string" || !SORT_KEYS.includes(key as SortKey) || !cols.some((c) => c.key === key)) return null;
    if (dir !== 1 && dir !== -1) return null;
    return { key: key as SortKey, dir };
  } catch {
    return null;
  }
}

const DESC_FIRST: SortKey[] = ["cpu", "memory", "disk", "network", "threads", "handles", "severity"];

const HEAT = [0, 7, 14, 24, 36, 50];
const heat = (level: number) => (HEAT[level] ? `color-mix(in srgb, var(--heat) ${HEAT[level]}%, transparent)` : undefined);
const cpuLevel = (v: number) => (v < 0.1 ? 0 : v < 1 ? 1 : v < 5 ? 2 : v < 15 ? 3 : v < 40 ? 4 : 5);
const memLevel = (v: number) => (v < 20 ? 0 : v < 100 ? 1 : v < 400 ? 2 : v < 1000 ? 3 : v < 2500 ? 4 : 5);
const ioLevel = (v: number) => (v < 0.1 ? 0 : v < 1 ? 1 : v < 5 ? 2 : v < 20 ? 3 : 4);

function sortValue(key: SortKey, n: RowNode, variant: Variant): number | string {
  const p = n.proc;
  switch (key) {
    case "name": return (variant === "details" ? p.imageName : p.name).toLowerCase();
    case "pid": return p.pid;
    case "status": return STATUS_LABEL[p.status];
    case "user": return p.userName.toLowerCase();
    case "cpu": return n.cpu;
    case "memory": return n.memoryMb;
    case "disk": return n.diskMbps;
    case "network": return n.networkMbps;
    case "severity": return SEVERITY_META[p.severity].rank;
    case "priority": return PRIORITIES.indexOf(p.priority);
    case "arch": return p.architecture;
    case "threads": return p.threads;
    case "handles": return p.handles;
    case "description": return p.description.toLowerCase();
  }
}

function StatTile({ label, value, compact, unit, sub, pct, color }: { label: string; value: string; compact?: string; unit?: string; sub: string; pct: number; color: string }) {
  const tone = pct >= 90 ? "var(--sev-critical)" : color;
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface px-2.5 py-2 sm:px-3.5 sm:py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        <span className="hidden truncate text-xs text-subtle md:inline">{sub}</span>
      </div>
      <p className="mt-0.5 truncate text-base font-semibold tabular-nums sm:text-2xl">
        {compact ? (
          <>
            <span className="sm:hidden">{compact}</span>
            <span className="hidden sm:inline">{value}</span>
          </>
        ) : (
          value
        )}
        {unit ? <span className="ml-1 text-[11px] font-medium text-muted sm:text-sm">{unit}</span> : null}
      </p>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line sm:mt-2">
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(1, Math.min(100, pct))}%`, backgroundColor: tone }} />
      </div>
    </div>
  );
}

function FilterSelect<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <label className="min-w-0 flex-1 md:flex-none">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className={cx(inputClass, "md:w-auto", value !== "all" && "border-accent font-medium")}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function RowMenu({ x, y, proc, onClose, items }: { x: number; y: number; proc: ProcessDTO; onClose: () => void; items: { label: string; icon: ReactNode; danger?: boolean; note?: string; run: () => void }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current();
    };
    const close = () => closeRef.current();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, []);

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Tab") {
      onClose();
    }
  };

  const left = Math.max(8, Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 224));
  const top = Math.max(8, Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 800) - (items.length * 40 + 24)));
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Actions for ${proc.name}`}
      onKeyDown={onKey}
      className="anim-pop fixed z-50 w-52 rounded-lg border border-line bg-surface p-1 shadow-xl"
      style={{ left, top }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={Boolean(item.note)}
          title={item.note}
          onClick={() => {
            onClose();
            item.run();
          }}
          className={cx(
            "flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm hover:bg-hover",
            item.danger && "text-sev-critical",
            item.note && "cursor-not-allowed opacity-45 hover:bg-transparent",
          )}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

const TD = "border-b border-line px-2 py-1.5 align-middle @md:px-3";

export default function ProcessesView({ variant }: { variant: Variant }) {
  const [speed, setSpeed] = useState<number | null>(4000);
  const live = useLive<ProcessesResponse>("/api/processes", speed);
  const { data } = live;
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [fCategory, setFCategory] = useState<"all" | Category>("all");
  const [fStatus, setFStatus] = useState<"all" | ProcStatus>("all");
  const [fSeverity, setFSeverity] = useState<"all" | Severity>("all");
  const [fUser, setFUser] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>(variant === "processes" ? { key: "memory", dir: -1 } : { key: "name", dir: 1 });
  const [grouped, setGrouped] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(() => new Set());
  const [bulkEnd, setBulkEnd] = useState(false);
  const [endTarget, setEndTarget] = useState<number | null>(null);
  const [form, setForm] = useState<{ mode: "create"; draft?: ProcessFormValues; nonce: number } | { mode: "edit"; id: number; draft?: ProcessFormValues; nonce: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const nonce = useRef(0);

  const columns = variant === "processes" ? PROCESS_COLS : DETAIL_COLS;
  const now = data ? Date.parse(data.serverTime) : 0;

  /* Per-process usage history for the sparkline in the details panel. */
  const histRef = useRef(new Map<number, { cpu: number[]; mem: number[] }>());
  useEffect(() => {
    if (!data) return;
    const map = histRef.current;
    const seen = new Set<number>();
    for (const p of data.processes) {
      const h = map.get(p.id) ?? { cpu: [], mem: [] };
      h.cpu.push(p.cpu);
      h.mem.push(p.memoryMb);
      if (h.cpu.length > 40) {
        h.cpu.shift();
        h.mem.shift();
      }
      map.set(p.id, h);
      seen.add(p.id);
    }
    for (const key of Array.from(map.keys())) if (!seen.has(key)) map.delete(key);
  }, [data]);

  const model = useMemo(() => {
    const all = data?.processes ?? [];
    const byPid = new Map<number, ProcessDTO>();
    const byId = new Map<number, ProcessDTO>();
    for (const p of all) {
      byId.set(p.id, p);
      if (p.pid > 0) byPid.set(p.pid, p);
    }
    const kids = new Map<number, ProcessDTO[]>();
    for (const p of all) {
      if (p.parentPid != null && byPid.has(p.parentPid)) {
        const list = kids.get(p.parentPid) ?? [];
        list.push(p);
        kids.set(p.parentPid, list);
      }
    }
    const users = Array.from(new Set(all.map((p) => p.userName))).sort();
    return { all, byPid, byId, kids, users };
  }, [data]);

  const activeFilters = [fCategory, fStatus, fSeverity, fUser].filter((f) => f !== "all").length;
  const filtering = activeFilters > 0 || query.trim() !== "";

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (p: ProcessDTO) =>
      (fCategory === "all" || p.category === fCategory) &&
      (fStatus === "all" || p.status === fStatus) &&
      (fSeverity === "all" || p.severity === fSeverity) &&
      (fUser === "all" || p.userName === fUser) &&
      (q === "" || [p.name, p.imageName, String(p.pid), p.publisher, p.userName, p.description].some((s) => s.toLowerCase().includes(q)));

    let nodes: RowNode[];
    if (variant === "details") {
      nodes = model.all.filter(matches).map((p) => ({ proc: p, kids: [], shownKids: [], forceOpen: false, cpu: p.cpu, memoryMb: p.memoryMb, diskMbps: p.diskMbps, networkMbps: p.networkMbps }));
    } else {
      nodes = [];
      for (const p of model.all) {
        if (p.parentPid != null && model.byPid.has(p.parentPid)) continue;
        const kids = model.kids.get(p.pid) ?? [];
        const self = matches(p);
        const matchedKids = kids.filter(matches);
        if (!self && matchedKids.length === 0) continue;
        const group = [p, ...kids];
        nodes.push({
          proc: p,
          kids,
          shownKids: self ? kids : matchedKids,
          forceOpen: !self,
          cpu: group.reduce((s, x) => s + x.cpu, 0),
          memoryMb: group.reduce((s, x) => s + x.memoryMb, 0),
          diskMbps: group.reduce((s, x) => s + x.diskMbps, 0),
          networkMbps: group.reduce((s, x) => s + x.networkMbps, 0),
        });
      }
    }

    nodes.sort((a, b) => {
      const va = sortValue(sort.key, a, variant);
      const vb = sortValue(sort.key, b, variant);
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return c !== 0 ? c * sort.dir : a.proc.name.localeCompare(b.proc.name) || a.proc.pid - b.proc.pid;
    });

    const flatten = (list: RowNode[]): FlatRow[] =>
      list.flatMap((node) => {
        const open = node.shownKids.length > 0 && (node.forceOpen || expanded.has(node.proc.id));
        return [{ node, p: node.proc, child: false }, ...(open ? node.shownKids.map((k) => ({ node, p: k, child: true })) : [])];
      });

    const groups =
      variant === "processes" && grouped
        ? CATEGORIES.map((c) => ({ key: c as string, label: CATEGORY_LABEL[c] as string | null, count: 0, rows: flatten(nodes.filter((n) => n.proc.category === c)) }))
            .map((g) => ({ ...g, count: g.rows.filter((r) => !r.child).length }))
            .filter((g) => g.rows.length > 0)
        : [{ key: "all", label: null as string | null, count: nodes.length, rows: flatten(nodes) }];

    const visible = new Set<number>();
    const matching = new Set<number>();
    for (const g of groups) for (const r of g.rows) visible.add(r.p.id);
    for (const node of nodes) {
      if (matches(node.proc)) {
        matching.add(node.proc.id);
        for (const child of node.shownKids) matching.add(child.id);
      }
    }
    return { groups, results: nodes.length, visible, matching, firstId: groups[0]?.rows[0]?.p.id ?? null };
  }, [model, variant, query, fCategory, fStatus, fSeverity, fUser, sort, grouped, expanded]);

  // Tasks end on their own, so a selection can point at a PID that is already
  // gone. Filtering during render keeps the checkboxes correct without an
  // extra effect pass.
  const checked = useMemo(() => {
    if (checkedIds.size === 0) return checkedIds;
    const next = new Set<number>();
    for (const id of checkedIds) if (model.byId.has(id)) next.add(id);
    return next.size === checkedIds.size ? checkedIds : next;
  }, [checkedIds, model]);

  const selectedTasks = model.all.filter((p) => checked.has(p.id));
  const affectedTasks = treeClosure(selectedTasks.map((p) => p.id), model.all);
  const selectedMemory = affectedTasks.reduce((sum, p) => sum + p.memoryMb, 0);
  const allVisibleSelected = view.visible.size > 0 && [...view.visible].every((id) => checked.has(id));
  const someVisibleSelected = [...view.visible].some((id) => checked.has(id));
  const hiddenSelected = selectedTasks.filter((p) => !view.visible.has(p.id)).length;
  const canSuspend = selectedTasks.some((p) => p.status === "running" && p.severity !== "critical");
  const canResume = selectedTasks.some((p) => p.status === "suspended");

  const selected = selectedId != null ? (model.byId.get(selectedId) ?? null) : null;
  const selectedKids = selected ? (model.kids.get(selected.pid) ?? []) : [];
  const selectedParent = selected?.parentPid != null ? (model.byPid.get(selected.parentPid) ?? null) : null;
  const endProc = endTarget != null ? (model.byId.get(endTarget) ?? null) : null;
  const endKids = endProc ? (model.kids.get(endProc.pid) ?? []) : [];
  const menuProc = menu ? (model.byId.get(menu.id) ?? null) : null;
  const editProc = form?.mode === "edit" ? (model.byId.get(form.id) ?? null) : null;
  const tabStop = selectedId != null && view.visible.has(selectedId) ? selectedId : view.firstId;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || endTarget !== null || form || bulkEnd) return;
      if (menu) setMenu(null);
      else if (checked.size > 0) setCheckedIds(new Set());
      else if (selectedId !== null) setSelectedId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [endTarget, form, menu, selectedId, bulkEnd, checked]);

  const clearFilters = () => {
    setQuery("");
    setFCategory("all");
    setFStatus("all");
    setFSeverity("all");
    setFUser("all");
  };

  // Restore after mount rather than in the useState initialiser, which would
  // differ from the server render and cause a hydration mismatch.
  useEffect(() => {
    const saved = readSavedSort(variant, columns);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setSort(saved);
  }, [variant, columns]);

  const toggleSort = (key: SortKey) => {
    const next: { key: SortKey; dir: 1 | -1 } = sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: DESC_FIRST.includes(key) ? -1 : 1 };
    setSort(next);
    try {
      localStorage.setItem(sortStorageKey(variant), JSON.stringify(next));
    } catch {
      /* storage unavailable: the choice just won't persist */
    }
  };

  const setOpen = (id: number, open: boolean | "toggle") =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open === "toggle" ? !next.has(id) : open) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleSelection = (id: number) => {
    if (busy) return;
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      for (const id of view.visible) {
        if (allVisibleSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  /* ───────────── Actions ───────────── */

  const patchSelected = async (patch: { status?: "running" | "suspended"; priority?: Priority }) => {
    if (selectedTasks.length === 0 || busy) return;
    const ids = new Set(selectedTasks.map((p) => p.id));
    const eligible = new Set(selectedTasks.filter((p) =>
      patch.status === "suspended" ? p.status === "running" && p.severity !== "critical" :
      patch.status === "running" ? p.status === "suspended" : true,
    ).map((p) => p.id));
    if (eligible.size === 0) return;
    setBusy(true);
    const verb = patch.status === "suspended" ? "Suspended" : patch.status === "running" ? "Resumed" : "Changed priority of";
    try {
      const res = await live.mutate(
        (d) => ({
          ...d,
          processes: d.processes.map((p) => {
            if (!ids.has(p.id) || !eligible.has(p.id)) return p;
            const next = { ...p, ...patch };
            if (patch.status === "suspended") Object.assign(next, { cpu: 0, diskMbps: 0, networkMbps: 0 });
            return next;
          }),
        }),
        () => api<{ count: number }>("/api/processes/bulk", { method: "PATCH", json: { ids: [...ids], ...patch } }),
      );
      toast({ tone: "success", title: res.count ? `${verb} ${res.count} task${res.count === 1 ? "" : "s"}` : "Those tasks were already updated" });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't update the selected tasks", body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const confirmBulkEnd = async (force: boolean) => {
    if (selectedTasks.length === 0) return;
    const tasks = [...selectedTasks];
    const affected = treeClosure(tasks.map((p) => p.id), model.all);
    const ids = new Set(affected.map((p) => p.id));
    if (force) setBusy(true);
    else setBulkEnd(false);
    try {
      const res = await live.mutate(
        force ? null : (d) => ({ ...d, processes: d.processes.filter((p) => !ids.has(p.id)) }),
        () => api<{ skipped?: number }>("/api/processes/bulk", { method: "DELETE", json: { ids: tasks.map((p) => p.id), force } }),
      );
      setCheckedIds(new Set());
      toast({
        tone: "success",
        title: `Ended ${tasks.length} selected task${tasks.length === 1 ? "" : "s"}`,
        body: `${affected.length} process${affected.length === 1 ? "" : "es"} ended. Freed ${fmtMem(selectedMemory)} of memory.${res.skipped ? ` ${res.skipped} selected task${res.skipped === 1 ? " had" : "s had"} already ended.` : ""}`,
      });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't end the selected tasks", body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const patchProcess = async (p: ProcessDTO, patch: Partial<ProcessDTO>, okTitle: string, okBody?: string) => {
    try {
      const frozen = patch.status === "suspended" ? { cpu: 0, diskMbps: 0, networkMbps: 0 } : {};
      await live.mutate(
        (d) => ({ ...d, processes: d.processes.map((x) => (x.id === p.id ? { ...x, ...patch, ...frozen } : x)) }),
        () => api(`/api/processes/${p.id}`, { method: "PATCH", json: patch }),
      );
      toast({ tone: "success", title: okTitle, body: okBody });
      return true;
    } catch (err) {
      toast({ tone: "error", title: `Couldn't update ${p.name}`, body: errorMessage(err) });
      return false;
    }
  };

  const toggleSuspend = (p: ProcessDTO) =>
    p.status === "suspended"
      ? patchProcess(p, { status: "running" }, `Resumed ${p.name}`)
      : patchProcess(p, { status: "suspended" }, `Suspended ${p.name}`, "It keeps its memory but uses no CPU until you resume it.");

  const confirmEnd = async (force: boolean) => {
    const proc = endProc;
    if (!proc) return;
    const kids = model.kids.get(proc.pid) ?? [];
    const ids = new Set([proc.id, ...kids.map((k) => k.id)]);
    const freed = [proc, ...kids].reduce((s, p) => s + p.memoryMb, 0);
    if (force) setBusy(true);
    else setEndTarget(null);
    try {
      await live.mutate(
        force ? null : (d) => ({ ...d, processes: d.processes.filter((p) => !ids.has(p.id)) }),
        () => api<{ endedIds: number[] }>(`/api/processes/${proc.id}${force ? "?force=1" : ""}`, { method: "DELETE" }),
      );
      toast({ tone: "success", title: `Ended ${proc.name}`, body: `${kids.length > 0 ? `${kids.length + 1} processes ended. ` : ""}Freed ${fmtMem(freed)} of memory.` });
    } catch (err) {
      toast({ tone: "error", title: `Couldn't end ${proc.name}`, body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const submitForm = async (values: ProcessFormValues) => {
    const current = form;
    if (!current) return;
    setForm(null);
    if (current.mode === "edit") {
      const proc = model.byId.get(current.id);
      if (!proc) return;
      const patch = { priority: values.priority };
      const ok = await patchProcess(proc, patch, `Updated ${values.name}`, "Only the priority of a running process can be changed.");
      if (!ok) setForm({ mode: "edit", id: current.id, draft: values, nonce: ++nonce.current });
      return;
    }
    const payload = {
      ...(values.extra ?? {}),
      name: values.name,
      imageName: values.imageName,
      description: values.description,
      category: values.category,
      severity: values.severity,
      impactNote: values.impactNote,
      priority: values.priority,
      baseMemoryMb: values.baseMemoryMb,
      baseCpu: values.baseCpu,
    };
    const temp: ProcessDTO = {
      id: -Date.now(), pid: 0, parentPid: null, name: values.name, imageName: values.imageName, description: values.description,
      publisher: values.extra?.publisher ?? "", category: values.category, status: "running", severity: values.severity,
      impactNote: values.impactNote, unsavedWork: false, userName: "You", priority: values.priority, architecture: "x64",
      commandLine: values.extra?.commandLine ?? "", threads: 0, handles: 0, startedAt: new Date().toISOString(),
      cpu: 0, memoryMb: values.baseMemoryMb, diskMbps: 0, networkMbps: 0, gpu: 0,
    };
    try {
      const res = await live.mutate(
        (d) => ({ ...d, processes: [...d.processes, temp] }),
        () => api<{ process: ProcessDTO }>("/api/processes", { method: "POST", json: payload }),
      );
      toast({ tone: "success", title: `Started ${values.name}`, body: `${res.process.imageName} is running with PID ${res.process.pid}.` });
    } catch (err) {
      toast({ tone: "error", title: `Couldn't start ${values.name}`, body: errorMessage(err) });
      setForm({ mode: "create", draft: values, nonce: ++nonce.current });
    }
  };

  /* ───────────── Rows ───────────── */

  const onRowKey = (e: ReactKeyboardEvent<HTMLTableRowElement>, row: FlatRow) => {
    if (e.target !== e.currentTarget) return;
    const step = (dir: "nextElementSibling" | "previousElementSibling") => {
      let el = e.currentTarget[dir] as HTMLElement | null;
      while (el && !el.hasAttribute("data-row")) el = el[dir] as HTMLElement | null;
      el?.focus();
    };
    const hasKids = !row.child && row.node.kids.length > 0;
    if (e.key === "ArrowDown") { e.preventDefault(); step("nextElementSibling"); }
    else if (e.key === "ArrowUp") { e.preventDefault(); step("previousElementSibling"); }
    else if (e.key === " " && e.shiftKey) { e.preventDefault(); toggleSelection(row.p.id); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (row.p.id > 0) setSelectedId(row.p.id); }
    else if (e.key === "Delete") { e.preventDefault(); if (row.p.id > 0) setEndTarget(row.p.id); }
    else if (e.key === "ArrowRight" && hasKids) { e.preventDefault(); setOpen(row.p.id, true); }
    else if (e.key === "ArrowLeft" && hasKids) { e.preventDefault(); setOpen(row.p.id, false); }
  };

  const cell = (key: SortKey, p: ProcessDTO, m: Metrics): { content: ReactNode; bg?: string; cls?: string } => {
    switch (key) {
      case "status":
        return { content: STATUS_LABEL[p.status], cls: p.status === "not_responding" ? "font-medium text-sev-critical" : p.status === "suspended" ? "text-muted" : undefined };
      case "severity": return { content: <SeverityBadge severity={p.severity} /> };
      case "cpu": return { content: fmtPct(m.cpu), bg: heat(cpuLevel(m.cpu)) };
      case "memory": return { content: fmtMem(m.memoryMb), bg: heat(memLevel(m.memoryMb)) };
      case "disk": return { content: fmtRate(m.diskMbps, "MB/s"), bg: heat(ioLevel(m.diskMbps)) };
      case "network": return { content: fmtRate(m.networkMbps, "Mbps"), bg: heat(ioLevel(m.networkMbps)) };
      case "pid": return { content: p.pid || "–", cls: "text-muted" };
      case "user": return { content: p.userName };
      case "priority": return { content: PRIORITY_LABEL[p.priority] };
      case "arch": return { content: p.architecture };
      case "threads": return { content: p.threads.toLocaleString("en-US") };
      case "handles": return { content: p.handles.toLocaleString("en-US") };
      case "description": return { content: <span className="block max-w-[260px] truncate text-muted">{p.description}</span> };
      default: return { content: null };
    }
  };

  const renderRow = (row: FlatRow) => {
    const { node, p, child } = row;
    const m: Metrics = child ? p : node;
    const isSelected = p.id === selectedId;
    const isChecked = checked.has(p.id);
    const pending = p.id < 0;
    const hasKids = !child && node.kids.length > 0;
    const open = hasKids && node.shownKids.length > 0 && (node.forceOpen || expanded.has(p.id));
    const label = variant === "details" ? p.imageName : p.name;
    return (
      <tr
        key={p.id}
        data-row
        tabIndex={p.id === tabStop ? 0 : -1}
        aria-label={`${label}, ${STATUS_LABEL[p.status]}, memory ${fmtMem(m.memoryMb)}, CPU ${fmtPct(m.cpu)}, severity if closed ${SEVERITY_META[p.severity].label}`}
        aria-selected={isChecked}
        className={cx("cursor-default focus-visible:outline-2 focus-visible:-outline-offset-2", isSelected ? "bg-accent/10" : isChecked ? "bg-accent/5" : "hover:bg-hover", pending && "opacity-60")}
        onClick={() => !pending && setSelectedId(p.id)}
        onDoubleClick={() => hasKids && setOpen(p.id, "toggle")}
        onContextMenu={(e) => {
          if (pending) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, id: p.id });
        }}
        onKeyDown={(e) => onRowKey(e, row)}
      >
        <td className={cx(TD, "w-8 pr-1 @md:pr-2", isChecked && "shadow-[inset_3px_0_0_var(--accent)]")} onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            className="size-4 cursor-pointer accent-(--accent)"
            aria-label={`Select ${label}`}
            checked={isChecked}
            disabled={pending || busy}
            onChange={() => toggleSelection(p.id)}
            onClick={(e) => e.stopPropagation()}
          />
        </td>
        <td className={cx(TD, "w-full max-w-0", isSelected && "shadow-[inset_3px_0_0_var(--accent)]")}>
          <div className={cx("flex min-w-0 items-center gap-2 overflow-hidden", child && "pl-5 @md:pl-8")}>
            {variant === "processes" && !child ? (
              hasKids ? (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`${open ? "Collapse" : "Expand"} ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(p.id, "toggle");
                  }}
                  className="-mx-1 grid size-7 shrink-0 place-items-center rounded text-muted hover:bg-line hover:text-fg"
                >
                  <ChevronRight className={cx("size-4 transition-transform", open && "rotate-90")} aria-hidden />
                </button>
              ) : (
                <span className="w-5 shrink-0" />
              )
            ) : null}
            <ProcIcon name={variant === "details" ? p.imageName : child ? node.proc.name : p.name} />
            <span className="min-w-0 truncate" title={label}>
              {label}
              {hasKids && variant === "processes" ? <span className="text-muted"> ({node.kids.length + 1})</span> : null}
              {variant === "details" && p.name !== p.imageName ? <span className="text-muted"> · {p.name}</span> : null}
            </span>
            {pending ? (
              <Pill>Starting…</Pill>
            ) : p.status === "not_responding" ? (
              <>
                <span className={cx("hidden shrink-0", variant === "processes" ? "@lg:inline @3xl:hidden" : "@lg:inline @2xl:hidden")}>
                  <Pill tone="bad">Not responding</Pill>
                </span>
                <span className="shrink-0 @lg:hidden" title="Not responding">
                  <AlertTriangle className="size-4 text-sev-critical" aria-label="Not responding" />
                </span>
              </>
            ) : p.status === "suspended" ? (
              <span className={cx("shrink-0", variant === "processes" ? "@3xl:hidden" : "@2xl:hidden")} title="Suspended">
                <Leaf className="size-3.5 text-sev-low" aria-label="Suspended" />
              </span>
            ) : null}
            <span className={cx("size-2 shrink-0 rounded-full", SEV_BG[p.severity], variant === "processes" ? "@md:hidden" : "@lg:hidden")} title={`${SEVERITY_META[p.severity].label} severity if closed`} />
          </div>
        </td>
        {columns.slice(1).map((col) => {
          const c = cell(col.key, p, m);
          return (
            <td key={col.key} className={cx(TD, "whitespace-nowrap", col.num && "text-right tabular-nums", col.cls, c.cls)} style={c.bg ? { backgroundColor: c.bg } : undefined}>
              {c.content}
            </td>
          );
        })}
        <td className={cx(TD, "hidden w-10 px-1 text-right @md:table-cell @md:px-1")}>
          {!pending ? (
            <button
              type="button"
              aria-label={`Actions for ${label}`}
              aria-haspopup="menu"
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({ x: r.right - 208, y: r.bottom + 4, id: p.id });
              }}
              className="grid size-8 place-items-center rounded-md text-muted hover:bg-line hover:text-fg"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          ) : null}
        </td>
      </tr>
    );
  };

  const t = data?.totals;
  const speedValue = speed === null ? "paused" : String(speed);

  return (
    <div className="flex h-full min-h-[600px] flex-col gap-3">
      <PageHeader
        title={variant === "processes" ? "Processes" : "Details"}
        subtitle={
          variant === "processes"
            ? "Everything running on this PC, with what each task uses and how risky it is to end."
            : "Every process on its own row, with PID, user, priority and other technical details."
        }
        actions={
          <>
            <Button variant="primary" onClick={() => setForm({ mode: "create", nonce: ++nonce.current })} icon={<Plus className="size-4" aria-hidden />}>
              Run new task
            </Button>
            <Button
              variant="dangerOutline"
              disabled={!selected || selected.severity === "critical"}
              title={
                !selected
                  ? "Select a process first"
                  : selected.severity === "critical"
                    ? "Protected by Windows: this process can't be ended"
                    : `End ${selected.name}`
              }
              onClick={() => selected && setEndTarget(selected.id)}
              icon={<XCircle className="size-4" aria-hidden />}
            >
              End task
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-4 gap-2">
        <StatTile label="CPU" value={t ? `${Math.round(t.cpu)}%` : "–"} sub={`${live.data?.specs?.logical ?? SPECS.logical} logical processors`} pct={t?.cpu ?? 0} color="var(--chart-cpu)" />
        <StatTile label="Memory" value={t ? `${Math.round(t.memoryPct)}%` : "–"} sub={t ? `${fmtMem(t.memoryMb)} of ${fmtMem(live.data?.specs?.memoryTotalMb ?? SPECS.memoryTotalMb)}` : ""} pct={t?.memoryPct ?? 0} color="var(--chart-mem)" />
        <StatTile label="Disk" value={t ? `${Math.round(t.diskPct)}%` : "–"} sub={t ? fmtRate(t.diskMbps, "MB/s") : ""} pct={t?.diskPct ?? 0} color="var(--chart-disk)" />
        <StatTile label="Network" value={t ? t.networkMbps.toFixed(1) : "–"} compact={t ? String(Math.round(t.networkMbps)) : undefined} unit="Mbps" sub={live.data?.specs?.networkName || "All adapters"} pct={t ? Math.min(89, t.networkMbps) : 0} color="var(--chart-net)" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-48">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, PID or user"
            aria-label="Search processes"
            className={cx(inputClass, "pl-8")}
          />
        </div>
        <Button className="md:hidden" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters} icon={<Filter className="size-4" aria-hidden />}>
          Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
        </Button>
        <div className={cx("w-full flex-wrap items-center gap-2 md:flex md:w-auto", showFilters ? "flex" : "hidden")}>
          <FilterSelect label="Filter by type" value={fCategory} onChange={setFCategory} options={[{ value: "all", label: "All types" }, ...CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))]} />
          <FilterSelect label="Filter by status" value={fStatus} onChange={setFStatus} options={[{ value: "all", label: "Any status" }, ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} />
          <FilterSelect label="Filter by severity if closed" value={fSeverity} onChange={setFSeverity} options={[{ value: "all", label: "Any severity" }, ...SEVERITIES.map((s) => ({ value: s, label: `${SEVERITY_META[s].label} severity` }))]} />
          <FilterSelect label="Filter by user" value={fUser} onChange={setFUser} options={[{ value: "all", label: "All users" }, ...model.users.map((u) => ({ value: u, label: u }))]} />
          {filtering ? (
            <Button variant="ghost" onClick={clearFilters}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {selectedTasks.length > 0 ? (
        <div className="selection-toolbar flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/8 px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="grid h-6 min-w-6 place-items-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-fg" aria-live="polite">
              {selectedTasks.length}
            </span>
            <span className="text-sm font-medium">selected</span>
            {hiddenSelected > 0 ? <span className="hidden text-xs text-muted sm:inline">· {hiddenSelected} hidden by filters</span> : null}
            <button type="button" onClick={() => setCheckedIds(new Set())} disabled={busy} aria-label="Clear selection" title="Clear selection" className="grid size-7 place-items-center rounded-md text-muted hover:bg-line hover:text-fg disabled:opacity-40">
              <XCircle className="size-4" aria-hidden />
            </button>
            {allVisibleSelected && view.matching.size > view.visible.size ? (
              <button type="button" onClick={() => setCheckedIds(new Set(view.matching))} className="text-xs font-medium text-accent underline underline-offset-2">
                Select all {view.matching.size} matching
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy || !canSuspend} onClick={() => void patchSelected({ status: "suspended" })} icon={<Pause className="size-3.5" aria-hidden />}>
              Suspend
            </Button>
            <Button size="sm" disabled={busy || !canResume} onClick={() => void patchSelected({ status: "running" })} icon={<Play className="size-3.5" aria-hidden />}>
              Resume
            </Button>
            <label>
              <span className="sr-only">Set priority for selected tasks</span>
              <select
                aria-label="Set priority for selected tasks"
                value=""
                disabled={busy}
                onChange={(e) => e.target.value && void patchSelected({ priority: e.target.value as Priority })}
                className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-fg"
              >
                <option value="" disabled>Set priority</option>
                {PRIORITIES.map((priority) => <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>)}
              </select>
            </label>
            <Button size="sm" variant="dangerOutline" disabled={busy} onClick={() => setBulkEnd(true)} icon={<XCircle className="size-3.5" aria-hidden />}>
              End {selectedTasks.length === 1 ? "task" : "tasks"}
            </Button>
          </div>
        </div>
      ) : null}

      {live.error ? <ErrorBanner message={live.error} onRetry={() => void live.refresh()} /> : null}

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="@container min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border border-line bg-surface">
          {!data ? (
            live.error ? (
              <EmptyState icon={<Inbox className="size-6" aria-hidden />} title="Processes couldn't be loaded" body="Check your connection, then try again." action={<Button onClick={() => void live.refresh()}>Try again</Button>} />
            ) : (
              <SkeletonRows rows={12} />
            )
          ) : model.all.length === 0 ? (
            <EmptyState
              icon={<Inbox className="size-6" aria-hidden />}
              title="Nothing is running"
              body="Every task on this PC has been ended. Start a program to see it here."
              action={
                <Button variant="primary" onClick={() => setForm({ mode: "create", nonce: ++nonce.current })} icon={<Plus className="size-4" aria-hidden />}>
                  Run new task
                </Button>
              }
            />
          ) : view.results === 0 ? (
            <EmptyState
              icon={<SearchX className="size-6" aria-hidden />}
              title="No processes match"
              body={query.trim() ? `Nothing matches “${query.trim()}” with the current filters.` : "No process matches the filters you picked."}
              action={<Button onClick={clearFilters}>Clear search and filters</Button>}
            />
          ) : (
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <caption className="sr-only">
                {variant === "processes" ? "Running processes grouped by type" : "All processes"}. Use arrow keys to move between rows, Enter for details, Space to select, Shift+Space for multi-selection and Delete to end a task.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky top-0 z-10 w-8 border-b border-line bg-surface-2 py-2 pr-1 text-left @md:pr-2">
                    <input
                      type="checkbox"
                      aria-label="Select all visible processes"
                      ref={(el) => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                      checked={allVisibleSelected}
                      disabled={busy}
                      onChange={toggleAllVisible}
                      className="size-4 cursor-pointer accent-(--accent) disabled:cursor-not-allowed"
                    />
                  </th>
                  {columns.map((col) => {
                    const active = sort.key === col.key;
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                        className={cx("sticky top-0 z-10 border-b border-line bg-surface-2 px-2 text-left text-xs font-medium whitespace-nowrap text-muted @md:px-3", col.num && "text-right", col.cls)}
                      >
                        <button type="button" onClick={() => toggleSort(col.key)} className={cx("inline-flex h-9 items-center gap-1 hover:text-fg", active && "font-semibold text-fg")}>
                          {col.label}
                          {active ? sort.dir === 1 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden /> : null}
                        </button>
                      </th>
                    );
                  })}
                  <th scope="col" className="sticky top-0 z-10 hidden border-b border-line bg-surface-2 @md:table-cell">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.groups.flatMap((g) => [
                  g.label ? (
                    <tr key={`group-${g.key}`}>
                      <th scope="colgroup" colSpan={columns.length + 2} className="border-b border-line px-3 pt-4 pb-1.5 text-left text-[13px] font-semibold text-accent">
                        {g.label} <span className="font-normal text-muted">({g.count})</span>
                      </th>
                    </tr>
                  ) : null,
                  ...g.rows.map(renderRow),
                ])}
              </tbody>
            </table>
          )}
        </div>

        {selected ? (
          <ProcessDrawer
            proc={selected}
            kids={selectedKids}
            parent={selectedParent}
            // The rolling sparkline buffer lives in a ref because it is display-only
            // data that is rewritten on every poll; reading it here cannot cause a
            // stale render because `data` changes first and re-renders this view.
            // eslint-disable-next-line react-hooks/refs
            history={histRef.current.get(selected.id)}
            now={now}
            onClose={() => setSelectedId(null)}
            onEnd={() => setEndTarget(selected.id)}
            onToggleSuspend={() => void toggleSuspend(selected)}
            onPriority={(priority: Priority) => void patchProcess(selected, { priority }, `Priority of ${selected.name} set to ${PRIORITY_LABEL[priority]}`)}
            onEdit={() => setForm({ mode: "edit", id: selected.id, nonce: ++nonce.current })}
            onSelect={setSelectedId}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
        <p aria-live="polite">
          {data ? (filtering ? `${view.results} of ${model.all.length} processes shown` : `${model.all.length} processes`) : "Loading processes…"}
          {t ? ` · ${t.threads.toLocaleString("en-US")} threads` : ""}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          {variant === "processes" ? (
            <label className="flex min-h-8 cursor-pointer items-center gap-2">
              <input type="checkbox" className="size-4 accent-(--accent)" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
              Group by type
            </label>
          ) : null}
          <label className="flex items-center gap-2" title="Windows is measured about once every 4 seconds, so refreshing faster than that only re-shows the same reading.">
            Update speed
            <select
              value={speedValue}
              onChange={(e) => setSpeed(e.target.value === "paused" ? null : Number(e.target.value))}
              className="h-8 rounded-md border border-line-strong bg-surface px-2 text-xs text-fg"
            >
              <option value="4000">Every 4 s</option>
              <option value="8000">Every 8 s</option>
              <option value="15000">Every 15 s</option>
              <option value="paused">Paused</option>
            </select>
          </label>
        </div>
      </div>

      {menu && menuProc ? (
        <RowMenu
          x={menu.x}
          y={menu.y}
          proc={menuProc}
          onClose={() => setMenu(null)}
          items={[
            { label: "Open details", icon: <PanelRight className="size-4" aria-hidden />, run: () => setSelectedId(menuProc.id) },
            ...(menuProc.status !== "not_responding" && menuProc.severity !== "critical"
              ? [
                  menuProc.status === "suspended"
                    ? { label: "Resume", icon: <Play className="size-4" aria-hidden />, run: () => void toggleSuspend(menuProc) }
                    : { label: "Suspend", icon: <Pause className="size-4" aria-hidden />, run: () => void toggleSuspend(menuProc) },
                ]
              : []),
            { label: "Edit properties", icon: <Pencil className="size-4" aria-hidden />, run: () => setForm({ mode: "edit", id: menuProc.id, nonce: ++nonce.current }) },
            { label: (model.kids.get(menuProc.pid)?.length ?? 0) > 0 ? "End process tree" : "End task", icon: <XCircle className="size-4" aria-hidden />, danger: true, note: menuProc.severity === "critical" ? "Protected by Windows: this process can't be ended" : undefined, run: () => setEndTarget(menuProc.id) },
          ]}
        />
      ) : null}

      <EndTaskDialog proc={endProc} kids={endKids} busy={busy} onCancel={() => setEndTarget(null)} onConfirm={(force) => void confirmEnd(force)} />
      {bulkEnd && selectedTasks.length > 0 ? (
        <BulkEndDialog selected={selectedTasks} all={model.all} busy={busy} onCancel={() => setBulkEnd(false)} onConfirm={(force) => void confirmBulkEnd(force)} />
      ) : null}

      {form?.mode === "create" ? <ProcessFormDialog key={`c${form.nonce}`} mode="create" draft={form.draft} onClose={() => setForm(null)} onSubmit={(v) => void submitForm(v)} /> : null}
      {form?.mode === "edit" && editProc ? (
        <ProcessFormDialog key={`e${form.nonce}`} mode="edit" initial={editProc} draft={form.draft} onClose={() => setForm(null)} onSubmit={(v) => void submitForm(v)} />
      ) : null}
    </div>
  );
}
