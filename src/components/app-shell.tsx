"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Activity, ChevronRight, Cog, History, LayoutList, ListTree, Menu, MonitorCog, Moon, Power, Rocket, Sun, Users, X } from "lucide-react";
import { api, emitRefresh, errorMessage } from "@/lib/client";
import { SPECS, type HostSpecs, type SystemResponse } from "@/lib/types";
import { Button, Modal, ToastProvider, cx, useToast } from "./ui";

const NAV = [
  { href: "/", label: "Processes", icon: LayoutList },
  { href: "/performance", label: "Performance", icon: Activity },
  { href: "/history", label: "Activity history", icon: History },
  { href: "/startup", label: "Startup apps", icon: Rocket },
  { href: "/users", label: "Users", icon: Users },
  { href: "/details", label: "Details", icon: ListTree },
  { href: "/services", label: "Services", icon: Cog },
];

type OverlayKind = "refresh";
type ShowOverlay = (kind: OverlayKind, detail?: string) => Promise<void>;

const OverlayCtx = createContext<ShowOverlay>(async () => {});

/** Shows the refresh overlay and resolves when it is finished. */
export function useSystemOverlay() {
  return useContext(OverlayCtx);
}

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <Shell>{children}</Shell>
    </ToastProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [powerOpen, setPowerOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [overlay, setOverlay] = useState<{ kind: OverlayKind; detail?: string; progress: number } | null>(null);
  const [host, setHost] = useState<HostSpecs | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<SystemResponse>("/api/system")
      .then((data) => {
        if (!cancelled) setHost(data.specs ?? null);
      })
      .catch(() => {
        /* the pages show their own errors; the shell keeps its fallback labels */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const sync = (event?: Event) => {
      let next: "light" | "dark" = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      if (event instanceof StorageEvent && event.key === "tm-theme") {
        next = event.newValue === null ? "light" : event.newValue === "dark" ? "dark" : "light";
      } else {
        try {
          const stored = localStorage.getItem("tm-theme");
          if (stored === "light" || stored === "dark") next = stored;
        } catch {
          /* Storage can be unavailable in private browsing. */
        }
      }
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("tm:theme", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("tm:theme", sync);
    };
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    // Persist first: the sync handler also reads storage, and must never
    // overwrite the new choice with the previous value.
    try {
      localStorage.setItem("tm-theme", next);
    } catch {
      /* storage unavailable: the choice just won't persist */
    }
    document.documentElement.dataset.theme = next;
    setTheme(next);
    window.dispatchEvent(new Event("tm:theme"));
  };

  const showOverlay = useCallback<ShowOverlay>(
    (kind, detail) =>
      new Promise<void>((resolve) => {
        const duration = 2400;
        const start = Date.now();
        setOverlay({ kind, detail, progress: 0 });
        const timer = setInterval(() => {
          const progress = Math.min(100, Math.round(((Date.now() - start) / duration) * 100));
          setOverlay((o) => (o ? { ...o, progress } : o));
          if (progress >= 100) {
            clearInterval(timer);
            setOverlay(null);
            emitRefresh();
            resolve();
          }
        }, 140);
      }),
    [],
  );

  const currentLabel = NAV.find((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)))?.label ?? "Processes";
  const themeSwitch = (
    <div className="flex shrink-0 items-center gap-2.5">
      <span className="hidden text-xs text-muted sm:inline">{theme === "dark" ? "Dark" : "Light"} mode</span>
      <button
        type="button"
        role="switch"
        aria-label="Dark mode"
        aria-checked={theme === "dark"}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        onClick={toggleTheme}
        className={cx("relative h-6 w-11 rounded-full border transition-colors", theme === "dark" ? "border-accent bg-accent" : "border-line-strong bg-line")}
      >
        <Sun className="absolute top-1 left-1 size-3.5 text-muted" aria-hidden />
        <Moon className="absolute top-1 right-1 size-3.5 text-muted" aria-hidden />
        <span className={cx("absolute top-[3px] left-[3px] grid size-4 place-items-center rounded-full bg-surface text-fg shadow-sm transition-transform", theme === "dark" && "translate-x-5")}>
          {theme === "dark" ? <Moon className="size-2.5" aria-hidden /> : <Sun className="size-2.5" aria-hidden />}
        </span>
      </button>
    </div>
  );

  const nav = (
    <nav aria-label="Task Manager sections" className="flex flex-col gap-0.5 px-2">
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setNavOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cx(
              "relative flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors",
              active ? "bg-hover font-semibold text-fg" : "text-muted hover:bg-hover hover:text-fg",
            )}
          >
            {active ? <span className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-accent" aria-hidden /> : null}
            <Icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const sidebarFooter = (
    <div className="mt-auto border-t border-line p-3">
      <div className="rounded-md bg-surface-2 px-3 py-2">
        <p className="truncate text-xs font-semibold">{host?.hostName ?? SPECS.hostName}</p>
        <p className="truncate text-xs text-muted">{host?.os ?? SPECS.os}</p>
        <p className="text-xs text-muted">Live from this PC</p>
      </div>
      <div className="mt-2 flex gap-2">
        <Button size="sm" className="flex-1" onClick={toggleTheme} icon={theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}>
          {theme === "dark" ? "Light" : "Dark"}
        </Button>
        <Button
          size="sm"
          className="flex-1"
          onClick={() => {
            setNavOpen(false);
            setPowerOpen(true);
          }}
          icon={<Power className="size-4" aria-hidden />}
        >
          Refresh
        </Button>
      </div>
    </div>
  );

  const brand = (
    <div className="flex items-center gap-2.5 px-5">
      <span className="grid size-8 place-items-center rounded-md bg-accent text-accent-fg">
        <MonitorCog className="size-4.5" aria-hidden />
      </span>
      <span className="text-[15px] font-semibold">Task Manager</span>
    </div>
  );

  return (
    <OverlayCtx.Provider value={showOverlay}>
      <div className="flex h-dvh overflow-hidden">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lg">
          Skip to content
        </a>

        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
          <div className="flex h-16 items-center">{brand}</div>
          {nav}
          {sidebarFooter}
        </aside>

        {/* Mobile drawer */}
        {navOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="anim-fade absolute inset-0 bg-black/45" onClick={() => setNavOpen(false)} aria-hidden />
            <aside className="anim-fade relative flex h-full w-72 max-w-[85vw] flex-col border-r border-line bg-surface shadow-2xl">
              <div className="flex h-14 items-center justify-between pr-2">
                {brand}
                <button type="button" onClick={() => setNavOpen(false)} aria-label="Close menu" className="grid size-10 place-items-center rounded-md text-muted hover:bg-hover">
                  <X className="size-5" aria-hidden />
                </button>
              </div>
              {nav}
              {sidebarFooter}
            </aside>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface lg:hidden">
            <button type="button" onClick={() => setNavOpen(true)} aria-label="Open menu" aria-expanded={navOpen} className="grid size-10 place-items-center rounded-md hover:bg-hover">
              <Menu className="size-5" aria-hidden />
            </button>
            <span className="text-[15px] font-semibold">Task Manager</span>
            {themeSwitch}
          </div>
          <div className="hidden h-12 shrink-0 items-center justify-between border-b border-line bg-surface lg:flex">
            <div className="flex items-center gap-2 px-5 text-xs text-muted">
              <MonitorCog className="size-3.5" aria-hidden />
              <span>Workspace</span>
              <ChevronRight className="size-3 text-subtle" aria-hidden />
              <span className="font-medium text-fg">{currentLabel}</span>
            </div>
            {themeSwitch}
          </div>
          <main id="main" className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {children}
          </main>
        </div>
      </div>

      <PowerDialog open={powerOpen} onClose={() => setPowerOpen(false)} showOverlay={showOverlay} hostName={host?.hostName ?? SPECS.hostName} />
      {overlay ? <SystemOverlay {...overlay} /> : null}
    </OverlayCtx.Provider>
  );
}

function PowerDialog({ open, onClose, showOverlay, hostName }: { open: boolean; onClose: () => void; showOverlay: ShowOverlay; hostName: string }) {
  const toast = useToast();
  const [action, setAction] = useState<"refresh" | "clear-history">("refresh");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await api("/api/system", { method: "POST", json: { action } });
      onClose();
      await showOverlay("refresh");
      toast({
        tone: "success",
        title: action === "clear-history" ? "Activity history cleared" : "Readings refreshed",
        body:
          action === "clear-history"
            ? "The entries on the Activity history page were removed. Nothing else changed."
            : "The process list, CPU and memory were read again from Windows.",
      });
    } catch (err) {
      toast({ tone: "error", title: "That didn't work", body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const options = [
    {
      value: "refresh" as const,
      title: "Refresh the readings",
      body: "Reads the process list, CPU, memory and disk activity again right now instead of waiting for the next sample.",
    },
    {
      value: "clear-history" as const,
      title: "Clear the activity history",
      body: "Removes the entries on the Activity history page. Processes, services and startup apps are not touched.",
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Refresh or clear?"
      description={`${hostName} is your real PC, so nothing here restarts or shuts it down.`}
      footer={
        <>
          <Button onClick={onClose} data-autofocus>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={run}>
            {action === "clear-history" ? "Clear history" : "Refresh now"}
          </Button>
        </>
      }
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">What should happen</legend>
        {options.map((o) => (
          <label
            key={o.value}
            className={cx("flex cursor-pointer gap-3 rounded-lg border p-3", action === o.value ? "border-accent bg-accent/8" : "border-line hover:bg-hover")}
          >
            <input type="radio" name="power-action" className="mt-1 accent-(--accent)" checked={action === o.value} onChange={() => setAction(o.value)} />
            <span>
              <span className="block text-sm font-medium">{o.title}</span>
              <span className="mt-0.5 block text-sm text-muted">{o.body}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}

function SystemOverlay({ progress }: { kind: OverlayKind; detail?: string; progress: number }) {
  return (
    <div role="alert" aria-live="assertive" className="anim-fade fixed inset-0 z-[80] grid place-items-center bg-black text-white">
      <div className="flex flex-col items-center gap-5">
        <span className="size-10 animate-spin rounded-full border-[3px] border-white/25 border-t-white" aria-hidden />
        <p className="text-lg">Reading Windows…</p>
        <p className="text-sm text-white/70">The process list, CPU and memory are being read again.</p>
        <p className="text-xs tabular-nums text-white/50">{progress}%</p>
      </div>
    </div>
  );
}
