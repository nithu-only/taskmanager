"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(url: string, init?: { method?: string; json?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? "GET",
      cache: "no-store",
      headers: init?.json !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError((data && typeof data.error === "string" && data.error) || `The request failed (${res.status}).`, res.status);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

const REFRESH_EVENT = "tm:refresh";

/** Ask every live view on the page to re-fetch now. */
export function emitRefresh() {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

/**
 * Polls a JSON endpoint and supports optimistic mutations.
 * Responses that started before a mutation finished are discarded, so stale
 * polls can never overwrite an optimistic update.
 */
export function useLive<T>(url: string, intervalMs: number | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef<T | null>(null);
  const epoch = useRef(0);

  const commit = useCallback((next: T | null) => {
    dataRef.current = next;
    setData(next);
  }, []);

  const inFlight = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const refresh = useCallback(async () => {
    if (inFlight.current > 0) return;
    const started = epoch.current;
    try {
      const next = await api<T>(url);
      if (epoch.current !== started || inFlight.current > 0) return;
      commit(next);
      setError(null);
    } catch (err) {
      if (epoch.current === started) setError(errorMessage(err));
    }
  }, [url, commit]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (document.visibilityState === "visible" || dataRef.current === null) await refresh();
      if (!cancelled && intervalMs) timer = setTimeout(loop, intervalMs);
    };
    void loop();
    const onRefresh = () => void refresh();
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener(REFRESH_EVENT, onRefresh);
    };
  }, [refresh, intervalMs]);

  const mutate = useCallback(
    async <R,>(optimistic: ((current: T) => T) | null, action: () => Promise<R>): Promise<R> => {
      epoch.current++;
      inFlight.current++;
      const previous = dataRef.current;
      if (optimistic && previous) commit(optimistic(previous));
      // Requests run one after another so quick successive actions (stop, then
      // start) always reach the server in the order the user made them.
      const result = chain.current.then(action);
      chain.current = result.catch(() => undefined);
      try {
        return await result;
      } catch (err) {
        if (optimistic && inFlight.current === 1) commit(previous);
        throw err;
      } finally {
        epoch.current++;
        inFlight.current--;
        void refresh();
      }
    },
    [commit, refresh],
  );

  return { data, error, loading: data === null && error === null, refresh, mutate };
}
