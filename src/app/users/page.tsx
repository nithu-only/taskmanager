"use client";

import { useState } from "react";
import { ChevronRight, Users } from "lucide-react";
import { EmptyState, ErrorBanner, PageHeader, Pill, ProcIcon, SeverityBadge, SkeletonRows, cx } from "@/components/ui";
import { useLive } from "@/lib/client";
import { SPECS, STATUS_LABEL, fmtMem, fmtPct, type ProcessDTO, type ProcessesResponse } from "@/lib/types";

const SESSION: Record<string, string> = {
  SYSTEM: "Built-in account that runs Windows itself",
  "LOCAL SERVICE": "Built-in account for services that stay on this PC",
  "NETWORK SERVICE": "Built-in account for services that use the network",
};

export default function UsersPage() {
  const live = useLive<ProcessesResponse>("/api/processes", 3000);
  const activeUser = live.data?.specs?.userName ?? "You";
  const [open, setOpen] = useState<Set<string>>(() => new Set([activeUser]));

  const groups = new Map<string, ProcessDTO[]>();
  for (const p of live.data?.processes ?? []) {
    const list = groups.get(p.userName) ?? [];
    list.push(p);
    groups.set(p.userName, list);
  }
  const users = Array.from(groups.entries())
    .map(([name, list]) => ({
      name,
      list: [...list].sort((a, b) => b.memoryMb - a.memoryMb),
      cpu: list.reduce((s, p) => s + p.cpu, 0),
      memory: list.reduce((s, p) => s + p.memoryMb, 0),
    }))
    .sort((a, b) => (a.name === activeUser ? -1 : b.name === activeUser ? 1 : b.memory - a.memory));

  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <PageHeader title="Users" subtitle="Which account each process runs under, and how much of the PC each account is using." />
      {live.error ? <ErrorBanner message={live.error} onRetry={() => void live.refresh()} /> : null}

      {!live.data ? (
        <div className="rounded-lg border border-line bg-surface">
          <SkeletonRows rows={5} cols={3} />
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<Users className="size-6" aria-hidden />} title="No one is running anything" body="There are no processes on this PC right now. Start a task from Processes, or use Refresh in the sidebar." />
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {users.map((u) => {
            const isOpen = open.has(u.name);
            const pct = Math.min(100, (u.memory / (live.data?.specs?.memoryTotalMb || SPECS.memoryTotalMb)) * 100);
            return (
              <li key={u.name} className="overflow-hidden rounded-lg border border-line bg-surface">
                <button type="button" onClick={() => toggle(u.name)} aria-expanded={isOpen} className="flex w-full items-center gap-3 p-3 text-left hover:bg-hover sm:p-4">
                  <ChevronRight className={cx("size-4 shrink-0 text-muted transition-transform", isOpen && "rotate-90")} aria-hidden />
                  <ProcIcon name={u.name} size="lg" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{u.name}</span>
                      {u.name === activeUser ? <Pill tone="good">Active</Pill> : <Pill>System</Pill>}
                      <span className="text-xs text-muted">{u.list.length} process{u.list.length === 1 ? "" : "es"}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">{SESSION[u.name] ?? "User account"}</span>
                    <span className="mt-2 block h-1 max-w-md overflow-hidden rounded-full bg-line">
                      <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(1, pct)}%`, backgroundColor: "var(--chart-mem)" }} />
                    </span>
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block text-sm font-semibold">{fmtMem(u.memory)}</span>
                    <span className="block text-xs text-muted">{fmtPct(u.cpu)} CPU</span>
                  </span>
                </button>
                {isOpen ? (
                  <ul className="@container divide-y divide-line border-t border-line">
                    {u.list.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-[13px] sm:px-4">
                        <ProcIcon name={p.name} />
                        <span className="min-w-0 flex-1 truncate" title={p.name}>
                          {p.name}
                          {p.status !== "running" ? <span className={cx("ml-2 text-xs", p.status === "not_responding" ? "font-medium text-sev-critical" : "text-muted")}>{STATUS_LABEL[p.status]}</span> : null}
                        </span>
                        <span className="hidden @xl:block">
                          <SeverityBadge severity={p.severity} />
                        </span>
                        <span className="w-14 shrink-0 text-right text-muted tabular-nums">{fmtPct(p.cpu)}</span>
                        <span className="w-20 shrink-0 text-right tabular-nums">{fmtMem(p.memoryMb)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
