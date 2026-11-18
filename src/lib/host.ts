import { execFile, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import type { Sample } from "./types";

/**
 * Server-only bridge to the host machine.
 *
 * A long-lived PowerShell sampler (scripts/sampler.ps1) streams one JSON line
 * per tick. Everything here keeps the newest snapshot in memory, so API routes
 * never wait on the OS: a request just reads the cache.
 *
 * There is no database. Process data is live by definition, and the activity
 * log only needs to survive as long as the app is running.
 */

const IS_WINDOWS = process.platform === "win32";
const SCRIPTS = path.join(process.cwd(), "scripts");

export interface RawProcess {
  pid: number;
  ppid: number;
  name: string;
  wsMb: number;
  threads: number;
  handles: number;
  ioBytes: number;
  cpuSec: number;
  cmd: string;
  exe: string;
  started: string | null;
  session: number;
  responding: boolean;
  priority: string;
  company: string;
  description: string;
}

export interface RawSample {
  at: number;
  cores: number;
  totalMb: number;
  freeMb: number;
  networkMbps: number;
  processes: RawProcess[];
}

export interface HostInfo {
  hostName: string;
  os: string;
  osVersion: string;
  cpuName: string;
  cores: number;
  logical: number;
  baseGhz: number;
  memoryTotalMb: number;
  userName: string;
  networkName: string;
  bootedAt: string;
}

export type { Sample } from "./types";

interface Derived {
  at: number;
  sample: Sample;
  processes: RawProcess[];
  cpuByPid: Map<number, number>;
  diskByPid: Map<number, number>;
}

interface HostState {
  child?: ChildProcess;
  info?: HostInfo;
  latest?: Derived;
  prev?: RawSample;
  prevMap: Map<number, { cpu: number; io: number }>;
  history: Sample[];
  suspended: Set<number>;
  ready?: Promise<void>;
  resolveReady?: () => void;
  lastError?: string;
  stopping: boolean;
  restarts: number;
}

const globalForHost = globalThis as typeof globalThis & { __taskManagerHost?: HostState };

function state(): HostState {
  if (!globalForHost.__taskManagerHost) {
    globalForHost.__taskManagerHost = {
      prevMap: new Map(),
      history: [],
      suspended: new Set(),
      stopping: false,
      restarts: 0,
    };
  }
  return globalForHost.__taskManagerHost;
}

export function isSupported(): boolean {
  return IS_WINDOWS;
}

/* ---- PowerShell plumbing ---- */

export function runScript(script: string, payload: unknown, timeoutMs = 30_000): Promise<Record<string, unknown>> {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(SCRIPTS, script), "-Payload", encoded],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr.trim() || err.message));
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim() || "{}") as Record<string, unknown>);
        } catch {
          reject(new Error(stdout.slice(0, 300) || "The PowerShell helper returned no output."));
        }
      },
    );
  });
}

/* ---- Sampler lifecycle ---- */

export function ensureSampler(): void {
  if (!IS_WINDOWS) return;
  const s = state();
  if (s.child && !s.child.killed) return;
  s.stopping = false;

  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(SCRIPTS, "sampler.ps1")],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  s.child = child;

  if (!s.ready) {
    s.ready = new Promise<void>((resolve) => {
      s.resolveReady = resolve;
    });
  }

  if (child.stdout) {
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      const text = line.trim();
      if (!text) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return;
      }
      if (msg.type === "hello") {
        s.info = {
          hostName: String(msg.hostName ?? "This PC"),
          os: String(msg.os ?? "Windows"),
          osVersion: String(msg.osVersion ?? ""),
          cpuName: String(msg.cpuName ?? "Unknown CPU"),
          cores: Number(msg.cores ?? 1),
          logical: Number(msg.logical ?? msg.cores ?? 1),
          baseGhz: Number(msg.baseGhz ?? 0),
          memoryTotalMb: Number(msg.memoryTotalMb ?? 0),
          userName: String(msg.userName ?? "User"),
          networkName: String(msg.networkName ?? ""),
          bootedAt: String(msg.bootedAt ?? new Date().toISOString()),
        };
      } else if (msg.type === "sample") {
        const raw = msg as unknown as RawSample;
        if (Array.isArray(raw.processes)) ingest(raw);
      }
    });
  }

  child.stderr?.on("data", (chunk: Buffer) => {
    s.lastError = chunk.toString().slice(0, 400);
  });

  child.on("exit", () => {
    s.child = undefined;
    if (s.stopping) return;
    s.restarts += 1;
    // Keep trying: the machine may be busy booting or PowerShell may have been
    // blocked by policy. Backing off avoids a hot restart loop.
    setTimeout(() => ensureSampler(), Math.min(15_000, 1000 * s.restarts));
  });
}

