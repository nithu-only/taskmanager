import {
  ensureSampler,
  forgetProcesses,
  history as sampleHistory,
  hostInfo,
  isSupported,
  markSuspended,
  requestRefresh,
  runScript,
  samplerStatus,
  setProcessPriority,
  snapshot,
  suspendedSet,
  whenReady,
  type HostInfo,
  type RawProcess,
} from "./host";
import {
  CATEGORIES,
  PRIORITIES,
  PRIORITY_LABEL,
  SEVERITIES,
  maxSeverity,
  type Category,
  type EventDTO,
  type EventSnapshot,
  type HostSpecs,
  type Priority,
  type ProcessDTO,
  type ProcessInput,
  type ProcessesResponse,
  type ProcStatus,
  type Sample,
  type ServiceDTO,
  type Severity,
  type StartupDTO,
  type StartupImpact,
  type StartupType,
  type SystemResponse,
  type Totals,
} from "./types";

/* ───────────────────────── HTTP helpers ───────────────────────── */

export class UserError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function bad(message: string, status = 400, extra?: Record<string, unknown>) {
  return Response.json({ error: message, ...extra }, { status });
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    if (!isSupported()) {
      return bad("This app reads live data from Windows, so it has to run on Windows.", 501);
    }
    ensureSampler();
    return await fn();
  } catch (err) {
    if (err instanceof UserError) return bad(err.message, err.status);
    console.error("[task-manager]", err);
    const message = err instanceof Error ? err.message : "Something went wrong on the server. Please try again.";
    return bad(message, 500);
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function str(v: unknown, max: number): string | undefined {
  return typeof v === "string" ? v.trim().slice(0, max) : undefined;
}

export function num(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}

export function oneOf<T extends string>(v: unknown, list: readonly T[]): T | undefined {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** Stable numeric id for anything that has no numeric id of its own. */
export function stableId(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 2_000_000_000) + 1;
}

/* ───────────────────────── Risk model ───────────────────────── */

/** Processes Windows cannot survive without. These are never actually ended. */
const CORE_PROCESSES = new Set([
  "csrss", "wininit", "winlogon", "services", "lsass", "smss", "system", "registry",
  "memory compression", "secure system", "system idle process",
]);

/** Processes Windows needs for a normal desktop session. */
const SYSTEM_PROCESSES = new Set([
  "dwm", "explorer", "fontdrvhost", "sihost", "taskhostw", "ctfmon", "audiodg",
  "spoolsv", "svchost", "dllhost", "runtimebroker", "searchindexer", "lsaiso",
  "msmpeng", "nissrv", "securityhealthservice", "userinit", "wudfhost",
]);

function baseName(name: string): string {
  return name.toLowerCase().replace(/\.exe$/, "");
}

const IMPACT_TEXT: Record<Severity, string> = {
  low: "Ending this task is safe. It closes the app and you can start it again when you need it.",
  medium: "Ending this task may discard unsaved work or interrupt something that is in progress.",
  high: "Windows relies on this process. Ending it can break parts of the desktop, sound, network or security until it restarts.",
  critical: "This is a core Windows process. Windows cannot end it safely, so the request is blocked.",
};

function severityFor(p: RawProcess): Severity {
  const base = baseName(p.name);
  if (CORE_PROCESSES.has(base)) return "critical";
  if (SYSTEM_PROCESSES.has(base)) return "high";
  if (p.session === 0) return "high";
  if (!p.responding) return "medium";
  if (p.exe && /^c:\\windows\\/i.test(p.exe)) return "medium";
  return "low";
}

function categoryFor(p: RawProcess): Category {
  if (p.exe && /^c:\\windows\\/i.test(p.exe)) return "windows";
  if (p.session === 0) return "background";
  if (p.exe && /(program files|appdata|\\users\\)/i.test(p.exe)) return "app";
  return "background";
}

const PRIORITY_MAP: Record<string, Priority> = {
  Idle: "low",
  BelowNormal: "below_normal",
  Normal: "normal",
  AboveNormal: "above_normal",
  High: "high",
  RealTime: "realtime",
};

const PRIORITY_TO_DOTNET: Record<Priority, string> = {
  realtime: "RealTime",
  high: "High",
  above_normal: "AboveNormal",
  normal: "Normal",
  below_normal: "BelowNormal",
  low: "Idle",
};

function architectureFor(p: RawProcess): string {
  if (!p.exe) return "x64";
  return /syswow64|\(x86\)/i.test(p.exe) ? "x86" : "x64";
}

function specsFrom(info: HostInfo | null): HostSpecs {
  return {
    hostName: info?.hostName ?? "This PC",
    os: info?.os ?? "Windows",
    cpuName: info?.cpuName ?? "Unknown CPU",
    cores: info?.cores ?? 1,
    logical: info?.logical ?? 1,
    baseGhz: info?.baseGhz ?? 0,
    memoryTotalMb: info?.memoryTotalMb ?? 0,
    userName: info?.userName ?? "User",
    networkName: info?.networkName ?? "",
    bootedAt: info?.bootedAt ?? new Date().toISOString(),
  };
}

export function specs(): HostSpecs {
  return specsFrom(hostInfo());
}

/* ───────────────────────── Processes ───────────────────────── */

function toDTO(
  p: RawProcess,
  ctx: { at: number; user: string; cpu: Map<number, number>; disk: Map<number, number>; suspended: Set<number> },
): ProcessDTO {
  const status: ProcStatus = ctx.suspended.has(p.pid)
    ? "suspended"
    : p.responding
      ? "running"
      : "not_responding";
  const severity = severityFor(p);
  const image = p.name;
  const friendly = (p.description || "").trim();
  const name = friendly && friendly.length <= 60 ? friendly : p.name.replace(/\.exe$/i, "");
  return {
    id: p.pid,
    pid: p.pid,
    parentPid: p.ppid > 0 ? p.ppid : null,
    name,
    imageName: image,
    description: p.description || p.name,
    publisher: p.company || "",
    category: categoryFor(p),
    status,
    severity,
    impactNote:
      severity === "medium" && !p.responding
        ? `${p.name} is not responding. Ending it is usually the only way to recover it, and nothing can be saved first.`
        : IMPACT_TEXT[severity],
    unsavedWork: false,
    userName: p.session === 0 ? "SYSTEM" : ctx.user,
    priority: PRIORITY_MAP[p.priority] ?? "normal",
    architecture: architectureFor(p),
    commandLine: p.cmd || p.exe || "",
    threads: p.threads,
    handles: p.handles,
    startedAt: p.started ?? new Date(ctx.at).toISOString(),
    cpu: Math.round((ctx.cpu.get(p.pid) ?? 0) * 10) / 10,
    memoryMb: p.wsMb,
    diskMbps: Math.round((ctx.disk.get(p.pid) ?? 0) * 10) / 10,
    networkMbps: 0,
    gpu: 0,
  };
}

function dtos(): { processes: ProcessDTO[]; at: number } {
  const snap = snapshot();
  const info = hostInfo();
  if (!snap) return { processes: [], at: Date.now() };
  const ctx = {
    at: snap.at,
    user: info?.userName ?? "User",
    cpu: snap.cpuByPid,
    disk: snap.diskByPid,
    suspended: suspendedSet(),
  };
  return {
    at: snap.at,
    processes: snap.processes
      .filter((p) => p.pid > 0 && p.pid !== 0)
      .map((p) => toDTO(p, ctx))
      .sort((a, b) => b.memoryMb - a.memoryMb),
  };
}

function totalsOf(list: ProcessDTO[], sample: Sample | null): Totals {
  const cpu = list.reduce((s, p) => s + p.cpu, 0);
  const processMemoryMb = list.reduce((s, p) => s + p.memoryMb, 0);
  const diskMbps = list.reduce((s, p) => s + p.diskMbps, 0);
  return {
    at: sample?.at ?? Date.now(),
    cpu: Math.min(100, Math.round(cpu * 10) / 10),
    memoryMb: sample?.memoryMb ?? Math.round(processMemoryMb),
    memoryPct: sample?.memoryPct ?? 0,
    processMemoryMb: Math.round(processMemoryMb),
    diskMbps: Math.round(diskMbps * 10) / 10,
    diskPct: Math.min(100, Math.round((diskMbps / 200) * 100)),
    networkMbps: sample?.networkMbps ?? 0,
    gpu: 0,
    processes: list.length,
    threads: list.reduce((s, p) => s + p.threads, 0),
    handles: list.reduce((s, p) => s + p.handles, 0),
  };
}

export async function loadProcesses(): Promise<ProcessesResponse> {
  await whenReady();
  const { processes } = dtos();
  const snap = snapshot();
  const info = hostInfo();
  return {
    processes,
    totals: totalsOf(processes, snap?.sample ?? null),
    bootedAt: info?.bootedAt ?? new Date().toISOString(),
    serverTime: new Date().toISOString(),
    specs: specsFrom(info),
  };
}

export async function loadSystem(): Promise<SystemResponse> {
  await whenReady();
  const { processes } = dtos();
  const snap = snapshot();
  const info = hostInfo();
  return {
    totals: totalsOf(processes, snap?.sample ?? null),
    history: sampleHistory(),
    bootedAt: info?.bootedAt ?? new Date().toISOString(),
    serverTime: new Date().toISOString(),
    specs: specsFrom(info),
  };
}

export function findProcess(pid: number): { dto: ProcessDTO; raw: RawProcess } | null {
  const snap = snapshot();
  if (!snap) return null;
  const raw = snap.processes.find((p) => p.pid === pid);
  if (!raw) return null;
  const info = hostInfo();
  return {
    raw,
    dto: toDTO(raw, {
      at: snap.at,
      user: info?.userName ?? "User",
      cpu: snap.cpuByPid,
      disk: snap.diskByPid,
      suspended: suspendedSet(),
    }),
  };
}

export function descendants(pid: number): number[] {
  const snap = snapshot();
  if (!snap) return [];
  const out: number[] = [];
  const queue = [pid];
  const seen = new Set<number>([pid]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const p of snap.processes) {
      if (p.ppid === current && !seen.has(p.pid)) {
        seen.add(p.pid);
        out.push(p.pid);
        queue.push(p.pid);
      }
    }
  }
  return out;
}

