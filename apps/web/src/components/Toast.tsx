import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

/**
 * Toasts. Bottom-right, four seconds, semantic.
 *
 * Fires on freeze, reinstate, erasure, a record being written and a CSV being
 * processed — the moments where something changed and the person needs to know
 * it landed.
 */

export type ToastTone = 'ok' | 'warn' | 'stop' | 'info';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

type ShowToast = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<ShowToast>(() => {});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

const TONE_STYLES: Record<ToastTone, { box: string; icon: ReactNode }> = {
  ok: {
    box: 'border-ok-line bg-ok-bg text-ok-fg',
    icon: <CheckCircle2 size={18} />,
  },
  warn: {
    box: 'border-warn-line bg-warn-bg text-warn-fg',
    icon: <AlertTriangle size={18} />,
  },
  stop: {
    box: 'border-stop-line bg-stop-bg text-stop-fg',
    icon: <AlertTriangle size={18} />,
  },
  info: {
    box: 'border-new-line bg-new-bg text-new-fg',
    icon: <Info size={18} />,
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ShowToast>(
    (message, tone = 'ok') => {
      const id = nextId.current;
      nextId.current += 1;
      setItems((current) => [...current, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-2"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className={`pointer-events-auto flex max-w-md items-start gap-3 rounded-card border px-4 py-3 shadow-lg ${TONE_STYLES[item.tone].box}`}
          >
            <span className="mt-0.5 shrink-0">{TONE_STYLES[item.tone].icon}</span>
            <span className="text-cell leading-5">{item.message}</span>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label="Dismiss"
              className="ml-2 shrink-0 opacity-60 transition-opacity duration-fast hover:opacity-100"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
