"use client";

import { useState, type ReactNode } from "react";
import { FileWarning, Hourglass, ListTree, RotateCcw, Zap } from "lucide-react";
import { CATEGORY_SINGULAR, SEVERITIES, SEVERITY_META, fmtMem, maxSeverity, type ProcessDTO } from "@/lib/types";
import { Button, Modal, SEV_BG, SEV_PANEL, SEV_TEXT, SeverityIcon, cx } from "./ui";

function Consequence({ icon, tone, children }: { icon: ReactNode; tone?: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={cx("mt-0.5 shrink-0", tone ?? "text-muted")}>{icon}</span>
      <span className="min-w-0 text-sm">{children}</span>
    </li>
  );
}

export function EndTaskDialog({
  proc,
  kids,
  busy,
  onCancel,
  onConfirm,
}: {
  proc: ProcessDTO | null;
  kids: ProcessDTO[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (force: boolean) => void;
}) {
  // The acknowledgement is remembered per process, so opening the dialog for a
  // different task always starts unchecked without a reset effect.
  const [ackedId, setAckedId] = useState<number | null>(null);
  const id = proc?.id ?? null;
  const ack = id !== null && ackedId === id;

  if (!proc) return null;

  const group = [proc, ...kids];
  const severity = maxSeverity(group.map((p) => p.severity));
  const meta = SEVERITY_META[severity];
  const unsaved = group.filter((p) => p.unsavedWork);
  const memory = group.reduce((s, p) => s + p.memoryMb, 0);
  const cpu = group.reduce((s, p) => s + p.cpu, 0);
  const needsAck = meta.rank >= 2;
  const critical = severity === "critical";
  const riskyKid = kids.find((k) => SEVERITY_META[k.severity].rank > SEVERITY_META[proc.severity].rank);
  const kidNames = kids.slice(0, 3).map((k) => k.name).join(", ") + (kids.length > 3 ? ` and ${kids.length - 3} more` : "");

  return (
    <Modal
      open
      onClose={onCancel}
      title={`End ${proc.name}?`}
      description={`${proc.imageName} · PID ${proc.pid} · ${CATEGORY_SINGULAR[proc.category]}`}
      footer={
        <>
          <Button onClick={onCancel} data-autofocus>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} disabled={critical || (needsAck && !ack)} onClick={() => onConfirm(critical)}>
            {critical ? "Protected by Windows" : kids.length > 0 ? "End process tree" : "End task"}
          </Button>
        </>
      }
    >
      <div className={cx("rounded-lg border p-4", SEV_PANEL[severity])}>
        <div className="flex items-center gap-3">
          <SeverityIcon severity={severity} className="size-7 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium tracking-wide uppercase">Severity if you end it</p>
            <p className="text-base font-semibold">
              {meta.label} · {meta.summary}
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-1" role="img" aria-label={`Risk level ${meta.rank + 1} of 4`}>
          {SEVERITIES.map((s, i) => (
            <span key={s} className={cx("h-1.5 flex-1 rounded-full", i <= meta.rank ? SEV_BG[severity] : "bg-line-strong/60")} />
          ))}
        </div>
        <p className="mt-3 text-sm text-fg">{meta.explain}</p>
      </div>

      <h3 className="mt-5 mb-2 text-sm font-semibold">What happens if you end this task</h3>
      <ul className="space-y-2.5">
        <Consequence icon={<SeverityIcon severity={severity} className="size-4" />} tone={SEV_TEXT[severity]}>
          {proc.impactNote || meta.explain}
        </Consequence>

        {proc.status === "not_responding" ? (
          <Consequence icon={<Hourglass className="size-4" aria-hidden />} tone="text-sev-medium">
            {proc.name} is not responding. Ending it is usually the only way to recover, and Windows can&apos;t ask it to save first.
          </Consequence>
        ) : null}

        {unsaved.length > 0 ? (
          <Consequence icon={<FileWarning className="size-4" aria-hidden />} tone="text-sev-high">
            <strong className="font-semibold">Unsaved work will be lost</strong> in {unsaved.map((p) => p.name).join(", ")}. The app won&apos;t get a chance to save.
          </Consequence>
        ) : null}

        {kids.length > 0 ? (
          <Consequence icon={<ListTree className="size-4" aria-hidden />}>
            {kids.length} child process{kids.length === 1 ? "" : "es"} will end too: {kidNames}.
            {riskyKid ? ` ${riskyKid.name}: ${riskyKid.impactNote}` : ""}
          </Consequence>
        ) : null}

        <Consequence icon={<Zap className="size-4" aria-hidden />} tone="text-sev-low">
          Frees about <strong className="font-semibold">{fmtMem(memory)}</strong> of memory and {cpu.toFixed(1)}% CPU.
        </Consequence>

        {!critical ? (
          <Consequence icon={<RotateCcw className="size-4" aria-hidden />}>
            You can start it again later from Activity history or Run new task.
          </Consequence>
        ) : null}
      </ul>

      {critical ? (
        <p className="mt-5 rounded-lg border border-line-strong p-3 text-sm font-medium">
          Windows will not let any app end this process. It is listed so you can see what it is doing, not so it can be closed.
        </p>
      ) : needsAck ? (
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-line-strong p-3">
          <input type="checkbox" className="mt-0.5 size-4 accent-(--danger)" checked={ack} onChange={(e) => setAckedId(e.target.checked ? id : null)} />
          <span className="text-sm font-medium">
            I understand Windows may become unstable until this process is restarted.
          </span>
        </label>
      ) : null}
    </Modal>
  );
}