/* ───────────────────────── Process input ───────────────────────── */

export function parseProcessInput(body: unknown): { data: ProcessInput } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Process details are missing." };
  const b = body as Record<string, unknown>;
  const name = str(b.name, 80);
  const imageName = str(b.imageName, 260);
  if (!name) return { error: "Enter a name for the task." };
  if (!imageName) return { error: "Enter the program to run, for example notepad.exe." };
  const mem = num(b.baseMemoryMb, 0.1, 65536) ?? 0;
  return {
    data: {
      name,
      imageName,
      description: str(b.description, 300) ?? "",
      publisher: str(b.publisher, 120) ?? "",
      category: oneOf(b.category, CATEGORIES) ?? "app",
      severity: oneOf(b.severity, SEVERITIES) ?? "low",
      impactNote: str(b.impactNote, 400) ?? "",
      unsavedWork: b.unsavedWork === true,
      userName: str(b.userName, 40) || "User",
      priority: oneOf(b.priority, PRIORITIES) ?? "normal",
      architecture: str(b.architecture, 10) || "x64",
      commandLine: str(b.commandLine, 400) ?? "",
      baseCpu: num(b.baseCpu, 0, 100) ?? 0,
      baseMemoryMb: mem,
      baseDiskMbps: num(b.baseDiskMbps, 0, 500) ?? 0,
      baseNetworkMbps: num(b.baseNetworkMbps, 0, 1000) ?? 0,
      baseGpu: num(b.baseGpu, 0, 100) ?? 0,
      threads: Math.round(num(b.threads, 1, 5000) ?? 0),
      handles: Math.round(num(b.handles, 0, 100000) ?? 0),
    },
  };
}

