import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Icon from './Icons.jsx';
import { Empty, ErrorBox, Field, FormModal, Loading, PageHead, Pager, SearchBox, Select, useFetch, useUI } from './ui.jsx';
import { ExportButton, useList, useMeta } from '../pages/admin/common.jsx';
import { inr, today } from '../format.js';

/* Option sources for entity pickers, loaded once per page view */
const SOURCES = {
  student: { url: '/admin/students?pageSize=200', label: (r) => `${r.name} (${r.student_code})` },
  donor: { url: '/admin/donors?pageSize=200', label: (r) => `${r.name} — ${r.email}` },
  event: { url: '/admin/events?pageSize=200', label: (r) => `${r.title} (${r.event_date})` },
  volunteer: { url: '/admin/volunteers?pageSize=200', label: (r) => r.name },
};

export function useOptions(kind) {
  const meta = useMeta();
  const src = SOURCES[kind];
  const { data } = useFetch(src ? src.url : null);
  if (kind === 'project') return meta?.projects.map((p) => ({ value: p.id, label: `${p.name}${p.status !== 'Active' ? ` (${p.status})` : ''}` }));
  if (!src) return null;
  return data?.rows.map((r) => ({ value: r.id, label: src.label(r) }));
}

function EntitySelect({ kind, ...props }) {
  const opts = useOptions(kind);
  return <Select {...props} placeholder={opts ? (props.required ? `Choose…` : '— None —') : 'Loading…'} options={opts || []} />;
}

/** Build a form field from a declarative spec */
export function FieldInput({ f, value }) {
  const common = { name: f.name, required: f.required, defaultValue: value ?? f.default ?? '' };
  switch (f.type) {
    case 'textarea': return <textarea className="input" rows={f.rows || 4} {...common} maxLength={f.max} />;
    case 'number': return <input className="input" type="number" step={f.step || 'any'} min={f.min} max={f.maxValue} {...common} />;
    case 'amount': return <input className="input" type="number" step="0.01" min="1" {...common} />;
    case 'date': return <input className="input" type="date" {...common} defaultValue={value ?? (f.default === 'today' ? today() : f.default ?? '')} />;
    case 'month': return <input className="input" type="month" {...common} />;
    case 'select': return <Select {...common} options={f.options || []} placeholder={f.required ? undefined : '—'} />;
    case 'checkbox': return <label className="checkbox"><input type="checkbox" name={f.name} defaultChecked={value == null ? f.default !== false : !!value} />{f.checkLabel || f.label}</label>;
    case 'student': case 'donor': case 'project': case 'event': case 'volunteer':
      return <EntitySelect kind={f.type} {...common} />;
    default: return <input className="input" type={f.type || 'text'} maxLength={f.max} {...common} />;
  }
}

/** Read a form into a payload, converting checkboxes to booleans */
export function readForm(fd, fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'checkbox') out[f.name] = fd.get(f.name) === 'on';
    else {
      const v = fd.get(f.name);
      out[f.name] = typeof v === 'string' ? v.trim() : v;
    }
  }
  return out;
}

export function ResourceForm({ title, endpoint, fields, row, onClose, onSaved, wide = true, transform }) {
  const { toast } = useUI();
  return (
    <FormModal wide={wide} title={title} submitText={row?.id ? 'Save changes' : 'Save'} onClose={onClose}
      onSubmit={async (fd) => {
        let body = readForm(fd, fields);
        if (transform) body = transform(body);
        const out = row?.id ? await api.put(`${endpoint}/${row.id}`, body) : await api.post(endpoint, body);
        toast('Saved');
        onSaved(out);
      }}>
      <div className="form-grid">
        {fields.map((f) => (f.type === 'section'
          ? <div key={f.label} className="form-section">{f.label}</div>
          : f.type === 'checkbox'
            ? <div key={f.name} className={f.full ? 'full' : ''} style={{ alignSelf: 'end', paddingBottom: 8 }}><FieldInput f={f} value={row?.[f.name]} /></div>
            : <Field key={f.name} label={f.label} required={f.required} hint={f.hint} full={f.full || f.type === 'textarea'}><FieldInput f={f} value={row?.[f.name]} /></Field>))}
      </div>
    </FormModal>
  );
}

