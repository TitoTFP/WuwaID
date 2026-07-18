import { useEffect, useId, useRef } from "react";

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  destructive,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%_-_1.5rem)] max-w-sm border border-white/15 bg-bg-2 p-0 text-slate-100 backdrop:bg-black/70"
      role={destructive ? "alertdialog" : undefined}
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="w-full bg-bg-2 p-4 sm:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="font-serif text-xl text-slate-100">{title}</h2>
        <p id={messageId} className="mt-2 text-base leading-relaxed text-slate-400">{message}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-white/10 pt-3">
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={[
              "btn",
              destructive
                ? "border-rose-400/40 bg-rose-500/10 text-rose-200 hover:border-rose-300/60"
                : "btn-active",
            ].join(" ")}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
