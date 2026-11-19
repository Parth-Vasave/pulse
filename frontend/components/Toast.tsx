"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AlertIcon, CheckIcon, XIcon } from "@/components/icons";

type Tone = "success" | "error";
interface Toast { id: number; tone: Tone; text: string }
interface Api { success: (text: string) => void; error: (text: string) => void }
interface ToastState { visible: Toast[]; pending: Toast[]; activeIds: number[] }

const MAX_TOASTS = 4;
const ToastContext = createContext<Api>({ success: () => undefined, error: () => undefined });
export const useToast = () => useContext(ToastContext);

function isHoverPointer(pointerType: string) {
  return pointerType !== "touch";
}

function ToastItem({
  toast,
  onDismiss,
  onActiveChange,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
  onActiveChange: (id: number, active: boolean) => void;
}) {
  const remainingRef = useRef(toast.tone === "error" ? 8000 : 4000);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverPointersRef = useRef<Set<number>>(new Set());
  const focusedRef = useRef(false);

  const isInteracting = () => hoverPointersRef.current.size > 0 || focusedRef.current;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const syncActivity = useCallback(() => {
    onActiveChange(toast.id, isInteracting());
  }, [onActiveChange, toast.id]);

  const startTimer = useCallback(() => {
    if (isInteracting() || timerRef.current !== null) return;
    if (remainingRef.current <= 0) {
      onDismiss(toast.id);
      return;
    }
    startedAtRef.current = performance.now();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      startedAtRef.current = null;
      remainingRef.current = 0;
      onDismiss(toast.id);
    }, remainingRef.current);
  }, [onDismiss, toast.id]);

  const pauseTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimer();
      if (startedAtRef.current !== null) {
        const elapsed = performance.now() - startedAtRef.current;
        remainingRef.current = Math.max(0, remainingRef.current - elapsed);
        startedAtRef.current = null;
      }
    }
  }, [clearTimer]);

  useEffect(() => {
    startTimer();
    return clearTimer;
  }, [startTimer, clearTimer]);

  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      onPointerEnter={(e) => {
        if (!isHoverPointer(e.pointerType)) return;
        hoverPointersRef.current.add(e.pointerId);
        syncActivity();
        pauseTimer();
      }}
      onPointerLeave={(e) => {
        if (!isHoverPointer(e.pointerType)) return;
        hoverPointersRef.current.delete(e.pointerId);
        syncActivity();
        startTimer();
      }}
      onPointerCancel={(e) => {
        if (!isHoverPointer(e.pointerType)) return;
        hoverPointersRef.current.delete(e.pointerId);
        syncActivity();
        startTimer();
      }}
      onFocusCapture={() => {
        focusedRef.current = true;
        syncActivity();
        pauseTimer();
      }}
      onBlurCapture={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        focusedRef.current = false;
        syncActivity();
        startTimer();
      }}
      className="toast-in pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-[15px] shadow-[0_12px_32px_-8px_rgb(0_0_0/0.25)]"
    >
      <span className={`mt-0.5 ${toast.tone === "error" ? "text-down" : "text-ink"}`}>
        {toast.tone === "error" ? <AlertIcon /> : <CheckIcon />}
      </span>
      <p className="flex-1 text-ink">{toast.text}</p>
      <button
        type="button"
        onClick={() => {
          clearTimer();
          onDismiss(toast.id);
        }}
        aria-label="Dismiss"
        className="rounded p-0.5 text-muted hover:text-ink"
      >
        <XIcon width={14} height={14} />
      </button>
    </div>
  );
}

/** Confirmations for actions that happen "somewhere else" (pause, delete, send test…). */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ToastState>({ visible: [], pending: [], activeIds: [] });

  const setActive = useCallback((id: number, active: boolean) => {
    setState((s) => {
      if (!s.visible.some((x) => x.id === id)) return s;
      const isAlreadyActive = s.activeIds.includes(id);
      if (active) {
        if (isAlreadyActive) return s;
        return { ...s, activeIds: [...s.activeIds, id] };
      }
      if (!isAlreadyActive) return s;
      const activeIds = s.activeIds.filter((x) => x !== id);
      if (s.pending.length === 0) {
        return { ...s, activeIds };
      }
      if (s.visible.length < MAX_TOASTS) {
        const [nextToast, ...restPending] = s.pending;
        return { visible: [...s.visible, nextToast], pending: restPending, activeIds };
      }
      const evictIndex = s.visible.findIndex((x) => !activeIds.includes(x.id));
      if (evictIndex === -1) {
        return { ...s, activeIds };
      }
      const [nextToast, ...restPending] = s.pending;
      const visible = [...s.visible.slice(0, evictIndex), ...s.visible.slice(evictIndex + 1), nextToast];
      return { visible, pending: restPending, activeIds };
    });
  }, []);

  const dismiss = useCallback((id: number) => {
    setState((s) => {
      if (!s.visible.some((x) => x.id === id)) return s;
      const visibleAfterRemove = s.visible.filter((x) => x.id !== id);
      const activeIds = s.activeIds.filter((x) => x !== id);
      if (s.pending.length > 0 && visibleAfterRemove.length < MAX_TOASTS) {
        const [nextToast, ...restPending] = s.pending;
        return { visible: [...visibleAfterRemove, nextToast], pending: restPending, activeIds };
      }
      return { visible: visibleAfterRemove, pending: s.pending, activeIds };
    });
  }, []);

  const push = useCallback((tone: Tone, text: string) => {
    const id = Date.now() + Math.random();
    const incoming: Toast = { id, tone, text };
    setState((s) => {
      if (s.visible.length < MAX_TOASTS) {
        return { ...s, visible: [...s.visible, incoming] };
      }
      const evictIndex = s.visible.findIndex((x) => !s.activeIds.includes(x.id));
      if (evictIndex !== -1) {
        const evictedId = s.visible[evictIndex].id;
        return {
          visible: [...s.visible.slice(0, evictIndex), ...s.visible.slice(evictIndex + 1), incoming],
          pending: s.pending,
          activeIds: s.activeIds.filter((x) => x !== evictedId),
        };
      }
      return { ...s, pending: [...s.pending, incoming] };
    });
  }, []);
  const api = useMemo<Api>(() => ({ success: (t) => push("success", t), error: (t) => push("error", t) }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,22rem)] flex-col gap-2">
        {state.visible.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} onActiveChange={setActive} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
