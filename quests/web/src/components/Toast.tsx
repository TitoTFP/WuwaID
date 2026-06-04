import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type ToastVariant = "default" | "success" | "error" | "undo";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastInput {
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
  action?: ToastAction;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastContextValue {
  show: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
  success: (message: string, durationMs?: number) => number;
  error: (message: string, durationMs?: number) => number;
  undo: (message: string, onUndo: () => void, durationMs?: number) => number;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (toast: ToastInput) => {
      const id = ++counterRef.current;
      const item: ToastItem = { id, ...toast };
      setToasts((current) => [...current, item]);
      const duration = toast.durationMs ?? 3000;
      if (duration > 0) {
        window.setTimeout(() => dismiss(id), duration);
      }
      return id;
    },
    [dismiss],
  );

  const success = useCallback((message: string, durationMs?: number) => {
    return show({ message, variant: "success", durationMs });
  }, [show]);

  const error = useCallback((message: string, durationMs?: number) => {
    return show({ message, variant: "error", durationMs });
  }, [show]);

  const undo = useCallback((message: string, onUndo: () => void, durationMs?: number) => {
    return show({ message, variant: "undo", durationMs: durationMs ?? 5000, action: { label: "Undo", onClick: onUndo } });
  }, [show]);

  const value = useMemo<ToastContextValue>(
    () => ({ show, dismiss, success, error, undo }),
    [show, dismiss, success, error, undo],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[90vw] flex-col gap-2">
      {toasts.map((toast) => (
        <ToastView key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const variantClass =
    toast.variant === "success"
      ? "border-accent-teal/40 bg-accent-teal/10 text-slate-100"
      : toast.variant === "error"
        ? "border-rose-400/40 bg-rose-500/10 text-rose-100"
        : toast.variant === "undo"
          ? "border-accent-gold/40 bg-accent-gold/10 text-slate-100"
          : "border-white/10 bg-bg-2 text-slate-100";

  return (
    <div
      role="status"
      className={[
        "pointer-events-auto flex items-center gap-3 rounded-md border px-3 py-2 text-sm shadow-lg backdrop-blur-sm",
        variantClass,
      ].join(" ")}
    >
      <span className="flex-1">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="rounded border border-accent-gold/40 px-2 py-0.5 text-xs text-accent-gold hover:bg-accent-gold/10"
          onClick={() => {
            toast.action?.onClick();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        className="text-xs text-slate-400 hover:text-slate-200"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
