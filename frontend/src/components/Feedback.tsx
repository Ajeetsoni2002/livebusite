import { useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

/* Toasts and confirm/prompt dialogs that replace window.alert/confirm/prompt.
   Mount <FeedbackHost /> once; call toast(), confirmDialog() or promptDialog() anywhere. */

type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; message: string; kind: ToastKind };
type Ask = {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  input?: {
    label: string;
    placeholder?: string;
    minLength?: number;
    type?: string;
  };
  resolve: (value: string | boolean | null) => void;
};

const toastListeners = new Set<(t: ToastItem) => void>();
const askListeners = new Set<(a: Ask) => void>();
let nextId = 1;

export function toast(message: string, kind: ToastKind = "info") {
  const item = { id: nextId++, message, kind };
  toastListeners.forEach((listener) => listener(item));
}
export function confirmDialog(options: Omit<Ask, "resolve" | "input">) {
  return new Promise<boolean>((resolve) => {
    if (!askListeners.size) return resolve(window.confirm(options.title));
    askListeners.forEach((l) =>
      l({ ...options, resolve: (v) => resolve(v === true) }),
    );
  });
}
export function promptDialog(
  options: Omit<Ask, "resolve"> & { input: NonNullable<Ask["input"]> },
) {
  return new Promise<string | null>((resolve) => {
    if (!askListeners.size) return resolve(window.prompt(options.title));
    askListeners.forEach((l) =>
      l({
        ...options,
        resolve: (v) => resolve(typeof v === "string" ? v : null),
      }),
    );
  });
}

const icons = { success: CheckCircle2, error: AlertTriangle, info: Info };

export function FeedbackHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [ask, setAsk] = useState<Ask | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const onToast = (item: ToastItem) => {
      setToasts((list) => [...list.slice(-3), item]);
      setTimeout(
        () => setToasts((list) => list.filter((t) => t.id !== item.id)),
        item.kind === "error" ? 7000 : 4000,
      );
    };
    const onAsk = (next: Ask) => setAsk(next);
    toastListeners.add(onToast);
    askListeners.add(onAsk);
    return () => {
      toastListeners.delete(onToast);
      askListeners.delete(onAsk);
    };
  }, []);
  useEffect(() => {
    if (ask && !dialog.current?.open) dialog.current?.showModal();
  }, [ask]);
  const finish = (value: string | boolean | null) => {
    ask?.resolve(value);
    dialog.current?.close();
    setAsk(null);
  };
  return (
    <>
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = icons[t.kind];
          return (
            <div key={t.id} className={`toast ${t.kind}`}>
              <Icon size={18} aria-hidden />
              <p>{t.message}</p>
              <button
                aria-label="Dismiss notification"
                onClick={() =>
                  setToasts((list) => list.filter((x) => x.id !== t.id))
                }
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
      <dialog
        ref={dialog}
        className="confirm-dialog"
        aria-label={ask?.title}
        onCancel={(e) => {
          e.preventDefault();
          finish(ask?.input ? null : false);
        }}
      >
        {ask && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get("value");
              finish(ask.input ? String(value || "") : true);
            }}
          >
            <h2>{ask.title}</h2>
            {ask.body && <p>{ask.body}</p>}
            {ask.input && (
              <label>
                {ask.input.label}
                <input
                  name="value"
                  type={ask.input.type || "text"}
                  required
                  minLength={ask.input.minLength}
                  placeholder={ask.input.placeholder}
                  autoFocus
                />
              </label>
            )}
            <div className="row-actions">
              <button
                type="button"
                onClick={() => finish(ask.input ? null : false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={ask.danger ? "danger" : ""}
                autoFocus={!ask.input}
              >
                {ask.confirmLabel || "Confirm"}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
