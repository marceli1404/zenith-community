import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "../components/lucide";

/**
 * Minimal accessible toast system (external store, no provider needed).
 * Replaces browser alert(): non-blocking, announced via an aria-live region,
 * auto-dismissing, keyboard-dismissable. Call toast.success/error/info anywhere.
 */

export type ToastKind = "success" | "error" | "info";
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** Set while the exit transition plays, just before removal. */
  leaving?: boolean;
}

let counter = 0;
let items: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

function emit() {
  for (const l of listeners) l(items);
}

function push(kind: ToastKind, message: string) {
  const id = ++counter;
  items = [...items, { id, kind, message }];
  emit();
  setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3500);
}

/** Toasts leave the way they came in: mark, let the 200ms exit play, then remove. */
function dismiss(id: number) {
  if (!items.some((t) => t.id === id && !t.leaving)) return;
  items = items.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, reduced ? 0 : 200);
}

export const toast = {
  success: (m: string) => push("success", m),
  error: (m: string) => push("error", m),
  info: (m: string) => push("info", m),
};

const ICON = { success: CheckCircle2, error: AlertTriangle, info: Info };
const COLOR = { success: "var(--color-good)", error: "var(--color-bad)", info: "var(--color-accent)" };

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  return (
    <div
      className="fixed z-[200] bottom-4 right-4 left-4 sm:left-auto sm:w-80 flex flex-col gap-2 pointer-events-none"
      role="region"
      aria-label="Notifications"
    >
      <div aria-live="polite" aria-atomic="false" className="contents">
        {list.map((t) => {
          const Icon = ICON[t.kind];
          return (
            <div
              key={t.id}
              className="lx-toast pointer-events-auto flex items-start gap-2.5 bg-surface border border-border rounded-[var(--radius)] shadow-[var(--shadow-lg)] px-3.5 py-3"
              data-leaving={t.leaving || undefined}
            >
              <Icon size={17} style={{ color: COLOR[t.kind] }} className="mt-0.5 shrink-0" aria-hidden />
              <span className="text-sm text-text flex-1 min-w-0">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="text-subtle hover:text-text shrink-0"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
