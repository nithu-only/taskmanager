"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { AlertCircle, AlertOctagon, AlertTriangle, CheckCircle2, Info, Loader2, ShieldCheck, X } from "lucide-react";
import { SEVERITY_META, type Severity } from "@/lib/types";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ───────────── Button ───────────── */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dangerOutline";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "border border-transparent bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface text-fg hover:bg-hover",
  ghost: "border border-transparent text-fg hover:bg-hover",
  danger: "border border-transparent bg-danger text-danger-fg hover:opacity-90",
  dangerOutline: "border border-sev-critical/45 bg-surface text-sev-critical hover:bg-sev-critical/10",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = "secondary", size = "md", loading, icon, children, className, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      disabled={disabled || loading}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-10 px-3.5 text-sm sm:h-9",
        VARIANT_CLASS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export const inputClass =
  "h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-fg placeholder:text-subtle hover:border-subtle focus:border-accent sm:h-9";

/* ───────────── Modal ───────────── */

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = panel.current;
    const focusables = () => (el ? Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)) : []);
    (el?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0] ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === "Tab") {
        const list = focusables();
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !el?.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !el?.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="anim-fade absolute inset-0 bg-black/45" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          "anim-pop relative flex max-h-[92dvh] w-full flex-col rounded-t-xl border border-line bg-surface shadow-2xl outline-none sm:rounded-xl",
          size === "sm" ? "sm:max-w-md" : size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg",
        )}
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg leading-snug font-semibold text-balance">
              {title}
            </h2>
            {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-mt-1 -mr-2 grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        {children ? <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div> : null}
        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t border-line bg-surface-2 px-5 py-3 sm:flex-row sm:justify-end sm:rounded-b-xl">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ───────────── Badges ───────────── */

const SEV_CLASS: Record<Severity, string> = {
  low: "border-sev-low/35 bg-sev-low/10 text-sev-low",
  medium: "border-sev-medium/40 bg-sev-medium/12 text-sev-medium",
  high: "border-sev-high/40 bg-sev-high/12 text-sev-high",
  critical: "border-sev-critical/45 bg-sev-critical/12 text-sev-critical",
};

export const SEV_TEXT: Record<Severity, string> = {
  low: "text-sev-low",
  medium: "text-sev-medium",
  high: "text-sev-high",
  critical: "text-sev-critical",
};

export const SEV_BG: Record<Severity, string> = {
  low: "bg-sev-low",
  medium: "bg-sev-medium",
  high: "bg-sev-high",
  critical: "bg-sev-critical",
};

export const SEV_PANEL: Record<Severity, string> = SEV_CLASS;

export function SeverityIcon({ severity, className }: { severity: Severity; className?: string }) {
  const Icon = severity === "low" ? ShieldCheck : severity === "medium" ? AlertCircle : severity === "high" ? AlertTriangle : AlertOctagon;
  return <Icon className={className ?? "size-3.5"} aria-hidden />;
}

export function SeverityBadge({ severity, showSummary, title }: { severity: Severity; showSummary?: boolean; title?: string }) {
  const meta = SEVERITY_META[severity];
  return (
    <span
      title={title ?? `${meta.label} severity: ${meta.summary}`}
      className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", SEV_CLASS[severity])}
    >
      <SeverityIcon severity={severity} className="size-3.5 shrink-0" />
      {meta.label}
      {showSummary ? <span className="font-normal"> · {meta.summary}</span> : null}
    </span>
  );
}

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad"; children: ReactNode }) {
  const cls =
    tone === "good"
      ? "border-sev-low/35 bg-sev-low/10 text-sev-low"
      : tone === "warn"
        ? "border-sev-medium/40 bg-sev-medium/12 text-sev-medium"
        : tone === "bad"
          ? "border-sev-critical/45 bg-sev-critical/12 text-sev-critical"
          : "border-line-strong bg-surface-2 text-muted";
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", cls)}>{children}</span>;
}

/* ───────────── Process icon ───────────── */

export function ProcIcon({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/);
  const letters = ((words[0]?.[0] ?? "?") + (words.length > 1 ? (words[1]?.[0] ?? "") : "")).toUpperCase();
  return (
    <span
      aria-hidden
      className={cx(
        "grid shrink-0 place-items-center rounded-[5px] font-semibold text-white select-none",
        size === "lg" ? "size-10 text-sm" : "size-6 text-[10px]",
      )}
      style={{ backgroundColor: `hsl(${hash} 48% 36%)` }}
    >
      {letters}
    </span>
  );
}

/* ───────────── Switch ───────────── */

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50",
        checked ? "border-accent bg-accent" : "border-subtle bg-surface",
      )}
    >
      <span className={cx("inline-block size-3.5 rounded-full transition-transform", checked ? "translate-x-6 bg-accent-fg" : "translate-x-1 bg-muted")} />
    </button>
  );
}

/* ───────────── Layout helpers ───────────── */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-xl leading-tight font-semibold sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-surface-2 text-muted">{icon}</div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-sev-critical/45 bg-sev-critical/10 px-4 py-3 text-sm">
      <AlertTriangle className="size-4 shrink-0 text-sev-critical" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Live data isn&apos;t updating.</span> {message}
      </p>
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function SkeletonRows({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          <div className="skeleton size-6 shrink-0" />
          <div className="skeleton h-3.5 flex-1" style={{ maxWidth: `${38 + ((r * 17) % 30)}%` }} />
          <div className="flex-1" />
          {Array.from({ length: cols - 1 }).map((__, c) => (
            <div key={c} className={cx("skeleton h-3.5 w-14", c > 1 && "hidden sm:block")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode }) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children({ id, "aria-describedby": hint || error ? noteId : undefined, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={noteId} className="mt-1 text-xs font-medium text-sev-critical">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="mt-1 text-xs text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* ───────────── Toasts ───────────── */

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}

const ToastCtx = createContext<(t: Omit<ToastItem, "id">) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === "error" ? 8000 : 4500);
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="anim-pop pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-lg"
          >
            {t.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-sev-low" aria-hidden />
            ) : t.tone === "error" ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-sev-critical" aria-hidden />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.title}</p>
              {t.body ? <p className="mt-0.5 text-sm text-muted">{t.body}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="-mt-1 -mr-2 grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
