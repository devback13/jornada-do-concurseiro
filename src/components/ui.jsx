import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X, XCircle, Loader2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const remove = useCallback((id) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback((message, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    const t = { id, message, type: opts.type || 'success', title: opts.title, action: opts.action };
    setItems((l) => [...l.slice(-3), t]);
    setTimeout(() => remove(id), opts.duration || (t.type === 'error' ? 7000 : 4500));
  }, [remove]);
  const Icon = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => {
          const I = Icon[t.type] || Info;
          return (
            <div key={t.id} className={`toast toast-${t.type}`}>
              <I size={20} className="toast-icon" />
              <div className="toast-body">
                {t.title && <strong>{t.title}</strong>}
                <span>{t.message}</span>
                {t.action && <button className="link-btn" onClick={() => { t.action.onClick(); remove(t.id); }}>{t.action.label}</button>}
              </div>
              <button className="icon-btn sm" aria-label="Fechar" onClick={() => remove(t.id)}><X size={16} /></button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Modal / Confirmação
// ---------------------------------------------------------------------------
export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirmar', danger, onConfirm, onCancel, loading }) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm"
      footer={<>
        <button className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={loading}>
          {loading && <Loader2 size={16} className="spin" />} {confirmLabel}
        </button>
      </>}>
      <p className="muted">{message}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Diversos
// ---------------------------------------------------------------------------
export function Badge({ tone = 'muted', children, dot, className = '' }) {
  return <span className={`badge badge-${tone} ${className}`}>{dot && <span className="badge-dot" />}{children}</span>;
}

export function Spinner({ size = 20, label }) {
  return <span className="spinner-wrap"><Loader2 size={size} className="spin" />{label && <span>{label}</span>}</span>;
}

export function EmptyState({ icon: Icon, title, children, actions }) {
  return (
    <div className="empty">
      {Icon && <div className="empty-icon"><Icon size={32} /></div>}
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value}
          className={`tab ${value === t.value ? 'active' : ''}`} onClick={() => onChange(t.value)}>
          {t.icon && <t.icon size={17} />}
          {t.label}
          {t.badge ? <span className="tab-badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, required, children, className = '', error }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}{required && <span className="req" aria-hidden> *</span>}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Campo de etiquetas: Enter ou vírgula adiciona. */
export function TagInput({ value = [], onChange, placeholder, suggestions }) {
  const [text, setText] = useState('');
  const add = (raw) => {
    const items = raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).filter((s) => !value.includes(s));
    if (items.length) onChange([...value, ...items]);
    setText('');
  };
  const listId = useRef(`tags-${Math.random().toString(36).slice(2)}`).current;
  return (
    <div className="tag-input" onClick={(e) => e.currentTarget.querySelector('input')?.focus()}>
      {value.map((t) => (
        <span key={t} className="tag">
          {t}
          <button type="button" aria-label={`Remover ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}><X size={13} /></button>
        </span>
      ))}
      <input
        value={text}
        list={suggestions ? listId : undefined}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => (/[,;]$/.test(e.target.value) ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(text); }
          if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text && add(text)}
      />
      {suggestions && <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
    </div>
  );
}

export function Segmented({ options, value, onChange, size }) {
  return (
    <div className={`segmented ${size === 'sm' ? 'segmented-sm' : ''}`} role="radiogroup">
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return (
          <button type="button" key={v} role="radio" aria-checked={value === v}
            className={value === v ? 'active' : ''} onClick={() => onChange(v)}>{l}</button>
        );
      })}
    </div>
  );
}

/** Anel de progresso circular. */
export function Ring({ value = 0, size = 120, stroke = 10, tone = 'primary', children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="ring-track" />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className={`ring-bar ring-${tone}`}
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  );
}

export function useDebouncedCallback(fn, delay) {
  const t = useRef();
  const f = useRef(fn);
  f.current = fn;
  useEffect(() => () => clearTimeout(t.current), []);
  return useCallback((...args) => {
    clearTimeout(t.current);
    t.current = setTimeout(() => f.current(...args), delay);
  }, [delay]);
}
