// ChecklistReview.js — the "Checklists" section of a project's Quality tab
// (xprojman-46 §5 review, v047). Read-only: checklists are run in the App and
// frozen once completed; a correction is a new checklist that supersedes the old
// one. Photos and signatures are documents embedded in the detail read.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { PortalEmpty } from './PortalEmpty';
import { PortalError } from './PortalError';
import { CHECKLIST_CATEGORY_LABEL } from './checklistLabels';
import { checklistsApi, documentsApi } from '@/lib/api';

const RESULT_BADGE = { pending: 'badge-pending', pass: 'badge-active', fail: 'badge-revoked', na: 'badge-muted' };
const dt = (v) => (v ? new Date(v).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

async function openDocument(id) {
  const blob = await documentsApi.fetchBlob(id);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function DocLinks({ docs, onError }) {
  if (!docs?.length) return <span style={{ color: 'var(--dim)' }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {docs.map((d, i) => (
        <button key={d.id} type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }}
          title={d.file_name || d.kind} onClick={() => openDocument(d.id).catch((e) => onError(e.message))}>
          {d.kind === 'signature' ? 'Signature' : `Photo ${docs.length > 1 ? i + 1 : ''}`.trim()}
        </button>
      ))}
    </span>
  );
}

function Detail({ id }) {
  const [data, setData] = useState(null);
  const [err, setErr]   = useState(null);
  useEffect(() => {
    let live = true;
    checklistsApi.instance(id)
      .then((res) => { if (live) setData(res?.data?.data?.checklist || null); })
      .catch((e) => { if (live) setErr(e?.response?.data?.message || e.message); });
    return () => { live = false; };
  }, [id]);

  if (err) return <PortalError message={err} />;
  if (!data) return <div style={{ fontSize: 12, color: 'var(--dim)', padding: '8px 0' }}>Loading…</div>;

  const cell = { padding: '6px 10px', fontSize: 12, textAlign: 'left', verticalAlign: 'top' };
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        {data.status === 'completed'
          ? <>Frozen. Completed by {data.completed_by_name || '—'} on {dt(data.completed_at)}.</>
          : <>In progress on site, started by {data.started_by_name || '—'}.</>}
        {data.supersedes_id && <> This corrects an earlier checklist.</>}
        {data.superseded_by_id && <strong style={{ color: 'var(--red)' }}> A newer correction exists; this one is superseded.</strong>}
        {data.notes && <div style={{ marginTop: 4, color: 'var(--text)' }}>{data.notes}</div>}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr style={{ color: 'var(--dim)' }}>
          <th style={cell}>#</th><th style={cell}>Item</th><th style={cell}>Result</th><th style={cell}>Note</th><th style={cell}>Evidence</th>
        </tr></thead>
        <tbody>
          {data.items.map((it) => (
            <tr key={it.id} style={{ borderTop: '1px solid var(--b2)' }}>
              <td style={{ ...cell, color: 'var(--dim)' }}>{it.seq}</td>
              <td style={cell}>{it.label}{it.is_required ? '' : <span style={{ color: 'var(--dim)' }}> (optional)</span>}</td>
              <td style={cell}><span className={`badge ${RESULT_BADGE[it.result] || 'badge-muted'}`}>{it.result === 'na' ? 'N/A' : it.result}</span></td>
              <td style={{ ...cell, color: 'var(--muted)' }}>{it.note || '—'}</td>
              <td style={cell}><DocLinks docs={it.documents} onError={setErr} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--dim)', marginBottom: 4 }}>
          Sign-offs ({data.signoffs.length})
        </div>
        {data.signoffs.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--dim)' }}>None.</div>
        ) : data.signoffs.map((s) => (
          <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12, padding: '3px 0' }}>
            <span style={{ color: 'var(--text)', minWidth: 160 }}>{s.name || '—'}</span>
            <span style={{ color: 'var(--muted)' }}>{dt(s.signed_at)}</span>
            <DocLinks docs={s.documents} onError={setErr} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChecklistReview({ projectId, stageById }) {
  const [filters, setFilters] = useState({ category: '', status: '', result: '' });
  const [rows, setRows]       = useState([]);
  const [cursor, setCursor]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);
  const [openId, setOpenId]   = useState(null);

  const load = useCallback(async (after) => {
    setLoading(true); setErr(null);
    try {
      const res = await checklistsApi.forProject(projectId, { ...filters, cursor: after, limit: 50 });
      const page = res?.data?.data?.checklists || [];
      setRows((prev) => (after ? [...prev, ...page] : page));
      setCursor(res?.data?.data?.next_cursor || null);
    } catch (e) {
      setErr(e?.response?.data?.message || e.message);
    } finally { setLoading(false); }
  }, [projectId, filters]);

  useEffect(() => { setOpenId(null); load(null); }, [load]);

  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const th = { padding: '10px 12px', textAlign: 'left', color: 'var(--dim)', fontSize: 12 };
  const td = { padding: '8px 12px', fontSize: 13 };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <select className="input" value={filters.category} onChange={setF('category')} aria-label="Category">
          <option value="">All categories</option>
          {Object.entries(CHECKLIST_CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="input" value={filters.status} onChange={setF('status')} aria-label="Status">
          <option value="">Any status</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
        </select>
        <select className="input" value={filters.result} onChange={setF('result')} aria-label="Result">
          <option value="">Any result</option>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      {err && <div style={{ marginBottom: 10 }}><PortalError message={err} /></div>}

      {loading && rows.length === 0 ? <PortalEmpty message="Loading…" />
        : rows.length === 0 ? <PortalEmpty message="No checklists match. Crews run them in the App from your published templates." />
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: 'var(--s2)', borderBottom: '1px solid var(--b1)' }}>
                <th style={th}>Checklist</th><th style={th}>Category</th><th style={th}>Stage</th>
                <th style={th}>Status</th><th style={th}>Result</th><th style={th}>By</th><th style={th}>Completed</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <FragmentRow key={r.id} r={r} open={openId === r.id} stageById={stageById} td={td}
                    onToggle={() => setOpenId(openId === r.id ? null : r.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}

      {cursor && (
        <button className="btn btn-ghost" style={{ marginTop: 10 }} disabled={loading} onClick={() => load(cursor)}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

function FragmentRow({ r, open, onToggle, stageById, td }) {
  const superseded = !!r.superseded_by_id;
  return (
    <>
      <tr onClick={onToggle} style={{ borderTop: '1px solid var(--b2)', cursor: 'pointer', opacity: superseded ? 0.55 : 1 }}>
        <td style={{ ...td, color: 'var(--text)' }}>
          {r.template_name}
          {superseded && <span className="badge badge-muted" style={{ marginLeft: 6 }}>Superseded</span>}
        </td>
        <td style={{ ...td, color: 'var(--muted)' }}>{CHECKLIST_CATEGORY_LABEL[r.category] || r.category}</td>
        <td style={{ ...td, color: 'var(--muted)' }}>{stageById[r.stage_id] || '—'}</td>
        <td style={td}>
          {r.status === 'completed'
            ? <span className="badge badge-muted">Frozen</span>
            : <span className="badge badge-pending">In progress on site</span>}
        </td>
        <td style={td}>
          <span className={`badge ${RESULT_BADGE[r.result] || 'badge-muted'}`}>{r.result}</span>
          {r.fail_count > 0 && <span style={{ marginLeft: 6, fontSize: 12, color: 'var(--red)' }}>{r.fail_count} failed</span>}
        </td>
        <td style={{ ...td, color: 'var(--muted)' }}>{r.completed_by?.name || r.started_by?.name || '—'}</td>
        <td style={{ ...td, color: 'var(--muted)' }}>{dt(r.completed_at)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} style={{ padding: '10px 12px 14px 24px', background: 'var(--s2)' }}>
            <Detail id={r.id} />
          </td>
        </tr>
      )}
    </>
  );
}
