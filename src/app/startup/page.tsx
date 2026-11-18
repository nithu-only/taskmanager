"use client";

import { useState, type FormEvent } from "react";
import { Pencil, Plus, Rocket, SearchX, Trash2 } from "lucide-react";
import { Button, EmptyState, ErrorBanner, Field, Modal, PageHeader, Pill, ProcIcon, SkeletonRows, Switch, cx, inputClass, useToast } from "@/components/ui";
import { api, errorMessage, useLive } from "@/lib/client";
import { IMPACTS, IMPACT_LABEL, type StartupDTO, type StartupImpact } from "@/lib/types";

interface StartupResponse {
  apps: StartupDTO[];
}
interface Draft {
  name: string;
  publisher: string;
  command: string;
  impact: StartupImpact;
  enabled: boolean;
}

const IMPACT_RULE_NOTE = "Estimated from the app's name, not measured.";

function ImpactPill({ impact, enabled }: { impact: StartupImpact; enabled: boolean }) {
  if (!enabled) return <Pill>None</Pill>;
  return <Pill tone={impact === "high" ? "bad" : impact === "medium" ? "warn" : impact === "low" ? "good" : "neutral"}>{IMPACT_LABEL[impact]}</Pill>;
}

function StartupForm({ initial, isEdit, onClose, onSubmit }: { initial: Draft; isEdit: boolean; onClose: () => void; onSubmit: (d: Draft) => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!d.name.trim()) next.name = "Enter the app's name.";
    if (!d.command.trim()) next.command = "Enter the command that starts the app, for example C:\\Tools\\app.exe.";
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      e.currentTarget.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
      return;
    }
    onSubmit({ ...d, name: d.name.trim(), publisher: d.publisher.trim(), command: d.command.trim() });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit ${initial.name}` : "Add a startup app"}
      description="Startup apps open automatically each time you sign in."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="startup-form">
            {isEdit ? "Save changes" : "Add app"}
          </Button>
        </>
      }
    >
      <form id="startup-form" onSubmit={submit} noValidate className="space-y-4">
        <Field label="Name" error={errors.name}>
          {(p) => <input {...p} data-field="name" data-autofocus className={inputClass} value={d.name} maxLength={80} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Backup Tool" />}
        </Field>
        <Field label="Publisher (optional)">
          {(p) => <input {...p} className={inputClass} value={d.publisher} maxLength={120} onChange={(e) => setD({ ...d, publisher: e.target.value })} placeholder="Contoso Ltd." />}
        </Field>
        <Field label="Command" error={errors.command} hint="The program and any options it starts with.">
          {(p) => (
            <input {...p} data-field="command" className={cx(inputClass, "font-mono text-[13px]")} value={d.command} maxLength={400} spellCheck={false} autoCapitalize="off" onChange={(e) => setD({ ...d, command: e.target.value })} placeholder="C:\Tools\backup.exe --minimized" />
          )}
        </Field>
        <Field label="Startup impact" hint="How much the app slows down sign-in.">
          {(p) => (
            <select {...p} className={inputClass} value={d.impact} onChange={(e) => setD({ ...d, impact: e.target.value as StartupImpact })}>
              {IMPACTS.map((i) => (
                <option key={i} value={i}>
                  {IMPACT_LABEL[i]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <label className="flex cursor-pointer items-center gap-3">
          <input type="checkbox" className="size-4 accent-(--accent)" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} />
          <span className="text-sm font-medium">Enabled: open this app at sign-in</span>
        </label>
      </form>
    </Modal>
  );
}

export default function StartupPage() {
  const live = useLive<StartupResponse>("/api/startup", 15000);
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [form, setForm] = useState<{ id: number | null; draft: Draft; nonce: number } | null>(null);
  const [removing, setRemoving] = useState<StartupDTO | null>(null);

  const apps = live.data?.apps ?? [];
  const q = query.trim().toLowerCase();
  const shown = apps
    .filter((a) => (filter === "all" || a.enabled === (filter === "enabled")) && (q === "" || `${a.name} ${a.publisher} ${a.command}`.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const enabled = apps.filter((a) => a.enabled);

  const openCreate = () => setForm({ id: null, draft: { name: "", publisher: "", command: "", impact: "low", enabled: true }, nonce: Date.now() });
  const openEdit = (a: StartupDTO) => setForm({ id: a.id, draft: { name: a.name, publisher: a.publisher, command: a.command, impact: a.impact, enabled: a.enabled }, nonce: Date.now() });

  const toggle = async (a: StartupDTO, next: boolean) => {
    try {
      await live.mutate(
        (d) => ({ apps: d.apps.map((x) => (x.id === a.id ? { ...x, enabled: next } : x)) }),
        () => api(`/api/startup/${a.id}`, { method: "PATCH", json: { enabled: next } }),
      );
      toast({ tone: "success", title: `${a.name} ${next ? "enabled" : "disabled"}`, body: next ? "It will open the next time you sign in." : "It will no longer open when you sign in." });
    } catch (err) {
      toast({ tone: "error", title: `Couldn't update ${a.name}`, body: errorMessage(err) });
    }
  };

  const save = async (draft: Draft) => {
    const current = form;
    if (!current) return;
    setForm(null);
    try {
      if (current.id === null) {
        const temp: StartupDTO = { id: -Date.now(), ...draft, createdAt: new Date().toISOString() };
        await live.mutate(
          (d) => ({ apps: [...d.apps, temp] }),
          () => api("/api/startup", { method: "POST", json: draft }),
        );
        toast({ tone: "success", title: `Added ${draft.name}`, body: draft.enabled ? "It will open the next time you sign in." : "It is disabled for now." });
      } else {
        const id = current.id;
        await live.mutate(
          (d) => ({ apps: d.apps.map((x) => (x.id === id ? { ...x, ...draft } : x)) }),
          () => api(`/api/startup/${id}`, { method: "PATCH", json: draft }),
        );
        toast({ tone: "success", title: `Saved changes to ${draft.name}` });
      }
    } catch (err) {
      toast({ tone: "error", title: `Couldn't save ${draft.name}`, body: errorMessage(err) });
      setForm({ id: current.id, draft, nonce: Date.now() });
    }
  };

  const remove = async () => {
    const a = removing;
    if (!a) return;
    setRemoving(null);
    try {
      await live.mutate(
        (d) => ({ apps: d.apps.filter((x) => x.id !== a.id) }),
        () => api(`/api/startup/${a.id}`, { method: "DELETE" }),
      );
      toast({ tone: "success", title: `Removed ${a.name} from startup apps` });
    } catch (err) {
      toast({ tone: "error", title: `Couldn't remove ${a.name}`, body: errorMessage(err) });
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <PageHeader
        title="Startup apps"
        subtitle="Choose which apps open automatically when you sign in. Fewer startup apps means a faster sign-in."
        actions={
          <Button variant="primary" onClick={openCreate} icon={<Plus className="size-4" aria-hidden />}>
            Add startup app
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-2">
        {[
          ["Enabled", live.data ? `${enabled.length} of ${apps.length}` : "–"],
          ["Managed here", live.data ? `${apps.filter((a) => a.manageable).length} of ${apps.length}` : "–"],
          ["Read-only", live.data ? String(apps.filter((a) => !a.manageable).length) : "–"],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2.5">
            <p className="truncate text-xs font-medium text-muted">{k}</p>
            <p className="truncate text-base font-semibold tabular-nums sm:text-xl">{v}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search startup apps" aria-label="Search startup apps" className={cx(inputClass, "min-w-0 flex-1 basis-48")} />
        <label className="min-w-0">
          <span className="sr-only">Filter by status</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className={cx(inputClass, "w-auto", filter !== "all" && "border-accent font-medium")}>
            <option value="all">All apps</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
      </div>

      {live.error ? <ErrorBanner message={live.error} onRetry={() => void live.refresh()} /> : null}

      <div className="@container overflow-hidden rounded-lg border border-line bg-surface">
        {!live.data ? (
          <SkeletonRows rows={8} cols={3} />
        ) : apps.length === 0 ? (
          <EmptyState
            icon={<Rocket className="size-6" aria-hidden />}
            title="No startup apps"
            body="Nothing opens automatically when this PC starts. Add an app you always want running."
            action={
              <Button variant="primary" onClick={openCreate} icon={<Plus className="size-4" aria-hidden />}>
                Add startup app
              </Button>
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<SearchX className="size-6" aria-hidden />}
            title="No startup apps match"
            body="Try a different search or show all apps."
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
                <th scope="col" className="hidden border-b border-line bg-surface-2 px-3 py-2.5 font-medium @4xl:table-cell">Command</th>
                <th scope="col" title={IMPACT_RULE_NOTE} className="hidden border-b border-line bg-surface-2 px-3 py-2.5 font-medium @md:table-cell">Startup impact</th>
                <th scope="col" className="border-b border-line bg-surface-2 px-3 py-2.5 font-medium">Status</th>
                <th scope="col" className="border-b border-line bg-surface-2 px-3 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id} className={cx("hover:bg-hover", a.id < 0 && "opacity-60")}>
                  <td className="w-full max-w-0 border-b border-line px-3 py-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProcIcon name={a.name} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{a.name}</p>
                        <p className="truncate text-xs text-muted">{a.publisher || "Unknown publisher"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden max-w-[280px] border-b border-line px-3 py-2 @4xl:table-cell">
                    <code className="block truncate font-mono text-xs text-muted" title={a.command}>{a.command}</code>
                  </td>
                  <td className="hidden border-b border-line px-3 py-2 whitespace-nowrap @md:table-cell">
                    <ImpactPill impact={a.impact} enabled={a.enabled} />
                  </td>
                  <td className="border-b border-line px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Switch checked={a.enabled} disabled={a.manageable === false} onChange={(next) => void toggle(a, next)} label={`Open ${a.name} at startup`} />
                      <span className="hidden w-16 text-xs text-muted @lg:inline">{a.enabled ? "Enabled" : "Disabled"}</span>
                    </div>
                  </td>
                  <td className="border-b border-line px-1 py-2 whitespace-nowrap">
                    <div className="flex justify-end">
                      <button type="button" disabled={a.manageable === false} onClick={() => openEdit(a)} aria-label={`Edit ${a.name}`} title={a.manageable === false ? "Windows or an installer owns this entry, so it can't be changed here" : "Edit"} className="grid size-9 place-items-center rounded-md text-muted hover:bg-line hover:text-fg disabled:opacity-40">
                        <Pencil className="size-4" aria-hidden />
                      </button>
                      <button type="button" disabled={a.manageable === false} onClick={() => setRemoving(a)} aria-label={`Remove ${a.name}`} title={a.manageable === false ? "Windows or an installer owns this entry, so it can't be removed here" : "Remove"} className="grid size-9 place-items-center rounded-md text-muted hover:bg-sev-critical/10 hover:text-sev-critical disabled:opacity-40">
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-muted">Changes are written to your Windows startup settings immediately. Entries owned by Windows or an installer can only be changed from Windows Settings.</p>

      {form ? <StartupForm key={form.nonce} initial={form.draft} isEdit={form.id !== null} onClose={() => setForm(null)} onSubmit={(d) => void save(d)} /> : null}

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        size="sm"
        title={`Remove ${removing?.name ?? "app"} from startup?`}
        description="The app itself stays installed. It just won't be listed here or open at sign-in any more."
        footer={
          <>
            <Button onClick={() => setRemoving(null)} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Remove
            </Button>
          </>
        }
      />
    </div>
  );
}
