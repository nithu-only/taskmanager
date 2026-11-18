"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Leaf, Pause, Pencil, Play, X, XCircle } from "lucide-react";
import {
  CATEGORY_SINGULAR,
  PRIORITIES,
  PRIORITY_LABEL,
  SEVERITY_META,
  STATUS_LABEL,
  fmtDuration,
  fmtMem,
  fmtPct,
  fmtRate,
  maxSeverity,
  type Priority,
  type ProcessDTO,
} from "@/lib/types";
import { Button, Pill, ProcIcon, SEV_PANEL, SeverityBadge, cx, inputClass } from "./ui";

export function Spark({ values, color, className }: { values: number[]; color: string; className?: string }) {
  const list = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const max = Math.max(...list, 0.001) * 1.2;
  const points = list.map((v, i) => `${((i / (list.length - 1)) * 100).toFixed(2)},${(30 - (v / max) * 28).toFixed(2)}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={className ?? "h-8 w-full"} aria-hidden>
      <polygon points={`0,30 ${points} 100,30`} fill={color} opacity="0.14" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <dt className="w-28 shrink-0 text-xs text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm break-words">{children}</dd>
    </div>
  );
}

export function ProcessDrawer({
  proc,
  kids,
  parent,
  history,
  now,
  onClose,
  onEnd,
  onToggleSuspend,
  onPriority,
  onEdit,
  onSelect,
}: {
  proc: ProcessDTO;
  kids: ProcessDTO[];
  parent: ProcessDTO | null;
  history: { cpu: number[]; mem: number[] } | undefined;
  now: number;
  onClose: () => void;
  onEnd: () => void;
  onToggleSuspend: () => void;
  onPriority: (p: Priority) => void;
  onEdit: () => void;
  onSelect: (id: number) => void;
}) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // On small screens the panel covers the page, so move focus into it.
    if (!window.matchMedia("(min-width: 1280px)").matches) closeBtn.current?.focus();
  }, []);

  const group = [proc, ...kids];
  const treeSeverity = maxSeverity(group.map((p) => p.severity));
  const cpuSeries = [...(history?.cpu ?? []), proc.cpu];
  const memSeries = [...(history?.mem ?? []), proc.memoryMb];
  const started = new Date(proc.startedAt);

  return (
    <aside aria-label={`Details for ${proc.name}`} className="fixed inset-0 z-40 flex justify-end xl:static xl:z-auto xl:w-[360px] xl:shrink-0">
      <div className="anim-fade absolute inset-0 bg-black/45 xl:hidden" onClick={onClose} aria-hidden />
      <div className="anim-slide relative flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl xl:max-w-none xl:rounded-lg xl:border xl:shadow-none">
        <div className="flex items-start gap-3 border-b border-line p-4">
          <ProcIcon name={parent ? parent.name : proc.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base leading-snug font-semibold break-words">{proc.name}</h2>
            <p className="truncate text-xs text-muted">
              {proc.imageName} · PID {proc.pid}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {proc.status === "not_responding" ? (
                <Pill tone="bad">Not responding</Pill>
              ) : proc.status === "suspended" ? (
                <Pill>
                  <Leaf className="size-3" aria-hidden />
                  Suspended
                </Pill>
              ) : (
                <Pill tone="good">Running</Pill>
              )}
              <SeverityBadge severity={proc.severity} />
            </div>
          </div>
          <button ref={closeBtn} type="button" onClick={onClose} aria-label="Close details" className="-mt-1 -mr-1 grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg">
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="dangerOutline"
              size="sm"
              disabled={proc.severity === "critical"}
              title={proc.severity === "critical" ? "Protected by Windows: this process can't be ended" : undefined}
              onClick={onEnd}
              icon={<XCircle className="size-4" aria-hidden />}
            >
              {proc.severity === "critical" ? "Protected by Windows" : kids.length > 0 ? "End process tree" : "End task"}
            </Button>
            {proc.status !== "not_responding" && proc.severity !== "critical" ? (
              <Button
                size="sm"
                onClick={onToggleSuspend}
                icon={proc.status === "suspended" ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
              >
                {proc.status === "suspended" ? "Resume" : "Suspend"}
              </Button>
            ) : null}
            <Button size="sm" onClick={onEdit} icon={<Pencil className="size-4" aria-hidden />}>
              Edit
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-line p-3">
              <p className="text-xs text-muted">CPU</p>
              <p className="text-lg font-semibold tabular-nums">{fmtPct(proc.cpu)}</p>
              <Spark values={cpuSeries} color="var(--chart-cpu)" />
            </div>
            <div className="rounded-lg border border-line p-3">
              <p className="text-xs text-muted">Memory</p>
              <p className="text-lg font-semibold tabular-nums">{fmtMem(proc.memoryMb)}</p>
              <Spark values={memSeries} color="var(--chart-mem)" />
            </div>
            <div className="rounded-lg border border-line p-3">
              <p className="text-xs text-muted">Disk</p>
              <p className="font-semibold tabular-nums">{fmtRate(proc.diskMbps, "MB/s")}</p>
            </div>
            <div className="rounded-lg border border-line p-3">
              <p className="text-xs text-muted">Network</p>
              <p className="font-semibold tabular-nums">{fmtRate(proc.networkMbps, "Mbps")}</p>
            </div>
          </div>

          <section className={cx("mt-4 rounded-lg border p-3", SEV_PANEL[treeSeverity])}>
            <h3 className="text-xs font-semibold tracking-wide uppercase">If you end this task</h3>
            <p className="mt-1 text-sm font-semibold">
              {SEVERITY_META[treeSeverity].label} severity · {SEVERITY_META[treeSeverity].summary}
            </p>
            <p className="mt-1 text-sm text-fg">{proc.impactNote || SEVERITY_META[treeSeverity].explain}</p>
            {proc.unsavedWork ? <p className="mt-1 text-sm font-medium text-fg">This task has unsaved work.</p> : null}
          </section>

          <h3 className="mt-5 mb-1 text-sm font-semibold">Details</h3>
          <dl className="divide-y divide-line">
            <Row label="Type">{CATEGORY_SINGULAR[proc.category]}</Row>
            <Row label="Status">{STATUS_LABEL[proc.status]}</Row>
            <Row label="User name">{proc.userName}</Row>
            <Row label="Priority">
              <label className="sr-only" htmlFor="drawer-priority">
                Priority for {proc.name}
              </label>
              <select id="drawer-priority" className={cx(inputClass, "h-8 sm:h-8")} value={proc.priority} onChange={(e) => onPriority(e.target.value as Priority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Architecture">{proc.architecture}</Row>
            <Row label="Threads">{proc.threads.toLocaleString("en-US")}</Row>
            <Row label="Handles">{proc.handles.toLocaleString("en-US")}</Row>
            <Row label="Running for">
              <span className="tabular-nums">{fmtDuration(now - started.getTime())}</span>
              <span className="block text-xs text-muted">
                since {started.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
            </Row>
            {proc.publisher ? <Row label="Publisher">{proc.publisher}</Row> : null}
            {proc.description ? <Row label="Description">{proc.description}</Row> : null}
            {proc.commandLine ? (
              <Row label="Command line">
                <code className="font-mono text-xs break-all">{proc.commandLine}</code>
              </Row>
            ) : null}
            {parent ? (
              <Row label="Parent">
                <button type="button" className="text-accent underline underline-offset-2" onClick={() => onSelect(parent.id)}>
                  {parent.name} (PID {parent.pid})
                </button>
              </Row>
            ) : null}
          </dl>

          {kids.length > 0 ? (
            <>
              <h3 className="mt-5 mb-1 text-sm font-semibold">Child processes ({kids.length})</h3>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {kids.map((k) => (
                  <li key={k.id}>
                    <button type="button" onClick={() => onSelect(k.id)} className="flex min-h-10 w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-hover">
                      <span className="min-w-0 flex-1 truncate">{k.name}</span>
                      <span className="shrink-0 text-xs text-muted tabular-nums">{fmtMem(k.memoryMb)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