function snapshotOf(dto: ProcessDTO): ProcessInput {
  return {
    name: dto.name,
    imageName: dto.imageName,
    description: dto.description,
    publisher: dto.publisher,
    category: dto.category,
    severity: dto.severity,
    impactNote: dto.impactNote,
    unsavedWork: false,
    userName: dto.userName,
    priority: dto.priority,
    architecture: dto.architecture,
    commandLine: dto.commandLine,
    baseCpu: dto.cpu,
    baseMemoryMb: dto.memoryMb,
    baseDiskMbps: dto.diskMbps,
    baseNetworkMbps: dto.networkMbps,
    baseGpu: dto.gpu,
    threads: dto.threads,
    handles: dto.handles,
  };
}

/** Splits "C:\path\app.exe --flag value" into the executable and its arguments. */
function splitCommandLine(image: string, commandLine: string): string {
  const text = (commandLine || "").trim();
  if (!text) return "";
  const target = image.trim();
  if (!text.toLowerCase().includes(target.toLowerCase().replace(/^"|"$/g, ""))) return text;
  let rest = text;
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1);
    if (end > 0) rest = text.slice(end + 1);
  } else {
    const cut = text.toLowerCase().indexOf(target.toLowerCase());
    rest = cut >= 0 ? text.slice(cut + target.length) : text.slice(text.indexOf(" ") + 1);
  }
  return rest.trim();
}

async function waitForPid(pid: number, timeoutMs = 6000): Promise<ProcessDTO | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = findProcess(pid);
    if (found) return found.dto;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

