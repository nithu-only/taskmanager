"use client";

import { useState } from "react";
import { FileWarning, ListTree, Zap } from "lucide-react";
import { treeClosure } from "@/lib/selection";
import { SEVERITY_META, fmtMem, maxSeverity, type ProcessDTO } from "@/lib/types";
import { Button, Modal, SEV_BG, SEV_PANEL, SEV_TEXT, SeverityIcon, cx } from "./ui";

export function BulkEndDialog({
  selected,
  all,
  busy,
  onCancel,
  onConfirm,
}: {
  selected: ProcessDTO[];
  all: ProcessDTO[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (force: boolean) => void;
}) {
  const [ack, setAck] = useState(false);
  const affected = treeClosure(selected.map((p) => p.id), all);
  const severity = maxSeverity(affected.map((p) => p.severity));
  const meta = SEVERITY_META[severity];
  const critical = severity === "critical";
  const needsAck = severity === "high" || severity === "critical";
  const criticalTasks = affected.filter((p) => p.severity === "critical");
  const unsaved = affected.filter((p) => p.unsavedWork);
  const memory = affected.reduce((s, p) => s + p.memoryMb, 0);
  const cpu = affected.reduce((s, p) => s + p.cpu, 0);
  const extra = affected.length - selected.length;

  return (
    <Modal
      open
      onClose={onCancel}
      title={`End ${selected.length} selected task${selected.length === 1 ? "" : "s"}?`}
      description={`${affected.length} process${affected.length === 1 ? "" : "es"} will be affected${extra > 0 ? `, including ${extra} child process${extra === 1 ? "" : "es"}` : ""}.`}
      footer={
        <>
          <Button onClick={onCancel} data-autofocus>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} disabled={critical || (needsAck && !ack)} onClick={() => onConfirm(critical)}>
            {critical ? "Protected by Windows" : `End ${selected.length} task${selected.length === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className={cx("rounded-lg border p-4", SEV_PANEL[severity])}>
        <div className="flex items-center gap-3">
          <SeverityIcon severity={severity} className="size-7 shrink-0" />
          <div>
            <p className="text-xs font-medium tracking-wide uppercase">Highest severity if you end these tasks</p>
            <p className="text-base font-semibold">
              {meta.label} · {meta.summary}
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm text-fg">{meta.explain}</p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          ["Selected tasks", String(selected.length)],
          ["Processes affected", String(affected.length)],
          ["Memory freed", fmtMem(memory)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line p-2.5">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-0.5 text-base font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <h3 className="mt-5 mb-2 text-sm font-semibold">Selected tasks</h3>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {selected.slice(0, 6).map((p) => (
          <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className={cx("size-2 shrink-0 rounded-full", SEV_BG[p.severity])} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className={cx("shrink-0 text-xs", SEV_TEXT[p.severity])}>{SEVERITY_META[p.severity].label}</span>
          </li>
        ))}
      </ul>
      {selected.length > 6 ? <p className="mt-1 text-xs text-muted">And {selected.length - 6} more selected tasks.</p> : null}

      {criticalTasks.length > 0 ? (
        <div className="mt-4 rounded-lg border border-sev-critical/45 bg-sev-critical/10 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-sev-critical">
            <SeverityIcon severity="critical" className="size-4" />
            Windows protects this selection
          </p>
          <p className="mt-1 text-sm text-fg">
            The selection includes {criticalTasks.map((p) => p.name).join(", ")}. Windows will refuse to end core system processes, so remove them from the selection to continue.
          </p>
        </div>
      ) : null}

      {unsaved.length > 0 ? (
        <p className="mt-3 flex gap-2 text-sm">
          <FileWarning className="mt-0.5 size-4 shrink-0 text-sev-high" aria-hidden />
          <span>
            <strong className="font-semibold">Unsaved work will be lost</strong> in {unsaved.map((p) => p.name).join(", ")}.
          </span>
        </p>
      ) : null}

      {extra > 0 ? (
        <p className="mt-3 flex gap-2 text-sm text-muted">
          <ListTree className="mt-0.5 size-4 shrink-0" aria-hidden />
          Child processes of every selected task are included, even if they weren&apos;t selected.
        </p>
      ) : null}

      <p className="mt-3 flex gap-2 text-sm">
        <Zap className="mt-0.5 size-4 shrink-0 text-sev-low" aria-hidden />
        <span>Frees about {fmtMem(memory)} of memory and {cpu.toFixed(1)}% CPU. Ended tasks can be run again from Activity history.</span>
      </p>

      {needsAck && !critical ? (
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-line-strong p-3">
          <input type="checkbox" className="mt-0.5 size-4 accent-(--danger)" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span className="text-sm font-medium">I understand Windows may become unstable until these processes are restarted.</span>
        </label>
      ) : null}
    </Modal>
  );
}