function ingest(raw: RawSample): void {
  const s = state();
  const prev = s.prev;
  const deltaSec = prev ? Math.max(0.25, (raw.at - prev.at) / 1000) : 0;
  const cores = Math.max(1, raw.cores || 1);

  const cpuByPid = new Map<number, number>();
  const diskByPid = new Map<number, number>();
  let cpuSum = 0;
  let diskSum = 0;

  for (const p of raw.processes) {
    if (!p || p.pid <= 0) continue;
    const before = s.prevMap.get(p.pid);
    let cpu = 0;
    let disk = 0;
    if (prev && before && deltaSec > 0) {
      cpu = Math.max(0, ((p.cpuSec - before.cpu) / deltaSec / cores) * 100);
      disk = Math.max(0, (p.ioBytes - before.io) / deltaSec / 1_048_576);
    }
    cpuByPid.set(p.pid, Math.min(100, cpu));
    diskByPid.set(p.pid, disk);
    cpuSum += cpu;
    diskSum += disk;
  }

  const usedMb = Math.max(0, raw.totalMb - raw.freeMb);
  const sample: Sample = {
    at: raw.at,
    cpu: Math.min(100, Math.round(cpuSum * 10) / 10),
    // Physical memory in use, as Windows reports it. Summing working sets would
    // double-count shared pages and can exceed the installed amount.
    memoryMb: Math.round(usedMb),
    memoryPct: raw.totalMb > 0 ? Math.round((usedMb / raw.totalMb) * 1000) / 10 : 0,
    diskMbps: Math.round(diskSum * 10) / 10,
    // Windows' own "% active time" needs the performance counters; this is a
    // relative indicator that saturates at 200 MB/s of combined process I/O.
    diskPct: Math.min(100, Math.round((diskSum / 200) * 100)),
    networkMbps: Math.round((raw.networkMbps || 0) * 10) / 10,
    gpu: 0,
  };

  s.latest = { at: raw.at, sample, processes: raw.processes, cpuByPid, diskByPid };
  s.prev = raw;
  s.prevMap = new Map(raw.processes.map((p) => [p.pid, { cpu: p.cpuSec, io: p.ioBytes }]));
  s.history.push(sample);
  if (s.history.length > 60) s.history.shift();
  if (s.history.length === 1) s.resolveReady?.();
}

/** Resolves once the first real sample has arrived, or after the timeout. */
export async function whenReady(timeoutMs = 6000): Promise<void> {
  ensureSampler();
  const s = state();
  if (!s.ready) return;
  await Promise.race([s.ready, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

export function snapshot(): { at: number; sample: Sample; processes: RawProcess[]; cpuByPid: Map<number, number>; diskByPid: Map<number, number> } | null {
  const s = state();
  if (!s.latest) return null;
  return {
    at: s.latest.at,
    sample: s.latest.sample,
    processes: s.latest.processes,
    cpuByPid: s.latest.cpuByPid,
    diskByPid: s.latest.diskByPid,
  };
}

export function history(): Sample[] {
  return [...state().history];
}

export function hostInfo(): HostInfo | null {
  return state().info ?? null;
}

export function samplerStatus() {
  const s = state();
  return {
    running: Boolean(s.child && !s.child.killed),
    supported: IS_WINDOWS,
    lastSampleAt: s.latest ? new Date(s.latest.at).toISOString() : null,
    processes: s.latest?.processes.length ?? 0,
    restarts: s.restarts,
    error: s.lastError ?? null,
  };
}

/** Forces a fresh reading as soon as possible and forgets suspend bookkeeping for gone PIDs. */
export function requestRefresh(): void {
  const s = state();
  for (const pid of [...s.suspended]) {
    if (!s.latest?.processes.some((p) => p.pid === pid)) s.suspended.delete(pid);
  }
  ensureSampler();
}

export function suspendedSet(): Set<number> {
  return state().suspended;
}

export function markSuspended(pid: number, suspended: boolean): void {
  const set = state().suspended;
  if (suspended) set.add(pid);
  else set.delete(pid);
}

/**
 * Reflects a priority change in the cached snapshot. Windows' own value only
 * shows up on the next sample, and the API should not report the old one.
 */
export function setProcessPriority(pid: number, priority: string): void {
  const s = state();
  if (!s.latest) return;
  s.latest = {
    ...s.latest,
    processes: s.latest.processes.map((p) => (p.pid === pid ? { ...p, priority } : p)),
  };
}

/** Drops a process from the cached snapshot so the UI updates before the next tick. */
export function forgetProcesses(pids: number[]): void {
  const s = state();
  if (!s.latest) return;
  const gone = new Set(pids);
  s.latest = {
    ...s.latest,
    processes: s.latest.processes.filter((p) => !gone.has(p.pid)),
  };
  for (const pid of gone) {
    s.suspended.delete(pid);
    s.latest.cpuByPid.delete(pid);
    s.latest.diskByPid.delete(pid);
  }
}