export async function createProcess(input: ProcessInput): Promise<ProcessDTO> {
  const args = splitCommandLine(input.imageName, input.commandLine);
  const result = await runScript("proc.ps1", { action: "spawn", file: input.imageName, args });
  if (!result.ok) {
    throw new UserError(
      `Windows couldn't start ${input.imageName}. ${String(result.error ?? "")}`.trim(),
      400,
    );
  }
  const pid = Number(result.pid);
  const dto = Number.isFinite(pid) ? await waitForPid(pid, 6000) : null;
  logEvent({
    kind: "started",
    title: `Started ${input.name}`,
    detail: `${input.imageName}${Number.isFinite(pid) ? ` (PID ${pid})` : ""} was started.`,
    severity: "low",
  });
  if (dto) return dto;
  // Windows sometimes hands a launcher off to an existing process, so the new
  // PID can disappear immediately. Show a placeholder rather than failing.
  const now = new Date().toISOString();
  return {
    id: Number.isFinite(pid) ? pid : stableId(input.imageName),
    pid: Number.isFinite(pid) ? pid : 0,
    parentPid: null,
    name: input.name,
    imageName: input.imageName,
    description: input.description,
    publisher: input.publisher,
    category: input.category,
    status: "running",
    severity: input.severity,
    impactNote: input.impactNote,
    unsavedWork: false,
    userName: input.userName,
    priority: input.priority,
    architecture: input.architecture,
    commandLine: input.commandLine,
    threads: input.threads,
    handles: input.handles,
    startedAt: now,
    cpu: 0,
    memoryMb: 0,
    diskMbps: 0,
    networkMbps: 0,
    gpu: 0,
  };
}

export type EndResult =
  | { kind: "not_found" }
  | { kind: "protected"; name: string }
  | { kind: "ended"; ids: number[] }
  | { kind: "failed"; error: string };

async function killPids(pids: number[]): Promise<Record<string, unknown>> {
  if (pids.length === 0) return { ok: true, failed: [] };
  return runScript("proc.ps1", { action: "kill", pids });
}

export async function endProcess(pid: number, _force: boolean): Promise<EndResult> {
  const found = findProcess(pid);
  if (!found) return { kind: "not_found" };
  if (found.dto.severity === "critical") return { kind: "protected", name: found.dto.name };

  const tree = descendants(pid);
  const targets = [pid, ...tree].filter((id) => {
    const p = findProcess(id);
    return p ? p.dto.severity !== "critical" : true;
  });

  const result = await killPids(targets);
  const failed = Array.isArray(result.failed) ? (result.failed as { pid?: number; error?: string }[]) : [];
  const failedPids = new Set(failed.map((f) => Number(f.pid)));
  const reallyEnded = targets.filter((id) => !failedPids.has(id));

  if (failed.length > 0 && reallyEnded.length === 0) {
    return { kind: "failed", error: String(failed[0]?.error ?? "Windows refused to end this task.") };
  }

  forgetProcesses(reallyEnded);
  logEvent({
    kind: "ended",
    title: `Ended ${found.dto.name}`,
    detail:
      `${found.dto.imageName} (PID ${pid})` +
      (tree.length ? ` and ${tree.length} child process${tree.length === 1 ? "" : "es"}` : "") +
      ` ended. Freed ${Math.round(found.dto.memoryMb)} MB of memory.`,
    severity: found.dto.severity,
    snapshot: { process: snapshotOf(found.dto), children: [] },
  });
  return { kind: "ended", ids: reallyEnded };
}

/* ───────────────────────── Bulk actions ───────────────────────── */

export type BulkUpdateResult =
  | { kind: "not_found" }
  | { kind: "protected"; name: string }
  | { kind: "unresponsive"; name: string }
  | { kind: "updated"; ids: number[]; changed: number };

