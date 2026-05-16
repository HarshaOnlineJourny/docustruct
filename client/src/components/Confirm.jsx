import { createContext, useCallback, useContext, useState } from 'react';
import { IconAlert, IconClose } from './icons.jsx';

// Promise-based confirm dialog. Replaces window.confirm() so destructive
// flows match the rest of the design system. Usage:
//   const confirm = useConfirm();
//   if (!await confirm({ title, message, confirmLabel, danger: true })) return;
const ConfirmContext = createContext(async () => true);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);

  const ask = useCallback(({
    title = 'Are you sure?',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
  } = {}) => new Promise((resolve) => {
    setState({ title, message, confirmLabel, cancelLabel, danger, resolve });
  }), []);

  function close(value) {
    state?.resolve(value);
    setState(null);
  }

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {state && (
        <div role="dialog" aria-modal="true"
             onClick={() => close(false)}
             style={{
               position: 'fixed', inset: 0, zIndex: 70,
               background: 'rgba(15,23,42,0.45)',
               display: 'flex', alignItems: 'center', justifyContent: 'center',
               padding: 24,
             }}>
          <div className="card" onClick={(e) => e.stopPropagation()}
               style={{ maxWidth: 460, width: '100%', margin: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ color: state.danger ? 'var(--color-danger)' : 'var(--color-warning)', flex: 'none', marginTop: 2 }}>
                <IconAlert size={22} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ marginBottom: 6 }}>{state.title}</h3>
                {state.message && <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>{state.message}</p>}
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => close(false)} aria-label="close">
                <IconClose size={14} />
              </button>
            </div>
            <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => close(false)}>{state.cancelLabel}</button>
              <button className={'btn ' + (state.danger ? 'btn-danger' : 'btn-primary')}
                      autoFocus onClick={() => close(true)}>
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() { return useContext(ConfirmContext); }
