// SafetyViews.js — shared Safety/OHS views (xprojman-48, v048 contract as amended
// by Server's §8 response). Used by the project Safety tab (manage), the Builder
// console (read-only list, SA ruling F7) and the cross-project /safety page.
//
// Rulings applied: Builder never gets detail/incident data/actions (F7); a
// notifiable incident is recorded and emailed to the PM and Site Supervisor, and
// ProjMan does not notify the regulator (F3); an expired induction warns, it
// doesn't block (F5).
'use client';

import { useCallback, useEffect, useState } from 'react';
import { PortalEmpty }     from './PortalEmpty';
import { PortalError }     from './PortalError';
import { usePortalDialog } from './PortalDialog';
import { documentsApi }    from '@/lib/api';
import { safetyApi, SAFETY_MOCK, KIND_LABEL, REGISTER_KINDS, REGISTER_KIND_LABEL } from '@/lib/safety';

const SEV_COLOR = { high: 'var(--red)', medium: 'var(--text)', low: 'var(--dim)' };
const STATUS_BADGE = { open: 'badge-revoked', in_progress: 'badge-pending', closed: 'badge-active' };
const TREATMENT = { none: 'None', first_aid: 'First aid', medical: 'Medical treatment', hospital: 'Hospital', fatality: 'Fatality' };
const dt = (v) => (v ? new Date(v).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const d  = (v) => (v ? new Date(v).toLocaleDateString('en-AU') : '—');
const errMsg = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
const todayIso = () => new Date().toISOString().slice(0, 10);

export function SafetyMockBanner() {
  if (!SAFETY_MOCK) return null;
  return (
    <div style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--s2)', border: '1px dashed var(--b2)',
      borderRadius: 4, padding: '6px 10px', marginBottom: 12 }}>
      Design mockup: sample data, nothing is saved. Goes live when the Safety API (v048) ships.
    </div>
  );
}

async function openDocument(id) {
  const blob = await documentsApi.fetchBlob(id);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function DocButtons({ docs, onError }) {
  if (!docs?.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {docs.map((doc, i) => (
        <button key={doc.id} type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }}
          disabled={SAFETY_MOCK} title={SAFETY_MOCK ? 'Sample photo (mockup)' : doc.file_name}
          onClick={() => openDocument(doc.id).catch((e) => onError(e.message))}>
          Photo{docs.length > 1 ? ` ${i + 1}` : ''}
        </button>
      ))}
    </span>
  );
}