export async function bulkUpdate(
  ids: number[],
  patch: { status?: "running" | "suspended"; priority?: Priority },
): Promise<BulkUpdateResult> {
  const found = ids.map((id) => ({ id, proc: findProcess(id) })).filter((x) => x.proc);
  if (found.length === 0) return { kind: "not_found" };

  if (patch.status) {
    const protectedProc = found.find((x) => x.proc!.dto.severity === "critical");
    if (protectedProc) return { kind: "protected", name: protectedProc.proc!.dto.name };
    const unresponsive = found.find((x) => x.proc!.dto.status === "not_responding");
    if (unresponsive) return { kind: "unresponsive", name: unresponsive.proc!.dto.name };

    const targets = found.filter((x) => x.proc!.dto.status !== patch.status).map((x) => x.id);
    if (targets.length === 0) return { kind: "updated", ids: [], changed: 0 };

    const action = patch.status === "suspended" ? "suspend" : "resume";
    const result = await runScript("proc.ps1", { action, pids: targets });
    if (!result.ok) throw new UserError(String(result.error ?? `Windows refused to ${action} those tasks.`), 403);
    for (const id of targets) markSuspended(id, patch.status === "suspended");

    logEvent({
      kind: "status",
      title: `${patch.status === "suspended" ? "Suspended" : "Resumed"} ${targets.length} task${targets.length === 1 ? "" : "s"}`,
      detail: `${targets.length} process${targets.length === 1 ? "" : "es"} ${patch.status === "suspended" ? "paused" : "resumed"}.`,
    });
    return { kind: "updated", ids: targets, changed: targets.length };
  }

  if (patch.priority) {
    const targets = found.filter((x) => x.proc!.dto.priority !== patch.priority).map((x) => x.id);
    if (targets.length === 0) return { kind: "updated", ids: [], changed: 0 };
    let changed = 0;
    let lastError = "";
    for (const id of targets.slice(0, 50)) {
      const result = await runScript("proc.ps1", {
        action: "priority",
        pid: id,
        value: PRIORITY_TO_DOTNET[patch.priority],
      }).catch((err: Error) => ({ ok: false, error: err.message }));
      if (result.ok) changed += 1;
      else lastError = String(result.error ?? lastError);
      if (result.ok) setProcessPriority(id, PRIORITY_TO_DOTNET[patch.priority]);
    }
    if (changed === 0) throw new UserError(lastError || "Windows refused to change the priority of those tasks.", 403);
    logEvent({
      kind: "priority",
      title: `Changed priority of ${changed} task${changed === 1 ? "" : "s"}`,
      detail: `Priority set to ${PRIORITY_LABEL[patch.priority]}.`,
    });
    return { kind: "updated", ids: targets, changed };
  }

  return { kind: "updated", ids: [], changed: 0 };
}

export type BulkEndResult =
  | { kind: "not_found" }
  | { kind: "protected"; name: string }
  | { kind: "ended"; ids: number[]; tasks: number; skipped: number }
  | { kind: "failed"; error: string };

export async function bulkEnd(ids: number[], _force: boolean): Promise<BulkEndResult> {
  const found = ids.map((id) => ({ id, proc: findProcess(id) })).filter((x) => x.proc);
  if (found.length === 0) return { kind: "not_found" };

  const critical = found.find((x) => x.proc!.dto.severity === "critical");
  if (critical) return { kind: "protected", name: critical.proc!.dto.name };

  const targetSet = new Set<number>();
  for (const { id } of found) {
    targetSet.add(id);
    for (const child of descendants(id)) {
      const childProc = findProcess(child);
      if (childProc && childProc.dto.severity !== "critical") targetSet.add(child);
    }
  }
  const targets = [...targetSet];

  const result = await killPids(targets);
  const failed = Array.isArray(result.failed) ? (result.failed as { pid?: number; error?: string }[]) : [];
  const failedPids = new Set(failed.map((f) => Number(f.pid)));
  const ended = targets.filter((id) => !failedPids.has(id));
  if (failed.length > 0 && ended.length === 0) {
    return { kind: "failed", error: String(failed[0]?.error ?? "Windows refused to end those tasks.") };
  }
  forgetProcesses(ended);

  for (const { id, proc } of found) {
    logEvent({
      kind: "ended",
      title: `Ended ${proc!.dto.name}`,
      detail: `${proc!.dto.imageName} (PID ${id}) was ended using multi-selection.`,
      severity: proc!.dto.severity,
      snapshot: { process: snapshotOf(proc!.dto), children: [] },
    });
  }
  return { kind: "ended", ids: ended, tasks: found.length, skipped: ids.length - found.length };
}

/* ───────────────────────── Activity log ───────────────────────── */

interface StoredEvent {
  id: number;
  kind: string;
  title: string;
  detail: string;
  severity: Severity;
  snapshot: EventSnapshot | null;
  createdAt: string;
}

const globalForEvents = globalThis as typeof globalThis & {
  __taskManagerEvents?: { list: StoredEvent[]; nextId: number };
};

function eventStore() {
  if (!globalForEvents.__taskManagerEvents) {
    globalForEvents.__taskManagerEvents = { list: [], nextId: 1 };
  }
  return globalForEvents.__taskManagerEvents;
}

export function logEvent(e: {
  kind: string;
  title: string;
  detail?: string;
  severity?: Severity;
  snapshot?: EventSnapshot | null;
}): EventDTO {
  const store = eventStore();
  const row: StoredEvent = {
    id: store.nextId++,
    kind: e.kind,
    title: e.title,
    detail: e.detail ?? "",
    severity: e.severity ?? "low",
    snapshot: e.snapshot ?? null,
    createdAt: new Date().toISOString(),
  };
  store.list.unshift(row);
  if (store.list.length > 300) store.list.length = 300;
  return row;
}

