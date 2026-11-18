"use client";

import { useState } from "react";
import { Cog, Play, RotateCw, SearchX, Square } from "lucide-react";
import { Button, EmptyState, ErrorBanner, Modal, PageHeader, Pill, SEV_PANEL, SeverityBadge, SeverityIcon, SkeletonRows, cx, inputClass, useToast } from "@/components/ui";
import { api, errorMessage, useLive } from "@/lib/client";
import { SEVERITY_META, STARTUP_TYPES, STARTUP_TYPE_LABEL, type ServiceDTO, type StartupType } from "@/lib/types";

interface ServicesResponse {
  services: ServiceDTO[];
}

const iconBtn = "grid size-9 place-items-center rounded-md text-muted hover:bg-line hover:text-fg disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent";

export default function ServicesPage() {
  const live = useLive<ServicesResponse>("/api/services", 10000);
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "running" | "stopped">("all");
  const [stopping, setStopping] = useState<ServiceDTO | null>(null);

  const all = live.data?.services ?? [];
  const q = query.trim().toLowerCase();
  const shown = all
    .filter((s) => (filter === "all" || s.status === filter) && (q === "" || `${s.name} ${s.displayName} ${s.description} ${s.groupName} ${s.pid ?? ""}`.toLowerCase().includes(q)))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const running = all.filter((s) => s.status === "running").length;

  const act = async (s: ServiceDTO, action: "start" | "stop" | "restart") => {
    const done = action === "start" ? "Started" : action === "stop" ? "Stopped" : "Restarted";
    try {
      await live.mutate(
        (d) => ({
          services: d.services.map((x) => (x.id === s.id ? { ...x, status: action === "stop" ? ("stopped" as const) : ("running" as const), pid: action === "stop" ? null : x.pid } : x)),
        }),
        () => api(`/api/services/${s.id}`, { method: "PATCH", json: { action } }),
      );
      toast({ tone: "success", title: `${done} ${s.displayName}`, body: action === "stop" && SEVERITY_META[s.severity].rank > 0 ? s.impactNote : undefined });
    } catch (err) {
      toast({ tone: "error", title: `Couldn't ${action} ${s.displayName}`, body: errorMessage(err) });
    }
  };

  const setType = async (s: ServiceDTO, startupType: StartupType) => {
    try {
      await live.mutate(
        (d) => ({ services: d.services.map((x) => (x.id === s.id ? { ...x, startupType } : x)) }),
        () => api(`/api/services/${s.id}`, { method: "PATCH", json: { startupType } }),
      );
      toast({ tone: "success", title: `${s.displayName} startup type set to ${STARTUP_TYPE_LABEL[startupType]}` });
    } catch (err) {
      toast({ tone: "error", title: `Couldn't update ${s.displayName}`, body: errorMessage(err) });
    }
  };

  const requestStop = (s: ServiceDTO) => {
    if (SEVERITY_META[s.severity].rank === 0) void act(s, "stop");
    else setStopping(s);
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <PageHeader title="Services" subtitle="Background services that Windows and apps depend on. Start, stop or restart them, and choose how they start." />

      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, description or PID" aria-label="Search services" className={cx(inputClass, "min-w-0 flex-1 basis-48")} />
        <label>
          <span className="sr-only">Filter by status</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className={cx(inputClass, "w-auto", filter !== "all" && "border-accent font-medium")}>
            <option value="all">All services</option>
            <option value="running">Running</option>
            <option value="stopped">Stopped</option>
          </select>
        </label>
        <p className="w-full text-xs text-muted sm:w-auto" aria-live="polite">
          {live.data ? `${running} running · ${all.length - running} stopped` : "Loading services…"}
        </p>
      </div>

      {live.error ? <ErrorBanner message={live.error} onRetry={() => void live.refresh()} /> : null}

      <div className="@container overflow-hidden rounded-lg border border-line bg-surface">
        {!live.data ? (
          <SkeletonRows rows={10} cols={4} />
        ) : all.length === 0 ? (
          <EmptyState icon={<Cog className="size-6" aria-hidden />} title="No services found" body="Windows didn't return any services. Use Refresh in the sidebar to try again." />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<SearchX className="size-6" aria-hidden />}
            title="No services match"
            body="Try a different search or show all services."
            action={
              <Button
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                Clear search and filter
              </Button>
            }
          />
        ) : (
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs whitespace-nowrap text-muted">
                <th scope="col" className="border-b border-line bg-surface-2 px-3 py-2.5 font-medium">Name</th>
                <th scope="col" className="hidden border-b border-line bg-surface-2 px-3 py-2.5 text-right font-medium @2xl:table-cell">PID</th>
                <th scope="col" className="border-b border-line bg-surface-2 px-3 py-2.5 font-medium">Status</th>
                <th scope="col" className="hidden border-b border-line bg-surface-2 px-3 py-2.5 font-medium @xl:table-cell">If stopped</th>
                <th scope="col" className="hidden border-b border-line bg-surface-2 px-3 py-2.5 font-medium @3xl:table-cell">Startup type</th>
                <th scope="col" className="border-b border-line bg-surface-2 px-3 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const isRunning = s.status === "running";
                const protectedSvc = s.severity === "critical";
                return (
                  <tr key={s.id} className="hover:bg-hover">
                    <td className="w-full max-w-0 border-b border-line px-3 py-2">
                      <p className="truncate font-medium">
                        {s.displayName} <span className="font-normal text-muted">({s.name})</span>
                      </p>
                      <p className="truncate text-xs text-muted" title={s.description}>{s.description}</p>
                    </td>
                    <td className="hidden border-b border-line px-3 py-2 text-right text-muted tabular-nums @2xl:table-cell">{s.pid ?? "–"}</td>
                    <td className="border-b border-line px-3 py-2 whitespace-nowrap">
                      <Pill tone={isRunning ? "good" : "neutral"}>{isRunning ? "Running" : "Stopped"}</Pill>
                    </td>
                    <td className="hidden border-b border-line px-3 py-2 whitespace-nowrap @xl:table-cell">
                      <SeverityBadge severity={s.severity} title={`${SEVERITY_META[s.severity].label} risk if stopped: ${s.impactNote}`} />
                    </td>
                    <td className="hidden border-b border-line px-3 py-2 @3xl:table-cell">
                      <label>
                        <span className="sr-only">Startup type for {s.displayName}</span>
                        <select value={s.startupType} onChange={(e) => void setType(s, e.target.value as StartupType)} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-fg">
                          {STARTUP_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {STARTUP_TYPE_LABEL[t]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </td>
                    <td className="border-b border-line px-1 py-2 whitespace-nowrap">
                      <div className="flex justify-end">
                        {isRunning ? (
                          <button
                            type="button"
                            className={iconBtn}
                            disabled={protectedSvc}
                            onClick={() => requestStop(s)}
                            aria-label={`Stop ${s.displayName}`}
                            title={protectedSvc ? "Protected by Windows: this service can't be stopped" : "Stop"}
                          >
                            <Square className="size-4" aria-hidden />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={iconBtn}
                            disabled={s.startupType === "disabled"}
                            onClick={() => void act(s, "start")}
                            aria-label={`Start ${s.displayName}`}
                            title={s.startupType === "disabled" ? "Disabled: change the startup type first" : "Start"}
                          >
                            <Play className="size-4" aria-hidden />
                          </button>
                        )}
                        <button type="button" className={iconBtn} disabled={!isRunning} onClick={() => void act(s, "restart")} aria-label={`Restart ${s.displayName}`} title={isRunning ? "Restart" : "Only running services can be restarted"}>
                          <RotateCw className="size-4" aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={stopping !== null}
        onClose={() => setStopping(null)}
        title={`Stop ${stopping?.displayName ?? "service"}?`}
        description={stopping ? `${stopping.name} · ${stopping.description}` : undefined}
        footer={
          <>
            <Button onClick={() => setStopping(null)} data-autofocus>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const s = stopping;
                setStopping(null);
                if (s) void act(s, "stop");
              }}
            >
              Stop service
            </Button>
          </>
        }
      >
        {stopping ? (
          <div className={cx("rounded-lg border p-4", SEV_PANEL[stopping.severity])}>
            <div className="flex items-center gap-3">
              <SeverityIcon severity={stopping.severity} className="size-6 shrink-0" />
              <p className="font-semibold">
                {SEVERITY_META[stopping.severity].label} severity if stopped
              </p>
            </div>
            <p className="mt-2 text-sm text-fg">{stopping.impactNote}</p>
            <p className="mt-2 text-sm text-fg">You can start it again from this page at any time.</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
