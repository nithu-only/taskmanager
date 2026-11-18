"use client";

import { useState, type FormEvent } from "react";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  SEVERITIES,
  SEVERITY_META,
  type Category,
  type Priority,
  type ProcessDTO,
  type ProcessInput,
  type Severity,
} from "@/lib/types";
import { Button, Field, Modal, ProcIcon, cx, inputClass } from "./ui";

export type ProcessDraft = Partial<ProcessInput> & { name: string; imageName: string };

const MS = "Microsoft Corporation";
const TEMPLATES: ProcessDraft[] = [
  { name: "Notepad", imageName: "Notepad.exe", description: "Notepad", publisher: MS, category: "app", severity: "low", baseCpu: 0.2, baseMemoryMb: 42, commandLine: "C:\\Windows\\System32\\notepad.exe", impactNote: "The Notepad window closes. Files you already saved are not affected." },
  { name: "Calculator", imageName: "CalculatorApp.exe", description: "Calculator", publisher: MS, category: "app", severity: "low", baseCpu: 0.1, baseMemoryMb: 36, commandLine: "C:\\Program Files\\WindowsApps\\Microsoft.WindowsCalculator_8wekyb3d8bbwe\\CalculatorApp.exe", impactNote: "The Calculator window closes. Nothing is lost." },
  { name: "Paint", imageName: "mspaint.exe", description: "Paint", publisher: MS, category: "app", severity: "low", baseCpu: 0.3, baseMemoryMb: 88, commandLine: "C:\\Program Files\\WindowsApps\\Microsoft.Paint_8wekyb3d8bbwe\\PaintApp\\mspaint.exe", impactNote: "The Paint window closes. Nothing is lost unless you have an unsaved drawing." },
  { name: "Command Prompt", imageName: "cmd.exe", description: "Windows Command Processor", publisher: MS, category: "app", severity: "low", baseCpu: 0.1, baseMemoryMb: 12, commandLine: "C:\\Windows\\System32\\cmd.exe", impactNote: "The window closes and any command running in it is stopped." },
  { name: "Microsoft Edge", imageName: "msedge.exe", description: "Microsoft Edge", publisher: MS, category: "app", severity: "medium", baseCpu: 1.6, baseMemoryMb: 420, baseNetworkMbps: 0.4, commandLine: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", impactNote: "All Edge tabs close. Anything typed into web forms is lost." },
  { name: "Snipping Tool", imageName: "SnippingTool.exe", description: "Snipping Tool", publisher: MS, category: "app", severity: "low", baseCpu: 0.2, baseMemoryMb: 54, commandLine: "C:\\Program Files\\WindowsApps\\Microsoft.ScreenSketch_8wekyb3d8bbwe\\SnippingTool\\SnippingTool.exe", impactNote: "The Snipping Tool window closes. Screenshots already saved are kept." },
];

export interface ProcessFormValues {
  name: string;
  imageName: string;
  description: string;
  category: Category;
  severity: Severity;
  impactNote: string;
  priority: Priority;
  unsavedWork: boolean;
  baseMemoryMb: number;
  baseCpu: number;
  extra: ProcessDraft | null;
}

export function ProcessFormDialog({
  mode,
  initial,
  draft,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial?: ProcessDTO;
  draft?: ProcessFormValues;
  onClose: () => void;
  onSubmit: (values: ProcessFormValues) => void;
}) {
  const [name, setName] = useState(draft?.name ?? initial?.name ?? "");
  const [imageName, setImageName] = useState(draft?.imageName ?? initial?.imageName ?? "");
  const [description, setDescription] = useState(draft?.description ?? initial?.description ?? "");
  const [category, setCategory] = useState<Category>(draft?.category ?? initial?.category ?? "app");
  const [severity, setSeverity] = useState<Severity>(draft?.severity ?? initial?.severity ?? "low");
  const [impactNote, setImpactNote] = useState(draft?.impactNote ?? initial?.impactNote ?? "");
  const [priority, setPriority] = useState<Priority>(draft?.priority ?? initial?.priority ?? "normal");
  // Windows doesn't expose whether a process has unsaved work, so this is never editable.
  const unsavedWork = false;
  const [memory, setMemory] = useState(String(draft?.baseMemoryMb ?? 80));
  const [cpu, setCpu] = useState(String(draft?.baseCpu ?? 0.5));
  const [extra, setExtra] = useState<ProcessDraft | null>(draft?.extra ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isEdit = mode === "edit";
  const locked = isEdit && initial?.category === "windows";

  const applyTemplate = (t: ProcessDraft) => {
    setName(t.name);
    setImageName(t.imageName);
    setDescription(t.description ?? "");
    setCategory(t.category ?? "app");
    setSeverity(t.severity ?? "low");
    setImpactNote(t.impactNote ?? "");
    setMemory(String(t.baseMemoryMb ?? 80));
    setCpu(String(t.baseCpu ?? 0.5));
    setExtra(t);
    setErrors({});
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    const mem = Number(memory);
    const cpuN = Number(cpu);
    if (!name.trim()) next.name = "Enter a name so you can find the task in the list.";
    if (!isEdit) {
      if (!imageName.trim()) next.imageName = "Enter the program to run, for example notepad.exe.";
      if (memory.trim() === "" || !Number.isFinite(mem) || mem < 1 || mem > 65536) next.memory = "Enter a number between 1 and 65,536 MB.";
      if (cpu.trim() === "" || !Number.isFinite(cpuN) || cpuN < 0 || cpuN > 100) next.cpu = "Enter a number between 0 and 100.";
    }
    setErrors(next);
    const firstBad = Object.keys(next)[0];
    if (firstBad) {
      e.currentTarget.querySelector<HTMLElement>(`[data-field="${firstBad}"]`)?.focus();
      return;
    }
    onSubmit({
      name: name.trim(),
      imageName: imageName.trim(),
      description: description.trim(),
      category,
      severity,
      impactNote: impactNote.trim(),
      priority,
      unsavedWork,
      baseMemoryMb: mem,
      baseCpu: cpuN,
      extra: extra && extra.imageName === imageName.trim() ? extra : null,
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? `Edit ${initial?.name ?? "task"}` : "Run new task"}
      description={isEdit ? "Windows only lets an app change the priority of a running process. Everything else comes from the program itself." : "Start a program on the PC. Pick a common app or enter your own."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="process-form">
            {isEdit ? "Save priority" : "Run task"}
          </Button>
        </>
      }
    >
      <form id="process-form" onSubmit={submit} noValidate className="space-y-4">
        {!isEdit ? (
          <div>
            <p className="mb-1.5 text-sm font-medium">Quick start</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TEMPLATES.map((t) => (
                <button
                  key={t.imageName}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  aria-pressed={extra?.imageName === t.imageName && imageName === t.imageName}
                  className={cx(
                    "flex min-h-11 items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm",
                    extra?.imageName === t.imageName && imageName === t.imageName ? "border-accent bg-accent/8" : "border-line hover:bg-hover",
                  )}
                >
                  <ProcIcon name={t.name} />
                  <span className="min-w-0 truncate">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={errors.name}>
            {(p) => <input {...p} data-field="name" data-autofocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Notepad" disabled={isEdit} />}
          </Field>
          {!isEdit ? (
            <Field label="Program" error={errors.imageName} hint="The executable to open.">
              {(p) => <input {...p} data-field="imageName" className={inputClass} value={imageName} onChange={(e) => setImageName(e.target.value)} maxLength={80} placeholder="notepad.exe" autoCapitalize="off" spellCheck={false} />}
            </Field>
          ) : (
            <Field label="Priority">
              {(p) => (
                <select {...p} className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                  {PRIORITIES.map((x) => (
                    <option key={x} value={x}>
                      {PRIORITY_LABEL[x]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
        </div>

        {!isEdit ? (
          <Field label="Description">
            {(p) => <input {...p} className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="What this task is for" />}
          </Field>
        ) : (
          <p className="rounded-md border border-line bg-surface-2 p-3 text-sm text-muted">
            Raising a process above normal priority can make it more responsive, but it can also starve other programs and make Windows feel slower. Lowering it does the opposite.
          </p>
        )}

        {!isEdit ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type">
              {(p) => (
                <select {...p} className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                  <option value="app">App (has a window)</option>
                  <option value="background">Background process</option>
                </select>
              )}
            </Field>
            <Field label="Priority">
              {(p) => (
                <select {...p} className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                  {PRIORITIES.map((x) => (
                    <option key={x} value={x}>
                      {PRIORITY_LABEL[x]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Typical memory (MB)" error={errors.memory}>
              {(p) => <input {...p} data-field="memory" className={inputClass} inputMode="decimal" value={memory} onChange={(e) => setMemory(e.target.value)} />}
            </Field>
            <Field label="Typical CPU (%)" error={errors.cpu}>
              {(p) => <input {...p} data-field="cpu" className={inputClass} inputMode="decimal" value={cpu} onChange={(e) => setCpu(e.target.value)} />}
            </Field>
          </div>
        ) : null}

        {!isEdit ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Severity if closed" hint={locked ? "Managed by Windows for system processes." : undefined}>
              {(p) => (
                <select {...p} className={inputClass} value={severity} disabled={locked} onChange={(e) => setSeverity(e.target.value as Severity)}>
                  {SEVERITIES.filter((s) => s !== "critical" || severity === "critical").map((s) => (
                    <option key={s} value={s}>
                      {SEVERITY_META[s].label} · {SEVERITY_META[s].summary}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        ) : null}

        {!isEdit ? (
          <Field label="What happens if it is closed" hint={locked ? "Managed by Windows for system processes." : "Shown in the warning before this task is ended."}>
            {(p) => (
              <textarea
                {...p}
                className={cx(inputClass, "h-auto min-h-20 py-2 sm:h-auto")}
                value={impactNote}
                disabled={locked}
                onChange={(e) => setImpactNote(e.target.value)}
                maxLength={400}
                placeholder="For example: The window closes and nothing is lost."
              />
            )}
          </Field>
        ) : null}
      </form>
    </Modal>
  );
}