export function listEvents(): EventDTO[] {
  return [...eventStore().list];
}

export function deleteEvent(id: number): boolean {
  const store = eventStore();
  const index = store.list.findIndex((e) => e.id === id);
  if (index < 0) return false;
  store.list.splice(index, 1);
  return true;
}

export function clearEvents(): void {
  eventStore().list.length = 0;
}

/* ───────────────────────── Services ───────────────────────── */

interface RawService {
  name: string;
  displayName: string;
  description: string;
  state: string;
  startMode: string;
  pid: number;
  account: string;
}

const CORE_SERVICES = new Set([
  "rpcss", "dcomlaunch", "rpcendpointmapper", "winmgmt", "power", "eventlog", "gpsvc",
  "samss", "lsm", "brokerinfrastructure", "systemeventsbroker", "plugplay", "themes",
]);

const globalForServices = globalThis as typeof globalThis & {
  __taskManagerServices?: { at: number; rows: RawService[] };
};

function startupTypeOf(mode: string): StartupType {
  const m = mode.toLowerCase();
  if (m.startsWith("auto")) return "automatic";
  if (m.startsWith("dis")) return "disabled";
  return "manual";
}

function serviceDTO(r: RawService): ServiceDTO {
  const name = r.name.toLowerCase();
  const severity: Severity = CORE_SERVICES.has(name) ? "critical" : r.state === "Running" ? "medium" : "low";
  return {
    id: stableId(`service:${r.name}`),
    name: r.name,
    displayName: r.displayName || r.name,
    description: r.description || "",
    groupName: r.account || "",
    status: r.state === "Running" ? "running" : "stopped",
    startupType: startupTypeOf(r.startMode),
    pid: r.pid > 0 ? r.pid : null,
    severity,
    impactNote:
      severity === "critical"
        ? "Windows depends on this service and will refuse to stop it."
        : severity === "medium"
          ? "Other programs may stop working until this service is started again."
          : "This service is not running. Starting it is safe.",
  };
}

export async function listServices(force = false): Promise<ServiceDTO[]> {
  const cache = globalForServices.__taskManagerServices;
  if (!force && cache && Date.now() - cache.at < 15_000) return cache.rows.map(serviceDTO);
  const result = await runScript("services.ps1", { action: "list" }, 45_000);
  if (!result.ok) throw new UserError(String(result.error ?? "Windows didn't return the service list."), 502);
  const rows = (Array.isArray(result.services) ? result.services : []) as RawService[];
  globalForServices.__taskManagerServices = { at: Date.now(), rows };
  return rows.map(serviceDTO);
}

async function serviceRow(id: number): Promise<RawService | null> {
  const rows = await listServices();
  const match = rows.find((r) => r.id === id);
  if (!match) return null;
  return globalForServices.__taskManagerServices?.rows.find((r) => r.name === match.name) ?? null;
}

export async function serviceAction(id: number, action: "start" | "stop" | "restart"): Promise<ServiceDTO> {
  const row = await serviceRow(id);
  if (!row) throw new UserError("That service no longer exists.", 404);
  const before = serviceDTO({ ...row });
  if (action === "start" && before.status === "running") throw new UserError(`${before.displayName} is already running.`, 409);
  if (action === "stop" && before.status === "stopped") throw new UserError(`${before.displayName} is already stopped.`, 409);
  if (action === "restart" && before.status !== "running") throw new UserError(`${before.displayName} isn't running, so it can't be restarted. Start it instead.`, 409);
  if (action === "stop" && before.severity === "critical") {
    throw new UserError(`Windows can't run without ${before.displayName}, so it can't be stopped.`, 403);
  }

  const result = await runScript("services.ps1", { action, name: row.name }, 45_000);
  if (!result.ok) {
    throw new UserError(
      `Windows refused to ${action} ${before.displayName}. ${String(result.error ?? "")} Administrative rights are usually required for services.`.trim(),
      403,
    );
  }
  logEvent({
    kind: "service",
    title: `${action === "start" ? "Started" : action === "stop" ? "Stopped" : "Restarted"} ${before.displayName}`,
    detail: `The ${row.name} service was ${action === "restart" ? "restarted" : action === "start" ? "started" : "stopped"}.`,
    severity: action === "stop" ? before.severity : "low",
  });
  const refreshed = await listServices(true);
  return refreshed.find((s) => s.id === id) ?? before;
}

