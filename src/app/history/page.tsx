"use client";

import { useState } from "react";
import { Cog, Gauge, History, Monitor, Play, Rocket, SearchX, Trash2, XCircle } from "lucide-react";
import { Button, EmptyState, ErrorBanner, Modal, PageHeader, SeverityBadge, SkeletonRows, cx, useToast } from "@/components/ui";
import { api, errorMessage, useLive } from "@/lib/client";
import type { EventDTO } from "@/lib/types";

interface EventsResponse {
  events: EventDTO[];
}

const KINDS: { value: string; label: string; kinds: string[] }[] = [
  { value: "all", label: "All activity", kinds: [] },
  { value: "ended", label: "Ended tasks", kinds: ["ended"] },
  { value: "started", label: "Started tasks", kinds: ["started"] },
  { value: "changes", label: "Status and priority", kinds: ["status", "priority"] },
  { value: "service", label: "Services", kinds: ["service"] },
  { value: "startup", label: "Startup apps", kinds: ["startup"] },
  { value: "system", label: "System", kinds: ["system"] },
];

function KindIcon({ kind }: { kind: string }) {
  const cls = "size-4";
  if (kind === "ended") return <XCircle className={cls} aria-hidden />;
  if (kind === "started") return <Play className={cls} aria-hidden />;
  if (kind === "service") return <Cog className={cls} aria-hidden />;
  if (kind === "startup") return <Rocket className={cls} aria-hidden />;
  if (kind === "system") return <Monitor className={cls} aria-hidden />;
  return <Gauge className={cls} aria-hidden />;
}

function dayLabel(d: Date): string {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export default function HistoryPage() {
  const live = useLive<EventsResponse>("/api/events", 10000);
  const toast = useToast();
  const [filter, setFilter] = useState("all");
  const [confirmClear, setConfirmClear] = useState(false);
  const [rerunning, setRerunning] = useState<number | null>(null);

  const all = live.data?.events ?? [];
  const kinds = KINDS.find((k) => k.value === filter)?.kinds ?? [];
  const shown = kinds.length === 0 ? all : all.filter((e) => kinds.includes(e.kind));

  const days: { label: string; items: EventDTO[] }[] = [];
  for (const e of shown) {
    const label = dayLabel(new Date(e.createdAt));
    const last = days[days.length - 1];
    if (last && last.label === label) last.items.push(e);
    else days.push({ label, items: [e] });
  }

  const remove = async (e: EventDTO) => {
    try {
      await live.mutate(
        (d) => ({ events: d.events.filter((x) => x.id !== e.id) }),
        () => api(`/api/events/${e.id}`, { method: "DELETE" }),
      );
    } catch (err) {
      toast({ tone: "error", title: "Couldn't remove that entry", body: errorMessage(err) });
    }
  };

  const clear = async () => {
    setConfirmClear(false);
    try {
      await live.mutate(
        () => ({ events: [] }),
        () => api("/api/events", { method: "DELETE" }),
      );
      toast({ tone: "success", title: "Activity history cleared" });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't clear the history", body: errorMessage(err) });
    }
  };

  const rerun = async (e: EventDTO) => {
    if (!e.snapshot) return;
    setRerunning(e.id);
    try {
      const res = await live.mutate(null, () =>
        api<{ process: { name: string; pid: number } }>("/api/processes", { method: "POST", json: { ...e.snapshot!.process, children: e.snapshot!.children } }),
      );
      toast({ tone: "success", title: `Started ${res.process.name}`, body: `It is running again with PID ${res.process.pid}. Find it under Processes.` });
    } catch (err) {
      toast({ tone: "error", title: `Couldn't start ${e.snapshot.process.name}`, body: errorMessage(err) });
    } finally {
      setRerunning(null);
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <PageHeader
        title="Activity history"
        subtitle="Everything that was started, ended or changed from Task Manager. Start an ended task again with one click."
        actions={
          <Button variant="dangerOutline" disabled={all.length === 0} onClick={() => setConfirmClear(true)} icon={<Trash2 className="size-4" aria-hidden />}>
            Clear history
          </Button>
        }
      />

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filter activity">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            aria-pressed={filter === k.value}
            onClick={() => setFilter(k.value)}
            className={cx(
              "h-9 shrink-0 rounded-full border px-3.5 text-sm whitespace-nowrap",
              filter === k.value ? "border-accent bg-accent font-medium text-accent-fg" : "border-line-strong bg-surface hover:bg-hover",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>

      {live.error ? <ErrorBanner message={live.error} onRetry={() => void live.refresh()} /> : null}

      {!live.data ? (
        <div className="rounded-lg border border-line bg-surface">
          <SkeletonRows rows={7} cols={2} />
        </div>
      ) : all.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<History className="size-6" aria-hidden />} title="No activity yet" body="When you end, start or change a task, service or startup app, it shows up here so you can review or undo it." />
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState icon={<SearchX className="size-6" aria-hidden />} title="Nothing in this category" body="No activity of this kind has been recorded yet." action={<Button onClick={() => setFilter("all")}>Show all activity</Button>} />
        </div>
      ) : (
        days.map((day) => (
          <section key={day.label}>
            <h2 className="mb-2 text-sm font-semibold text-muted">{day.label}</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
              {day.items.map((e) => (
                <li key={e.id} className="flex gap-3 p-3 sm:p-4">
                  <span className={cx("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", e.severity === "critical" ? "bg-sev-critical/12 text-sev-critical" : "bg-surface-2 text-muted")}>
                    <KindIcon kind={e.kind} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="font-medium">{e.title}</p>
                      {e.severity !== "low" ? <SeverityBadge severity={e.severity} /> : null}
                    </div>
                    {e.detail ? <p className="mt-0.5 text-sm text-muted">{e.detail}</p> : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <time dateTime={e.createdAt} className="text-xs text-subtle tabular-nums">
                        {new Date(e.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                      </time>
                      {e.kind === "ended" && e.snapshot ? (
                        <Button size="sm" loading={rerunning === e.id} onClick={() => void rerun(e)} icon={<Play className="size-3.5" aria-hidden />}>
                          Run again
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <button type="button" onClick={() => void remove(e)} aria-label={`Remove “${e.title}” from history`} title="Remove from history" className="grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-line hover:text-fg">
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        size="sm"
        title="Clear all activity history?"
        description={`This removes all ${all.length} entries, including the option to run ended tasks again. Running processes are not affected.`}
        footer={
          <>
            <Button onClick={() => setConfirmClear(false)} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void clear()}>
              Clear history
            </Button>
          </>
        }
      />
    </div>
  );
}
