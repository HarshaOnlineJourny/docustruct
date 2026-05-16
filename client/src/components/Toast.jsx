import { createContext, useCallback, useContext, useState } from 'react';
import { IconCheck, IconAlert, IconInfo, IconClose } from './icons.jsx';

const ToastContext = createContext({ push: () => {} });

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    const t = { id, kind: 'info', timeout: 4000, ...toast };
    setToasts((tt) => [...tt, t]);
    if (t.timeout) {
      setTimeout(() => setToasts((tt) => tt.filter((x) => x.id !== id)), t.timeout);
    }
    return id;
  }, []);
  const dismiss = (id) => setToasts((tt) => tt.filter((x) => x.id !== id));

  return (
    <ToastContext.Provider value={{ push, dismiss, success: (msg) => push({ kind: 'success', message: msg }), error: (msg) => push({ kind: 'error', message: msg, timeout: 7000 }), info: (msg) => push({ kind: 'info', message: msg }) }}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={'toast toast-' + t.kind}>
            <span>
              {t.kind === 'success' && <IconCheck />}
              {t.kind === 'error' && <IconAlert />}
              {t.kind === 'info' && <IconInfo />}
            </span>
            <div style={{ flex: 1 }}>
              {t.title && <div style={{ fontWeight: 600, marginBottom: 2 }}>{t.title}</div>}
              <div>{t.message}</div>
            </div>
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="close">
              <IconClose size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