// ── Events list ──────────────────────────────────────────────────────────────
export function SafetyEventList({ projectId, onOpen, selectedId, reloadKey }) {
  const [f, setF] = useState({ kind: '', status: '', severity: '', is_notifiable: '' });
  const [rows, setRows] = useState(null);
  const [err, setErr]   = useState(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await safetyApi.events(projectId, f);
      setRows(res?.data?.data?.safety_events || []);
    } catch (e) { setRows([]); setErr(errMsg(e)); }
  }, [projectId, f]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const th = { padding: '10px 12px', textAlign: 'left', color: 'var(--dim)', fontSize: 12 };
  const td = { padding: '8px 12px', fontSize: 13, verticalAlign: 'top' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <select className="input" value={f.kind} onChange={set('kind')} aria-label="Kind">
          <option value="">All kinds</option>
          {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="input" value={f.status} onChange={set('status')} aria-label="Status">
          <option value="">Any status</option><option value="open">Open</option>
          <option value="in_progress">In progress</option><option value="closed">Closed</option>
        </select>
        <select className="input" value={f.severity} onChange={set('severity')} aria-label="Severity">
          <option value="">Any severity</option><option value="high">High</option>
          <option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <select className="input" value={f.is_notifiable} onChange={set('is_notifiable')} aria-label="Notifiable">
          <option value="">Notifiable or not</option><option value="1">Notifiable only</option>
        </select>
      </div>
      {err && <div style={{ marginBottom: 10 }}><PortalError message={err} /></div>}
      {rows === null ? <PortalEmpty message="Loading…" />
        : rows.length === 0 ? <PortalEmpty message="Nothing reported. Crews report hazards, near misses and incidents from the App." />
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: 'var(--s2)', borderBottom: '1px solid var(--b1)' }}>
                <th style={th}>Reported</th><th style={th}>Kind</th><th style={th}>What happened</th>
                <th style={th}>Severity</th><th style={th}>Status</th><th style={th}>Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} onClick={onOpen ? () => onOpen(e.id) : undefined}
                    style={{ borderTop: '1px solid var(--b2)', cursor: onOpen ? 'pointer' : 'default',
                      background: selectedId === e.id ? 'var(--s2)' : 'transparent' }}>
                    <td style={{ ...td, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{d(e.occurred_at || e.raised_at)}</td>
                    <td style={td}>
                      {KIND_LABEL[e.kind] || e.kind}
                      {e.is_notifiable ? <span className="badge badge-revoked" style={{ marginLeft: 6 }}>Notifiable</span> : null}
                    </td>
                    <td style={{ ...td, color: 'var(--text)' }}>
                      {e.description}
                      {e.location && <div style={{ fontSize: 12, color: 'var(--dim)' }}>{e.location}</div>}
                    </td>
                    <td style={td}><span style={{ color: SEV_COLOR[e.severity], fontWeight: 600 }}>{e.severity}</span></td>
                    <td style={td}><span className={`badge ${STATUS_BADGE[e.status] || 'badge-muted'}`}>{e.status.replace('_', ' ')}</span></td>
                    <td style={{ ...td, fontSize: 12 }}>
                      {e.open_action_count ? `${e.open_action_count} open` : '—'}
                      {e.overdue_action_count ? <span style={{ color: 'var(--red)' }}> · {e.overdue_action_count} overdue</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

// ── Event detail: respond, close, notifiable ─────────────────────────────────
export function SafetyEventDetail({ eventId, onChanged, onClose }) {
  const { confirm } = usePortalDialog();
  const [ev, setEv]     = useState(null);
  const [err, setErr]   = useState(null);
  const [busy, setBusy] = useState(false);
  const [newAction, setNewAction] = useState({ action: '', assigned_to_name: '', due_date: '' });
  const [closeNote, setCloseNote] = useState('');
  const [notif, setNotif] = useState({ notified_at: '', regulator_reference: '' });

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await safetyApi.event(eventId);
      const e = res?.data?.data?.safety_event;
      setEv(e);
      setNotif({ notified_at: e?.notified_at ? String(e.notified_at).slice(0, 16) : '', regulator_reference: e?.regulator_reference || '' });
    } catch (e) { setErr(errMsg(e)); }
  }, [eventId]);
  useEffect(() => { setEv(null); load(); }, [load]);

  const run = async (fn) => {
    setBusy(true); setErr(null);
    try { await fn(); await load(); onChanged?.(); }
    catch (e) {
      const ids = e?.response?.data?.details?.action_ids;
      setErr(errMsg(e) + (ids?.length ? ' Close the open actions first.' : ''));
    } finally { setBusy(false); }
  };

  if (err && !ev) return <PortalError message={err} />;
  if (!ev) return <PortalEmpty message="Loading…" />;

  const actions = ev.actions || [];
  const openActions = actions.filter((a) => a.status === 'open');
  const closed = ev.status === 'closed';
  const box = { background: 'var(--s2)', borderRadius: 6, padding: 12 };
  const lbl = { display: 'block', fontSize: 12, color: 'var(--dim)', marginBottom: 4 };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            {KIND_LABEL[ev.kind]} · <span style={{ color: SEV_COLOR[ev.severity] }}>{ev.severity}</span>
            {' '}<span className={`badge ${STATUS_BADGE[ev.status]}`}>{ev.status.replace('_', ' ')}</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 4 }}>{ev.description}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            {ev.location || 'No location'} · happened {dt(ev.occurred_at)} · reported by {ev.raised_by?.name || '—'} {dt(ev.raised_at)}
          </div>
          <div style={{ marginTop: 6 }}><DocButtons docs={ev.documents} onError={setErr} /></div>
        </div>
        {onClose && <button className="btn btn-ghost" onClick={onClose}>✕</button>}
      </div>

      {err && <PortalError message={err} />}

      {/* Notifiable (F3) */}
      {(ev.kind === 'incident' || ev.is_notifiable) && (
        <div style={{ ...box, border: ev.is_notifiable ? '1px solid var(--red)' : '1px solid var(--b2)' }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: ev.is_notifiable ? 'var(--red)' : 'var(--text)', marginBottom: 6 }}>
            {ev.is_notifiable ? 'Notifiable incident' : 'Not flagged as notifiable'}
          </div>
          {ev.is_notifiable ? (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              ProjMan has recorded this incident and emailed the PM and Site Supervisor. It does not notify the
              regulator for you. Record the regulator&apos;s reference here once you have called them.
              {ev.notifiable_confirmed_by?.name && <> Confirmed by {ev.notifiable_confirmed_by.name}.</>}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              A death, serious injury or illness, or dangerous incident must be reported to the regulator immediately.
            </div>
          )}
          {ev.is_notifiable ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label><span style={lbl}>Regulator notified at</span>
                <input className="input" type="datetime-local" value={notif.notified_at}
                  onChange={(e) => setNotif((n) => ({ ...n, notified_at: e.target.value }))} />
              </label>
              <label><span style={lbl}>Regulator reference</span>
                <input className="input" maxLength={60} value={notif.regulator_reference}
                  onChange={(e) => setNotif((n) => ({ ...n, regulator_reference: e.target.value }))} />
              </label>
              <button className="btn btn-primary" disabled={busy} onClick={() => run(() => safetyApi.setNotifiable(ev.id, {
                notified_at: notif.notified_at ? new Date(notif.notified_at).toISOString() : null,
                regulator_reference: notif.regulator_reference.trim() || null,
              }))}>Save</button>
              <button className="btn btn-ghost" disabled={busy} onClick={async () => {
                if (await confirm('Clear the notifiable flag? Only do this if the incident is not notifiable.', { title: 'Clear flag' })) {
                  run(() => safetyApi.setNotifiable(ev.id, { is_notifiable: 0 }));
                }
              }}>Clear flag</button>
            </div>
          ) : (
            <button className="btn btn-ghost" disabled={busy} onClick={async () => {
              if (await confirm('Flag as a notifiable incident? The PM and Site Supervisor are emailed, and the record is kept for 5 years.',
                { title: 'Notifiable incident', confirmLabel: 'Flag it', danger: true })) {
                run(() => safetyApi.setNotifiable(ev.id, { is_notifiable: 1 }));
              }
            }}>Flag as notifiable</button>
          )}
        </div>
      )}

      {/* Incident details — only returned to safety.manage or the reporter */}
      {ev.incident_details && (
        <div style={box}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
            Injury details <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--muted)' }}>(private: health information, not shown on site devices)</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 8, fontSize: 13 }}>
            <div><span style={lbl}>Injured person</span>{ev.incident_details.injured_name || '—'}</div>
            <div><span style={lbl}>Injury</span>{ev.incident_details.injury_type || '—'}</div>
            <div><span style={lbl}>Body part</span>{ev.incident_details.body_part || '—'}</div>
            <div><span style={lbl}>Treatment</span>{TREATMENT[ev.incident_details.treatment] || '—'}</div>
            <div><span style={lbl}>Lost time</span>{ev.incident_details.lost_time == null ? '—' : ev.incident_details.lost_time ? 'Yes' : 'No'}</div>
            <div><span style={lbl}>Witnesses</span>{ev.incident_details.witness_names || '—'}</div>
          </div>
        </div>
      )}

      {/* Corrective actions (F4) */}
      <div style={box}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Corrective actions ({openActions.length} open)</div>
        {actions.length === 0 && <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>None yet.</div>}
        {actions.map((a) => {
          const overdue = a.status === 'open' && a.due_date && a.due_date < todayIso();
          return (
            <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--b2)', flexWrap: 'wrap' }}>
              <span className={`badge ${a.status === 'open' ? 'badge-pending' : 'badge-active'}`}>{a.status}</span>
              <span style={{ flex: '1 1 240px', fontSize: 13 }}>{a.action}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{a.assigned_to_name || '—'}</span>
              <span style={{ fontSize: 12, color: overdue ? 'var(--red)' : 'var(--muted)' }}>due {d(a.due_date)}{overdue ? ' (overdue)' : ''}</span>
              {a.status === 'closed'
                ? <span style={{ fontSize: 12, color: 'var(--dim)' }}>closed {d(a.closed_at)}{a.closed_by?.name ? ` by ${a.closed_by.name}` : ''}</span>
                : !closed && <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} disabled={busy}
                    onClick={() => run(() => safetyApi.patchAction(a.id, { status: 'closed' }))}>Mark done</button>}
              <DocButtons docs={a.documents} onError={setErr} />
            </div>
          );
        })}
        {!closed && (
          <form onSubmit={(e) => {
            e.preventDefault();
            if (!newAction.action.trim()) return;
            run(async () => {
              await safetyApi.addAction(ev.id, {
                action: newAction.action.trim(),
                assigned_to_name: newAction.assigned_to_name.trim() || null,
                due_date: newAction.due_date || null,
              });
              setNewAction({ action: '', assigned_to_name: '', due_date: '' });
            });
          }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <input className="input" style={{ flex: '1 1 240px' }} placeholder="New action" value={newAction.action}
              onChange={(e) => setNewAction((x) => ({ ...x, action: e.target.value }))} />
            <input className="input" placeholder="Who" value={newAction.assigned_to_name}
              onChange={(e) => setNewAction((x) => ({ ...x, assigned_to_name: e.target.value }))} />
            <input className="input" type="date" value={newAction.due_date}
              onChange={(e) => setNewAction((x) => ({ ...x, due_date: e.target.value }))} />
            <button className="btn btn-primary" type="submit" disabled={busy || !newAction.action.trim()}>Add</button>
          </form>
        )}
      </div>

      {/* Close (F4: not while an action is open) */}
      {closed ? (
        <div style={{ ...box, fontSize: 13 }}>
          Closed {dt(ev.closed_at)}{ev.closed_by?.name ? ` by ${ev.closed_by.name}` : ''}.
          {ev.close_note && <div style={{ color: 'var(--muted)', marginTop: 4 }}>{ev.close_note}</div>}
        </div>
      ) : (
        <div style={{ ...box, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" style={{ flex: '1 1 280px' }} placeholder="Closing note: what was done" value={closeNote}
            onChange={(e) => setCloseNote(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || openActions.length > 0}
            title={openActions.length ? 'Close the open actions first' : undefined}
            onClick={async () => {
              if (await confirm('Close this event?', { title: 'Close event' })) {
                run(() => safetyApi.closeEvent(ev.id, closeNote.trim()));
              }
            }}>Close event</button>
          {openActions.length > 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{openActions.length} action(s) still open</span>}
        </div>
      )}
    </div>
  );
}

// ── Inductions register (F5: warn, don't block) ──────────────────────────────
export function InductionsRegister({ projectId }) {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState(null);
  const [err, setErr]   = useState(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    safetyApi.inductions(projectId, status)
      .then((res) => { if (live) setRows(res?.data?.data?.site_inductions || []); })
      .catch((e) => { if (live) { setRows([]); setErr(errMsg(e)); } });
    return () => { live = false; };
  }, [projectId, status]);

  const BADGE = { valid: 'badge-active', expiring: 'badge-pending', expired: 'badge-revoked' };
  const td = { padding: '8px 12px', fontSize: 13 };
  const expired = (rows || []).filter((r) => r.status === 'expired').length;
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Induction status">
          <option value="">All</option><option value="valid">Valid</option>
          <option value="expiring">Expiring in 14 days</option><option value="expired">Expired</option>
        </select>
        {expired > 0 && !status && (
          <span style={{ fontSize: 12, color: 'var(--red)' }}>
            {expired} expired. They can still sign in on site, but the Site Supervisor is alerted each time.
          </span>
        )}
      </div>
      {err && <PortalError message={err} />}
      {rows === null ? <PortalEmpty message="Loading…" />
        : rows.length === 0 ? <PortalEmpty message="No inductions recorded. Site Supervisors run inductions in the App." />
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: 'var(--s2)', color: 'var(--dim)', fontSize: 12 }}>
              <th style={{ ...td, textAlign: 'left' }}>Person</th><th style={{ ...td, textAlign: 'left' }}>Inducted</th>
              <th style={{ ...td, textAlign: 'left' }}>By</th><th style={{ ...td, textAlign: 'left' }}>Expires</th>
              <th style={{ ...td, textAlign: 'left' }}>Status</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--b2)' }}>
                  <td style={td}>{r.name}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{d(r.inducted_at)}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{r.inducted_by_name || '—'}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{d(r.expires_at)}</td>
                  <td style={td}><span className={`badge ${BADGE[r.status] || 'badge-muted'}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}

// ── Safety register documents + SWMS sign-on ─────────────────────────────────
function SwmsSignons({ projectId, docId }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let live = true;
    safetyApi.swmsSignoffs(projectId, docId)
      .then((res) => { if (live) setRows(res?.data?.data?.signoffs || []); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [projectId, docId]);
  if (rows === null) return <span style={{ fontSize: 12, color: 'var(--dim)' }}>…</span>;
  if (rows.length === 0) return <span style={{ fontSize: 12, color: 'var(--red)' }}>Nobody has signed on yet</span>;
  return (
    <span style={{ fontSize: 12, color: 'var(--muted)' }} title={rows.map((r) => `${r.name} · ${d(r.signed_at)}`).join('\n')}>
      {rows.length} signed on: {rows.map((r) => r.name).join(', ')}
    </span>
  );
}

export function SafetyRegister({ projectId }) {
  const [docs, setDocs] = useState(null);
  const [err, setErr]   = useState(null);
  const [kind, setKind] = useState('swms');
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await safetyApi.registerDocs(projectId, REGISTER_KINDS);
      setDocs(res?.data?.data?.documents || []);
    } catch (e) { setDocs([]); setErr(errMsg(e)); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setErr(null);
    try {
      await documentsApi.upload({ file, projectId, entityType: 'project', entityId: projectId, kind });
      await load();
    } catch (e2) { setErr(errMsg(e2)); }
    finally { setUploading(false); e.target.value = ''; }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Document type">
          {REGISTER_KINDS.map((k) => <option key={k} value={k}>{REGISTER_KIND_LABEL[k]}</option>)}
        </select>
        <label className="btn btn-ghost" style={{ cursor: SAFETY_MOCK || uploading ? 'not-allowed' : 'pointer', opacity: SAFETY_MOCK ? 0.5 : 1 }}
          title={SAFETY_MOCK ? 'Uploading goes live with v048' : undefined}>
          {uploading ? 'Uploading…' : 'Upload'}
          <input type="file" accept=".pdf,image/*" style={{ display: 'none' }} disabled={SAFETY_MOCK || uploading} onChange={upload} />
        </label>
      </div>
      {err && <PortalError message={err} />}
      {docs === null ? <PortalEmpty message="Loading…" />
        : docs.length === 0 ? <PortalEmpty message="No safety documents yet. Upload the SWMS, SDSs and emergency plan here." />
        : REGISTER_KINDS.filter((k) => docs.some((x) => x.kind === k)).map((k) => (
          <div key={k} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--dim)', marginBottom: 4 }}>{REGISTER_KIND_LABEL[k]}</div>
            {docs.filter((x) => x.kind === k).map((doc) => (
              <div key={doc.document_id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '5px 0', borderTop: '1px solid var(--b2)' }}>
                <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12 }} disabled={SAFETY_MOCK}
                  onClick={() => openDocument(doc.document_id).catch((e) => setErr(e.message))}>
                  {doc.original_filename || 'Document'}
                </button>
                <span style={{ fontSize: 12, color: 'var(--dim)' }}>{d(doc.created_at)}</span>
                {k === 'swms' && <SwmsSignons projectId={projectId} docId={doc.document_id} />}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
