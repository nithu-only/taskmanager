"use client";

import { useState } from "react";
import { Spark } from "@/components/process-drawer";
import { ErrorBanner, PageHeader, cx } from "@/components/ui";
import { useLive } from "@/lib/client";
import { SPECS, fmtDuration, fmtMem, type Sample, type SystemResponse } from "@/lib/types";

type MetricKey = "cpu" | "memory" | "disk" | "network" | "gpu";

interface MetricDef {
  key: MetricKey;
  label: string;
  device: string;
  color: string;
  series: number[];
  max: number;
  headline: string;
  axis: string;
  axisMax: string;
  stats: [string, string][];
  facts: [string, string][];
}

function Chart({ values, max, color, label }: { values: number[]; max: number; color: string; label: string }) {
  const N = 60;
  const list = values.slice(-N);
  // Spread whatever history exists across the full width, so a freshly started
  // server shows a short but readable line instead of a sliver at the right.
  const span = Math.max(1, list.length - 1);
  const pts = list.map((v, i) => [(i / span) * 100, 100 - Math.min(100, (v / max) * 100)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = pts.length > 0 ? `${pts[0][0].toFixed(2)},100 ${line} 100,100` : "";
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={label}>
      {Array.from({ length: 9 }).map((_, i) => (
        <g key={i} stroke={color} strokeOpacity="0.16" strokeWidth="1">
          <line x1={(i + 1) * 10} y1="0" x2={(i + 1) * 10} y2="100" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1={(i + 1) * 10} x2="100" y2={(i + 1) * 10} vectorEffect="non-scaling-stroke" />
        </g>
      ))}
      {area ? <polygon points={area} fill={color} opacity="0.16" /> : null}
      {line ? <polyline points={line} fill="none" stroke={color} strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round" /> : null}
    </svg>
  );
}

function windowLabel(hist: Sample[]): string {
  if (hist.length < 2) return "the last reading";
  const seconds = Math.round((hist[hist.length - 1].at - hist[0].at) / 1000);
  if (seconds <= 0) return "the last reading";
  if (seconds < 90) return `the last ${seconds} seconds`;
  return `the last ${Math.round(seconds / 60)} minutes`;
}

/** Short form of the sampling window for the chart's time axis. */
function windowSpan(hist: Sample[]): string | null {
  if (hist.length < 2) return null;
  const seconds = Math.round((hist[hist.length - 1].at - hist[0].at) / 1000);
  if (seconds <= 0) return null;
  return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

function buildMetrics(hist: Sample[], data: SystemResponse): MetricDef[] {
  const t = data.totals;
  const host = data.specs;
  const total = host?.memoryTotalMb || SPECS.memoryTotalMb;
  const baseGhz = host?.baseGhz || SPECS.baseGhz;
  const netSeries = hist.map((s) => s.networkMbps);
  const peak = Math.max(...netSeries, 0.1);
  const netMax = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((n) => n >= peak * 1.15) ?? 1000;
  const available = Math.max(0, total - t.memoryMb);
  return [
    {
      key: "cpu", label: "CPU", device: host?.cpuName ?? SPECS.cpuName, color: "var(--chart-cpu)", series: hist.map((s) => s.cpu), max: 100,
      headline: `${Math.round(t.cpu)}%`, axis: "% Utilization", axisMax: "100%",
      stats: [
        ["Utilization", `${Math.round(t.cpu)}%`],
        ["Processes", t.processes.toLocaleString("en-US")],
        ["Threads", t.threads.toLocaleString("en-US")],
        ["Handles", t.handles.toLocaleString("en-US")],
        ["Up time", fmtDuration(Date.parse(data.serverTime) - Date.parse(data.bootedAt))],
      ],
      facts: [["Base speed", `${baseGhz.toFixed(2)} GHz`], ["Cores", String(host?.cores ?? SPECS.cores)], ["Logical processors", String(host?.logical ?? SPECS.logical)]],
    },
    {
      key: "memory", label: "Memory", device: `${(total / 1024).toFixed(1)} GB installed`, color: "var(--chart-mem)", series: hist.map((s) => s.memoryPct), max: 100,
      headline: `${(t.memoryMb / 1024).toFixed(1)}/${(total / 1024).toFixed(1)} GB (${Math.round(t.memoryPct)}%)`, axis: "Memory usage", axisMax: fmtMem(total),
      stats: [
        ["In use", fmtMem(t.memoryMb)],
        ["Available", fmtMem(available)],
        ["Processes", t.processes.toLocaleString("en-US")],
      ],
      facts: [["Installed", fmtMem(total)], ["Available", fmtMem(available)], ["Working sets", `${fmtMem(t.processMemoryMb)} (shared pages counted per process)`]],
    },
    {
      key: "disk", label: "Disk activity", device: "All drives · process I/O", color: "var(--chart-disk)", series: hist.map((s) => s.diskPct), max: 100,
      headline: `${t.diskMbps.toFixed(1)} MB/s`, axis: "Throughput", axisMax: "100%",
      stats: [
        ["Total throughput", `${t.diskMbps.toFixed(1)} MB/s`],
        ["Read", `${(t.diskMbps * 0.6).toFixed(1)} MB/s`],
        ["Write", `${(t.diskMbps * 0.4).toFixed(1)} MB/s`],
      ],
      facts: [["Measured from", "Per-process I/O counters"]],
    },
    {
      key: "network", label: "Network", device: host?.networkName || SPECS.networkName, color: "var(--chart-net)", series: netSeries, max: netMax,
      headline: `${t.networkMbps.toFixed(1)} Mbps`, axis: "Throughput", axisMax: `${netMax} Mbps`,
      stats: [["Throughput", `${t.networkMbps.toFixed(1)} Mbps`]],
      facts: [["Adapter", host?.networkName || "All adapters"], ["Measured from", "Adapter byte counters"]],
    },
  ];
}

export default function PerformancePage() {
  const live = useLive<SystemResponse>("/api/system", 4000);
  const { data } = live;
  const [active, setActive] = useState<MetricKey>("cpu");

  // The server keeps the rolling history, so there is nothing to accumulate here.
  const hist = data?.history ?? [];
  const metrics = data && hist.length > 0 ? buildMetrics(hist, data) : null;
  const current = metrics?.find((m) => m.key === active) ?? null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <PageHeader title="Performance" subtitle={`Live usage of ${data?.specs?.hostName ?? SPECS.hostName}, sampled every few seconds.`} />
      {live.error ? <ErrorBanner message={live.error} onRetry={() => void live.refresh()} /> : null}

      <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        <div role="tablist" aria-label="Hardware" aria-orientation="vertical" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 lg:flex-col lg:overflow-visible">
          {metrics
            ? metrics.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="tab"
                  aria-selected={active === m.key}
                  onClick={() => setActive(m.key)}
                  className={cx(
                    "flex w-40 shrink-0 items-center gap-3 rounded-lg border bg-surface p-2.5 text-left lg:w-auto",
                    active === m.key ? "border-accent shadow-[inset_3px_0_0_var(--accent)]" : "border-line hover:bg-hover",
                  )}
                >
                  <span className="hidden h-10 w-16 shrink-0 overflow-hidden rounded border lg:block" style={{ borderColor: m.color }}>
                    <Spark values={m.series.map((v) => Math.min(v, m.max))} color={m.color} className="h-full w-full" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{m.label}</span>
                    <span className="block truncate text-xs text-muted tabular-nums">{m.headline}</span>
                  </span>
                </button>
              ))
            : Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-[62px] w-40 shrink-0 rounded-lg lg:w-auto" />)}
        </div>

        <section role="tabpanel" aria-label={current?.label ?? "Loading"} className="min-w-0 rounded-lg border border-line bg-surface p-4 sm:p-5">
          {current ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-2xl font-semibold">{current.label}</h2>
                <p className="min-w-0 truncate text-sm text-muted">{current.device}</p>
              </div>
              <div className="mt-4 flex justify-between text-xs text-muted">
                <span>{current.axis}</span>
                <span>{current.axisMax}</span>
              </div>
              <div className="mt-1 h-52 border sm:h-72" style={{ borderColor: current.color }}>
                <Chart values={current.series} max={current.max} color={current.color} label={`${current.label} over ${windowLabel(hist)}. Now: ${current.headline}`} />
              </div>
              <div className="mt-1 flex justify-between text-xs text-muted">
                <span>{windowSpan(hist) ? `${windowSpan(hist)} ago` : "oldest reading"}</span>
                <span>now</span>
              </div>

              <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                  {current.stats.map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <dt className="text-xs text-muted">{k}</dt>
                      <dd className="text-lg font-semibold tabular-nums sm:text-xl">{v}</dd>
                    </div>
                  ))}
                </dl>
                <dl className="space-y-1.5 text-sm">
                  {current.facts.map(([k, v]) => (
                    <div key={k} className="flex gap-3">
                      <dt className="w-36 shrink-0 text-muted">{k}:</dt>
                      <dd className="min-w-0 font-medium break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </>
          ) : (
            <div aria-busy="true" aria-label="Loading performance data">
              <div className="skeleton h-8 w-32" />
              <div className="skeleton mt-6 h-52 w-full sm:h-72" />
              <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="skeleton h-12" />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
