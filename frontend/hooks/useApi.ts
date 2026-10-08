"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api";

interface State<T> {
  data: T | undefined;
  error: ApiError | Error | undefined;
  loading: boolean;
  /** When `data` last loaded successfully (ms since epoch). */
  updatedAt: number | undefined;
}

/** Fetch `path` and refresh every `refreshMs` (paused while the tab is hidden). */
export function useApi<T>(path: string | null, refreshMs = 0) {
  const [state, setState] = useState<State<T>>({ data: undefined, error: undefined, loading: !!path, updatedAt: undefined });
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async () => {
    const current = pathRef.current;
    if (!current) return;
    try {
      const data = await api<T>(current);
      if (pathRef.current === current) setState({ data, error: undefined, loading: false, updatedAt: Date.now() });
    } catch (e) {
      if (pathRef.current === current) setState((s) => ({ ...s, error: e as Error, loading: false }));
    }
  }, []);

  useEffect(() => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true }));
    load();
    if (!refreshMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, refreshMs);
    return () => clearInterval(id);
  }, [path, refreshMs, load]);

  return { ...state, reload: load };
}
