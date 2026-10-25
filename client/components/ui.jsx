import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icons.jsx';
import { api } from '../api.js';
import { initials } from '../format.js';

/* ---------- Toasts + confirm dialog ---------- */

const UICtx = createContext(null);

export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);

  const toast = useCallback((message, type = 'success') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 6000 : 3500);
  }, []);

  const confirm = useCallback((opts) => new Promise((resolve) => setDialog({ ...opts, resolve })), []);

  const close = (v) => { dialog.resolve(v); setDialog(null); };

  return (
    <UICtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <Icon name={t.type === 'error' ? 'alert' : 'checkCircle'} />
            {t.message}
          </div>
        ))}
      </div>
      {dialog && (
        <Modal title={dialog.title || 'Are you sure?'} onClose={() => close(false)}
          footer={<>
            <button className="btn" onClick={() => close(false)}>Cancel</button>
            <button className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)} autoFocus>{dialog.confirmText || 'Confirm'}</button>
          </>}>
          <p className="muted">{dialog.message}</p>
        </Modal>
      )}
    </UICtx.Provider>
  );
}

export const useUI = () => useContext(UICtx);

/* ---------- Data fetching ---------- */

export function useFetch(url) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(url)
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState({ data: null, loading: false, error: error.message }));
    return () => { alive = false; };
  }, [url, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

/** Debounced value for search boxes */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ---------- Layout bits ---------- */

export function PageHead({ title, subtitle, actions, back }) {
  return (
    <div className="page-head">
      <div>
        {back && <Link to={back.to} className="back-link"><Icon name="chevronLeft" size={14} />{back.label}</Link>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef();
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Modal wrapping a <form>; `onSubmit` may throw to show an error */
export function FormModal({ title, onClose, onSubmit, submitText = 'Save', cancelText = 'Cancel', children, wide }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit(new FormData(e.currentTarget));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose} wide={wide}>
      <form onSubmit={submit} id="modal-form">
        {error && <div className="alert error" style={{ marginBottom: 16 }}><Icon name="alert" />{error}</div>}
        {children}
        <div className="modal-foot" style={{ margin: '20px -22px -20px' }}>
          <button type="button" className="btn" onClick={onClose}>{cancelText}</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : submitText}</button>
        </div>
      </form>
    </Modal>
  );
}

export function Field({ label, required, hint, children, full }) {
  return (
    <div className={`field ${full ? 'full' : ''}`}>
      <label>{label}{required && <span className="req"> *</span>}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Select({ options, placeholder, ...props }) {
  return (
    <select className="input" {...props}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}

const TONE = { Verified: 'green', Active: 'green', Pending: 'amber', Rejected: 'red', Inactive: 'red', Alumni: 'blue' };
export function Badge({ children, tone, plain }) {
  return <span className={`badge ${tone || TONE[children] || ''} ${plain ? 'plain' : ''}`}>{children}</span>;
}

export function Stat({ icon, label, value, sub, tone }) {
  return (
    <div className="card stat">
      <div className={`icon-wrap ${tone || ''}`}><Icon name={icon} size={20} /></div>
      <div style={{ minWidth: 0 }}>
        <div className="label">{label}</div>
        <div className="value">{value}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon = 'file', title, text, action }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={24} /></div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export const Loading = () => <div className="loading"><div className="spinner" /></div>;

export function ErrorBox({ error, onRetry }) {
  return (
    <div className="alert error"><Icon name="alert" /><div style={{ flex: 1 }}>{error}</div>
      {onRetry && <button className="btn btn-sm" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <div className="pager"><span>{total} {total === 1 ? 'record' : 'records'}</span></div> : null;
  return (
    <div className="pager">
      <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <div className="row">
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><Icon name="chevronLeft" size={14} />Prev</button>
        <span>Page {page} of {pages}</span>
        <button className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next<Icon name="chevronRight" size={14} /></button>
      </div>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="search">
      <Icon name="search" size={16} />
      <input className="input" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function Avatar({ name, size }) {
  return <div className={`avatar ${size || ''}`}>{initials(name)}</div>;
}

/** Turn FormData into a plain object */
export const formObj = (fd) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
