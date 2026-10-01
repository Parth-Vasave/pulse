"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AlertIcon, CheckIcon, XIcon } from "@/components/icons";

type Tone = "success" | "error";
interface Toast { id: number; tone: Tone; text: string }
interface Api { success: (text: string) => void; error: (text: string) => void }

const ToastContext = createContext<Api>({ success: () => undefined, error: () => undefined });
export const useToast = () => useContext(ToastContext);

/** Confirmations for actions that happen "somewhere else" (pause, delete, send test…). */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((tone: Tone, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => dismiss(id), tone === "error" ? 8000 : 4000);
  }, [dismiss]);
  const api = useMemo<Api>(() => ({ success: (t) => push("success", t), error: (t) => push("error", t) }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,22rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} role={t.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-surface p-3 text-sm shadow-lg ${t.tone === "error" ? "border-down/50" : "border-up/50"}`}>
            <span className={`mt-0.5 ${t.tone === "error" ? "text-down" : "text-up"}`}>{t.tone === "error" ? <AlertIcon /> : <CheckIcon />}</span>
            <p className="flex-1">{t.text}</p>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="rounded p-0.5 text-muted hover:text-ink"><XIcon width={14} height={14} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