export async function setServiceStartup(id: number, type: StartupType): Promise<ServiceDTO> {
  const row = await serviceRow(id);
  if (!row) throw new UserError("That service no longer exists.", 404);
  const mode = type === "automatic" ? "Automatic" : type === "disabled" ? "Disabled" : "Manual";
  const result = await runScript("services.ps1", { action: "startupType", name: row.name, value: mode }, 45_000);
  if (!result.ok) {
    throw new UserError(
      `Windows refused to change the startup type of ${row.displayName}. ${String(result.error ?? "")} Administrative rights are required for this change.`.trim(),
      403,
    );
  }
  logEvent({
    kind: "service",
    title: `Changed startup type of ${row.displayName}`,
    detail: `Startup type is now ${type}.`,
  });
  const refreshed = await listServices(true);
  return refreshed.find((s) => s.id === id) ?? serviceDTO(row);
}

/* ───────────────────────── Startup apps ───────────────────────── */

const IMPACT_NAMES: { pattern: RegExp; impact: StartupImpact }[] = [
  { pattern: /docker|steam|adobe|ableton|unity|bluestacks/i, impact: "high" },
  { pattern: /onedrive|discord|teams|spotify|slack|dropbox|comet|chrome|edge/i, impact: "medium" },
];

const globalForStartup = globalThis as typeof globalThis & {
  __taskManagerStartup?: { at: number; apps: StartupDTO[]; manageable: Map<number, string> };
};

function commandExe(command: string): string {
  const quoted = command.match(/^"([^"]+)"/);
  if (quoted) return quoted[1];
  const first = command.trim().split(/\s+/)[0] ?? "";
  return first;
}

function startupImpact(name: string, command: string): StartupImpact {
  const text = `${name} ${command}`;
  for (const rule of IMPACT_NAMES) if (rule.pattern.test(text)) return rule.impact;
  return "low";
}

function publisherFromPath(exe: string): string {
  const match = exe.match(/program files(?: \(x86\))?\\([^\\]+)/i);
  if (match) return match[1];
  const user = exe.match(/appdata\\local\\(?:programs\\)?\\([^\\]+)/i);
  if (user) return user[1];
  return "";
}

export async function listStartup(force = false): Promise<StartupDTO[]> {
  const cache = globalForStartup.__taskManagerStartup;
  if (!force && cache && Date.now() - cache.at < 10_000) return cache.apps;
  const result = await runScript("startup.ps1", { action: "list" }, 30_000);
  if (!result.ok) throw new UserError(String(result.error ?? "Windows didn't return the startup list."), 502);

  const entries = (Array.isArray(result.entries) ? result.entries : []) as {
    name: string;
    command: string;
    location: string;
    user: string;
  }[];
  const on = (result.on ?? {}) as Record<string, string>;
  const off = (result.off ?? {}) as Record<string, string>;
  const opaque = new Set(Array.isArray(result.opaque) ? (result.opaque as string[]) : []);

  const byName = new Map<string, StartupDTO>();
  const manageable = new Map<number, string>();

  for (const [name, command] of Object.entries(on)) {
    const id = stableId(`startup:${name}`);
    byName.set(name, {
      id,
      name,
      publisher: publisherFromPath(commandExe(command)),
      command,
      enabled: true,
      impact: startupImpact(name, command),
      createdAt: new Date().toISOString(),
      manageable: !opaque.has(name),
    });
    if (!opaque.has(name)) manageable.set(id, name);
  }
  for (const [name, command] of Object.entries(off)) {
    const id = stableId(`startup:${name}`);
    byName.set(name, {
      id,
      name,
      publisher: publisherFromPath(commandExe(command)),
      command,
      enabled: false,
      impact: startupImpact(name, command),
      createdAt: new Date().toISOString(),
      manageable: true,
    });
    manageable.set(id, name);
  }
  for (const entry of entries) {
    if (byName.has(entry.name)) continue;
    const id = stableId(`startup:${entry.location}:${entry.name}`);
    byName.set(entry.name, {
      id,
      name: entry.name,
      publisher: publisherFromPath(commandExe(entry.command)),
      command: entry.command,
      enabled: true,
      impact: startupImpact(entry.name, entry.command),
      createdAt: new Date().toISOString(),
      manageable: false,
    });
  }

  const apps = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  globalForStartup.__taskManagerStartup = { at: Date.now(), apps, manageable };
  return apps;
}