/**
 * Generic list + add/edit/delete page.
 * columns: [{ key, label, render?(row), num?, money? }]   fields: form field specs   filters: [{ key, placeholder, options | type:'date' }]
 */
export default function ResourcePage({
  title, subtitle, endpoint, listEndpoint, exportType, columns, fields, filters = [], searchPlaceholder = 'Search…',
  newLabel = 'Add', itemLabel = 'record', canDelete = true, canEdit = true, onRowClick, rowActions, initialFilters = {},
  headerExtra, footerSum, emptyText, formTitle, transform, children, noHead,
}) {
  const { toast, confirm } = useUI();
  const init = Object.fromEntries(filters.map((f) => [f.key, initialFilters[f.key] ?? '']));
  const list = useList(listEndpoint || endpoint, init);
  const { data, loading, error, reload, filters: fv, setFilter } = list;
  const [editing, setEditing] = useState(null);
  useEffect(() => { if (initialFilters.__new) setEditing({}); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (row) => {
    if (!(await confirm({ title: `Delete this ${itemLabel}?`, message: 'This cannot be undone.', confirmText: 'Delete', danger: true }))) return;
    try { await api.del(`${endpoint}/${row.id}`); toast('Deleted'); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  const cell = (c, row) => (c.render ? c.render(row, reload) : c.money ? inr(row[c.key]) : row[c.key] ?? '—');

  return (
    <>
      {!noHead && (
        <PageHead title={title} subtitle={subtitle}
          actions={<>
            {headerExtra}
            {exportType && <ExportButton type={exportType} query={list.exportQuery} />}
            {fields && canEdit && <button className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" size={16} />{newLabel}</button>}
          </>} />
      )}
      {children}
      <div className="card">
        <div className="filters">
          <SearchBox value={fv.q} onChange={(v) => setFilter('q', v)} placeholder={searchPlaceholder} />
          {filters.map((f) => (f.type === 'date'
            ? <input key={f.key} className="input" type="date" value={fv[f.key]} onChange={(e) => setFilter(f.key, e.target.value)} aria-label={f.placeholder} title={f.placeholder} />
            : <Select key={f.key} value={fv[f.key]} onChange={(e) => setFilter(f.key, e.target.value)} placeholder={f.placeholder} options={f.options || []} />))}
          {noHead && fields && canEdit && <><div style={{ flex: 1 }} /><button className="btn btn-primary btn-sm" onClick={() => setEditing({})}><Icon name="plus" size={14} />{newLabel}</button></>}
        </div>
        {loading && !data ? <Loading /> : error ? <div className="card-body"><ErrorBox error={error} onRetry={reload} /></div> : !data.rows.length ? (
          <Empty icon="file" title={`No ${itemLabel}s found`} text={emptyText} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>{columns.map((c) => <th key={c.key || c.label} className={c.num || c.money ? 'num' : ''}>{c.label}</th>)}<th /></tr></thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                    {columns.map((c) => <td key={c.key || c.label} className={c.num || c.money ? 'num' : c.className || ''}>{cell(c, row)}</td>)}
                    <td className="right nowrap" onClick={(e) => e.stopPropagation()}>
                      {rowActions?.(row, reload)}
                      {fields && canEdit && <button className="icon-btn" onClick={() => setEditing(row)} aria-label="Edit"><Icon name="edit" size={16} /></button>}
                      {canDelete && <button className="icon-btn danger" onClick={() => remove(row)} aria-label="Delete"><Icon name="trash" size={16} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
              {footerSum && data.sum != null && (
                <tfoot><tr><td colSpan={columns.length - 1}>{footerSum} ({data.total})</td><td className="num">{typeof footerSum === 'string' && footerSum.toLowerCase().includes('hour') ? data.sum : inr(data.sum)}</td><td /></tr></tfoot>
              )}
            </table>
          </div>
        )}
        {data && <Pager page={list.page} pageSize={data.pageSize} total={data.total} onPage={list.setPage} />}
      </div>
      {editing && (
        <ResourceForm title={editing.id ? `Edit ${itemLabel}` : (formTitle || newLabel)} endpoint={endpoint} fields={fields} row={editing.id ? editing : { ...initialFilters, ...editing }}
          transform={transform} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </>
  );
}
