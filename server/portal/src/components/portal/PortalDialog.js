// PortalDialog.js — lightweight confirm/alert modal, replacing window.confirm/alert
// (owner directive 2026-09-05: no third-party dialog library — this app has zero UI
// framework by design, adding one just for dialogs would cut against that). Styled
// with the same tokens/classes as everything else in this app (globals.css --s1/--b1/
// --text/--dim, .btn/.btn-primary/.btn-ghost/.btn-danger) — no new CSS file needed.
//
// Usage: wrap once at the root (see layout.js), then anywhere below it:
//   const { confirm, alert } = usePortalDialog();
//   if (!(await confirm('Delete this?', { danger: true }))) return;
//   await alert('Saved.');
// Both return a Promise — confirm() resolves true/false, alert() resolves once
// dismissed. This mirrors window.confirm/alert's call shape so replacing a call site
// is a small, mechanical diff (add `await`, swap the function).
'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const DialogContext = createContext(null);

export function PortalDialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolverRef = useRef(null);

  const close = useCallback((result) => {
    setDialog(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    if (resolve) resolve(result);
  }, []);

  const confirm = useCallback((message, opts = {}) => new Promise((resolve) => {
    resolverRef.current = resolve;
    setDialog({
      mode: 'confirm', message, title: opts.title,
      confirmLabel: opts.confirmLabel || 'Confirm',
      cancelLabel: opts.cancelLabel || 'Cancel',
      danger: !!opts.danger,
    });
  }), []);

  const alert = useCallback((message, opts = {}) => new Promise((resolve) => {
    resolverRef.current = resolve;
    setDialog({ mode: 'alert', message, title: opts.title, okLabel: opts.okLabel || 'OK' });
  }), []);

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      {dialog && <DialogModal dialog={dialog} onClose={close} />}
    </DialogContext.Provider>
  );
}

export function usePortalDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('usePortalDialog() must be called within PortalDialogProvider');
  return ctx;
}

function DialogModal({ dialog, onClose }) {
  const { mode, title, message, confirmLabel, cancelLabel, okLabel, danger } = dialog;

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="presentation"
      onClick={() => onClose(false)}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(22,32,46,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16,
      }}
    >
      <div
        role="alertdialog" aria-modal="true" aria-label={title || (mode === 'alert' ? 'Notice' : 'Confirm')}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--s1)', border: '2px solid var(--b1)', borderRadius: 'var(--r)',
          padding: 22, maxWidth: 440, width: '100%',
          boxShadow: '0 20px 50px rgba(22,32,46,.28)',
        }}
      >
        {title && (
          <div style={{ fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 17, color: 'var(--text)', marginBottom: 8 }}>
            {title}
          </div>
        )}
        <div style={{ fontSize: 14, color: 'var(--dim)', lineHeight: 1.55, marginBottom: 20, whiteSpace: 'pre-wrap' }}>
          {message}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {mode === 'confirm' && (
            <button type="button" className="btn btn-ghost" onClick={() => onClose(false)}>
              {cancelLabel}
            </button>
          )}
          <button
            type="button" autoFocus
            className={`btn ${mode === 'alert' ? 'btn-primary' : (danger ? 'btn-danger' : 'btn-primary')}`}
            onClick={() => onClose(true)}
          >
            {mode === 'alert' ? okLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
