// Shared, client-safe types, constants and formatters.

export type Severity = "low" | "medium" | "high" | "critical";
export type ProcStatus = "running" | "suspended" | "not_responding";
export type Category = "app" | "background" | "windows";
export type Priority = "realtime" | "high" | "above_normal" | "normal" | "below_normal" | "low";
export type StartupImpact = "high" | "medium" | "low" | "none";
export type ServiceStatus = "running" | "stopped";
export type StartupType = "automatic" | "manual" | "disabled";

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const CATEGORIES = ["app", "background", "windows"] as const;
export const STATUSES = ["running", "suspended", "not_responding"] as const;
export const PRIORITIES = ["realtime", "high", "above_normal", "normal", "below_normal", "low"] as const;
export const IMPACTS = ["high", "medium", "low", "none"] as const;
export const STARTUP_TYPES = ["automatic", "manual", "disabled"] as const;

export const SEVERITY_META: Record<Severity, { label: string; summary: string; rank: number; explain: string }> = {
  low: {
    label: "Low",
    summary: "Safe to end",
    rank: 0,
    explain: "Ending this task is safe. Nothing important is lost and you can open it again at any time.",
  },
  medium: {
    label: "Medium",
    summary: "May lose work",
    rank: 1,
    explain: "Ending this task may discard unsaved work or interrupt something that is in progress.",
  },
  high: {
    label: "High",
    summary: "Windows may become unstable",
    rank: 2,
    explain:
      "Windows relies on this process. Ending it can break parts of the desktop, sound, network or security until it restarts.",
  },
  critical: {
    label: "Critical",
    summary: "Windows protects it",
    rank: 3,
    explain:
      "This is a core Windows process. Windows will not let any app end it, because the PC would stop immediately.",
  },
};

export const CATEGORY_LABEL: Record<Category, string> = {
  app: "Apps",
  background: "Background processes",
  windows: "Windows processes",
};
export const CATEGORY_SINGULAR: Record<Category, string> = {
  app: "App",
  background: "Background process",
  windows: "Windows process",
};
export const STATUS_LABEL: Record<ProcStatus, string> = {
  running: "Running",
  suspended: "Suspended",
  not_responding: "Not responding",
};
export const PRIORITY_LABEL: Record<Priority, string> = {
  realtime: "Realtime",
  high: "High",
  above_normal: "Above normal",
  normal: "Normal",
  below_normal: "Below normal",
  low: "Low",
};
export const IMPACT_LABEL: Record<StartupImpact, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "None",
};
export const STARTUP_TYPE_LABEL: Record<StartupType, string> = {
  automatic: "Automatic",
  manual: "Manual",
  disabled: "Disabled",
};

export interface ProcessInput {
  name: string;
  imageName: string;
  description: string;
  publisher: string;
  category: Category;
  severity: Severity;
  impactNote: string;
  unsavedWork: boolean;
  userName: string;
  priority: Priority;
  architecture: string;
  commandLine: string;
  baseCpu: number;
  baseMemoryMb: number;
  baseDiskMbps: number;
  baseNetworkMbps: number;
  baseGpu: number;
  threads: number;
  handles: number;
}

export interface EventSnapshot {
  process: ProcessInput;
  children: ProcessInput[];
}

export interface ProcessDTO {
  id: number;
  pid: number;
  parentPid: number | null;
  name: string;
  imageName: string;
  description: string;
  publisher: string;
  category: Category;
  status: ProcStatus;
  severity: Severity;
  impactNote: string;
  unsavedWork: boolean;
  userName: string;
  priority: Priority;
  architecture: string;
  commandLine: string;
  threads: number;
  handles: number;
  startedAt: string;
  cpu: number;
  memoryMb: number;
  diskMbps: number;
  networkMbps: number;
  gpu: number;
}

export interface Sample {
  /** Milliseconds since the epoch when this reading was taken. */
  at: number;
  cpu: number;
  memoryMb: number;
  memoryPct: number;
  diskMbps: number;
  diskPct: number;
  networkMbps: number;
  gpu: number;
}

export interface Totals extends Sample {
  /** Working sets added together. Shared pages are counted once per process. */
  processMemoryMb: number;
  processes: number;
  threads: number;
  handles: number;
}

export interface ProcessesResponse {
  processes: ProcessDTO[];
  totals: Totals;
  bootedAt: string;
  serverTime: string;
  specs?: HostSpecs;
}

export interface SystemResponse {
  totals: Totals;
  history: Sample[];
  bootedAt: string;
  serverTime: string;
  specs?: HostSpecs;
}

/** Real values read from the machine running the app. */
export interface HostSpecs {
  hostName: string;
  os: string;
  cpuName: string;
  cores: number;
  logical: number;
  baseGhz: number;
  memoryTotalMb: number;
  userName: string;
  networkName: string;
  bootedAt: string;
}

export interface StartupDTO {
  id: number;
  name: string;
  publisher: string;
  command: string;
  enabled: boolean;
  impact: StartupImpact;
  createdAt: string;
  /** False when the entry is owned by Windows or an installer and can't be changed here. */
  manageable?: boolean;
}

export interface ServiceDTO {
  id: number;
  name: string;
  displayName: string;
  description: string;
  groupName: string;
  status: ServiceStatus;
  startupType: StartupType;
  pid: number | null;
  severity: Severity;
  impactNote: string;
}

export interface EventDTO {
  id: number;
  kind: string;
  title: string;
  detail: string;
  severity: Severity;
  snapshot: EventSnapshot | null;
  createdAt: string;
}

/**
 * Placeholders used only for the first paint, before the real readings arrive.
 * Every page replaces these with values from /api/processes or /api/system.
 */
export const SPECS = {
  hostName: "This PC",
  os: "Windows",
  cpuName: "Unknown CPU",
  cores: 1,
  logical: 1,
  baseGhz: 0,
  maxGhz: 0,
  memoryTotalMb: 0,
  memoryType: "",
  memorySlots: "",
  diskName: "",
  diskCapacityGb: 0,
  diskType: "",
  networkName: "",
  ssid: "",
  ipv4: "",
  gpuName: "",
  gpuMemoryGb: 0,
} as const;

export function maxSeverity(list: Severity[]): Severity {
  let best: Severity = "low";
  for (const s of list) if (SEVERITY_META[s].rank > SEVERITY_META[best].rank) best = s;
  return best;
}

export function fmtMem(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10240 ? 1 : 2)} GB`;
  if (mb >= 100) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

export function fmtPct(v: number): string {
  return `${v.toFixed(1)}%`;
}

export function fmtRate(v: number, unit: string): string {
  if (v < 0.05) return `0 ${unit}`;
  return `${v.toFixed(1)} ${unit}`;
}

export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d}:${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function fmtAgo(iso: string, now: number): string {
  const sec = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}