async function startupName(id: number): Promise<string> {
  let cache = globalForStartup.__taskManagerStartup;
  if (!cache || !cache.manageable.has(id)) {
    await listStartup(true);
    cache = globalForStartup.__taskManagerStartup;
  }
  const name = cache?.manageable.get(id);
  if (!name) {
    throw new UserError(
      "This entry was added by Windows or by an installer that needs administrator rights, so this app can't change it. Remove it from Task Manager or Settings.",
      403,
    );
  }
  return name;
}

export async function setStartupEnabled(id: number, enabled: boolean): Promise<StartupDTO[]> {
  const name = await startupName(id);
  const result = await runScript("startup.ps1", { action: enabled ? "enable" : "disable", name });
  if (!result.ok) throw new UserError(String(result.error ?? "Windows refused to change this startup entry."), 403);
  logEvent({
    kind: "startup",
    title: `${enabled ? "Enabled" : "Disabled"} ${name} at startup`,
    detail: enabled ? `${name} will open when you sign in.` : `${name} will no longer open when you sign in.`,
  });
  return listStartup(true);
}

export async function addStartup(input: { name: string; command: string; publisher: string; impact: StartupImpact }): Promise<StartupDTO[]> {
  const existing = await listStartup();
  if (existing.some((a) => a.name.toLowerCase() === input.name.toLowerCase())) {
    throw new UserError(`${input.name} is already in the startup list.`, 409);
  }
  const result = await runScript("startup.ps1", { action: "add", name: input.name, command: input.command });
  if (!result.ok) throw new UserError(String(result.error ?? "Windows refused to add this startup entry."), 403);
  logEvent({
    kind: "startup",
    title: `Added ${input.name} to startup apps`,
    detail: `${input.name} will open when you sign in.`,
  });
  return listStartup(true);
}

export async function updateStartup(
  id: number,
  patch: { name?: string; command?: string; enabled?: boolean; impact?: StartupImpact; publisher?: string },
): Promise<StartupDTO[]> {
  const current = (await listStartup()).find((a) => a.id === id);
  if (!current) throw new UserError("That startup app no longer exists. It may have been removed.", 404);
  const name = await startupName(id);

  if (patch.command && patch.command !== current.command) {
    const result = await runScript("startup.ps1", { action: "setcommand", name, command: patch.command });
    if (!result.ok) throw new UserError(String(result.error ?? "Windows refused to update this startup entry."), 403);
    logEvent({ kind: "startup", title: `Updated ${name}`, detail: `The command that starts ${name} was changed.` });
  }
  if (patch.name && patch.name !== name) {
    await runScript("startup.ps1", { action: "remove", name });
    const added = await runScript("startup.ps1", {
      action: "add",
      name: patch.name,
      command: patch.command ?? current.command,
    });
    if (!added.ok) throw new UserError(String(added.error ?? "Windows refused to rename this startup entry."), 403);
    logEvent({ kind: "startup", title: `Renamed ${name} to ${patch.name}`, detail: "The startup entry was renamed." });
  }
  if (typeof patch.enabled === "boolean" && patch.enabled !== current.enabled) {
    const result = await runScript("startup.ps1", { action: patch.enabled ? "enable" : "disable", name: patch.name ?? name });
    if (!result.ok) throw new UserError(String(result.error ?? "Windows refused to change this startup entry."), 403);
    logEvent({
      kind: "startup",
      title: `${patch.enabled ? "Enabled" : "Disabled"} ${patch.name ?? name} at startup`,
      detail: patch.enabled ? `${name} will open when you sign in.` : `${name} will no longer open when you sign in.`,
    });
  }
  return listStartup(true);
}

export async function deleteStartup(id: number): Promise<StartupDTO[]> {
  const name = await startupName(id);
  const result = await runScript("startup.ps1", { action: "remove", name });
  if (!result.ok) throw new UserError(String(result.error ?? "Windows refused to remove this startup entry."), 403);
  logEvent({ kind: "startup", title: `Removed ${name} from startup apps`, detail: `${name} was removed from the startup list.` });
  return listStartup(true);
}

/* ───────────────────────── System ───────────────────────── */

export type SystemAction = "refresh" | "clear-history";

export async function systemAction(action: SystemAction): Promise<void> {
  if (action === "refresh") {
    requestRefresh();
    return;
  }
  clearEvents();
  logEvent({ kind: "system", title: "Activity history cleared", detail: "All previous activity entries were removed.", severity: "low" });
}

export function health() {
  const status = samplerStatus();
  return {
    ok: status.supported && (status.running || status.lastSampleAt !== null),
    ...status,
    host: hostInfo(),
    serverTime: new Date().toISOString(),
  };
}

export function whenFirstSample(): Promise<void> {
  return whenReady();
}

export { maxSeverity };
