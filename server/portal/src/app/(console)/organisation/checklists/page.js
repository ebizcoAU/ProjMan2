// /organisation/checklists — author checklist templates (xprojman-46 §5, v047).
// Templates are org-wide. Publishing sends a template to devices; unpublishing
// takes it off them without touching checklists already run (items are copied
// into each instance when it starts, F2). System templates are read-only:
// "Duplicate to edit" makes an org draft (copy_from). Gated on checklists.manage
// (PM + Site Supervisor, SA ruling on F3).
'use client';

import { useState } from 'react';
import { PortalCard }      from '@/components/portal/PortalCard';
import { PortalEmpty }     from '@/components/portal/PortalEmpty';
import { PortalError }     from '@/components/portal/PortalError';
import { usePortalData }   from '@/components/portal/usePortalData';
import { usePortalDialog } from '@/components/portal/PortalDialog';
import { checklistsApi, authApi } from '@/lib/api';
import { CHECKLIST_CATEGORY_LABEL as CATEGORY_LABEL } from '@/components/portal/checklistLabels';
// The five roles holding checklists.execute (xprojman-46 F3 ruling).
const TARGET_ROLES = [
  { v: '', label: 'Any site role' },
  { v: 'tradie', label: 'Tradie' },
  { v: 'foreperson', label: 'Foreperson' },
  { v: 'siteSupervisor', label: 'Site Supervisor' },
  { v: 'inspector', label: 'Inspector' },
  { v: 'projectManager', label: 'Project Manager' },
];
const roleLabel = (r) => TARGET_ROLES.find((x) => x.v === (r || ''))?.label || r;
const MAX_ITEMS = 100;

const blankItem = () => ({ label: '', is_required: true, photo_required: false });

function TemplateEditor({ initial, onSaved, onCancel }) {
  const isNew = !initial?.id;
  const [name, setName]         = useState(initial?.name || '');
  const [category, setCategory] = useState(initial?.category || 'internal_qa');
  const [target, setTarget]     = useState(initial?.target_role || '');
  const [description, setDesc]  = useState(initial?.description || '');
  const [items, setItems]       = useState(() => (initial?.items?.length
    ? initial.items.map((i) => ({ label: i.label, is_required: !!i.is_required, photo_required: !!i.photo_required }))
    : [blankItem()]));
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);

  const setItem = (i, patch) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i, d) => setItems((xs) => {
    const j = i + d;
    if (j < 0 || j >= xs.length) return xs;
    const out = [...xs]; [out[i], out[j]] = [out[j], out[i]]; return out;
  });

  const valid = name.trim() && items.length >= 1 && items.length <= MAX_ITEMS && items.every((i) => i.label.trim());

  const save = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true); setErr(null);
    const body = {
      name: name.trim(), category, target_role: target || null, description: description.trim() || null,
      items: items.map((i) => ({ label: i.label.trim(), is_required: i.is_required ? 1 : 0, photo_required: i.photo_required ? 1 : 0 })),
    };
    try {
      if (isNew) await checklistsApi.createTemplate(body);
      else await checklistsApi.updateTemplate(initial.id, body);
      onSaved();
    } catch (e2) {
      const idx = e2?.response?.data?.details?.index;
      setErr((e2?.response?.data?.message || e2.message) + (idx !== undefined ? ` (item ${idx + 1})` : ''));
    } finally { setBusy(false); }
  };

  const lbl = { display: 'block', fontSize: 12, color: 'var(--dim)', marginBottom: 4 };
  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      {!isNew && initial.is_published ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--s2)', padding: '8px 10px', borderRadius: 4 }}>
          This template is published. Changes apply to checklists started after you save. Ones already started keep their own copy.
        </div>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
        <label><span style={lbl}>Name</span>
          <input className="input" value={name} maxLength={160} required onChange={(e) => setName(e.target.value)} />
        </label>
        <label><span style={lbl}>Category</span>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label><span style={lbl}>Who runs it</span>
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
            {TARGET_ROLES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
          </select>
        </label>
      </div>
      <label><span style={lbl}>Description (optional)</span>
        <textarea className="input" rows={2} value={description} onChange={(e) => setDesc(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
      </label>

      <div>
        <span style={lbl}>Items ({items.length}/{MAX_ITEMS})</span>
        <div style={{ display: 'grid', gap: 6 }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ width: 24, fontFamily: 'var(--fm)', fontSize: 12, color: 'var(--dim)', textAlign: 'right' }}>{i + 1}</span>
              <input className="input" style={{ flex: '1 1 280px' }} value={it.label} maxLength={255} required
                placeholder="What to check" onChange={(e) => setItem(i, { label: e.target.value })} />
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={it.is_required} onChange={(e) => setItem(i, { is_required: e.target.checked })} /> Required
              </label>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={it.photo_required} onChange={(e) => setItem(i, { photo_required: e.target.checked })} /> Photo
              </label>
              <button type="button" className="btn btn-ghost" style={{ padding: '3px 8px' }} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button type="button" className="btn btn-ghost" style={{ padding: '3px 8px' }} disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
              <button type="button" className="btn btn-ghost" style={{ padding: '3px 8px' }} disabled={items.length === 1}
                onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-ghost" style={{ marginTop: 8 }} disabled={items.length >= MAX_ITEMS}
          onClick={() => setItems((xs) => [...xs, blankItem()])}>+ Add item</button>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
          &quot;Photo&quot; means a photo is needed when the item is answered Pass or Fail. N/A never needs one.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn-primary" type="submit" disabled={!valid || busy}>{busy ? 'Saving…' : isNew ? 'Create draft' : 'Save'}</button>
        <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        {err && <span style={{ fontSize: 12, color: 'var(--red)' }}>{err}</span>}
      </div>
    </form>
  );
}

export default function ChecklistTemplatesPage() {
  const { confirm } = usePortalDialog();
  const perms = usePortalData(() => authApi.permissions());
  const canManage = (perms.data?.data?.permissions || []).includes('checklists.manage');
  const list = usePortalData(() => checklistsApi.templates());
  const templates = list.data?.data?.templates || [];
  const [editing, setEditing] = useState(null); // 'new' | template id
  const [busyId, setBusyId]   = useState(null);
  const [actErr, setActErr]   = useState(null);

  const act = async (tid, fn) => {
    setBusyId(tid); setActErr(null);
    try { await fn(); await list.refetch(); }
    catch (e) { setActErr(e?.response?.data?.message || e.message); }
    finally { setBusyId(null); }
  };

  if (perms.loading && !perms.data) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (!canManage) {
    return <div style={{ padding: 20 }}><PortalEmpty message="Checklist templates are managed by Project Managers and Site Supervisors." /></div>;
  }

  const own = templates.filter((t) => !t.is_system);
  const system = templates.filter((t) => t.is_system);

  // A render function, not a nested component: a nested component would remount
  // (and drop an open editor's state) on every parent render.
  const renderRow = (t) => (
    <div key={t.id}>
    <div style={{ borderTop: '1px solid var(--b2)', padding: '10px 0' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px' }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>{t.name}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {CATEGORY_LABEL[t.category] || t.category} · {roleLabel(t.target_role)} · {t.items.length} item{t.items.length === 1 ? '' : 's'}
          </div>
        </div>
        {t.is_system ? (
          <>
            <span className="badge badge-muted">System</span>
            <button className="btn btn-ghost" disabled={busyId === t.id}
              onClick={() => act(t.id, () => checklistsApi.createTemplate({ copy_from: t.id }))}>Duplicate to edit</button>
          </>
        ) : (
          <>
            <span className={`badge ${t.is_published ? 'badge-active' : 'badge-pending'}`}>{t.is_published ? 'Published' : 'Draft'}</span>
            <button className="btn btn-ghost" disabled={busyId === t.id} onClick={() => setEditing(editing === t.id ? null : t.id)}>Edit</button>
            {t.is_published ? (
              <button className="btn btn-ghost" disabled={busyId === t.id}
                onClick={async () => {
                  if (await confirm('Unpublish this template? Devices stop offering it. Checklists already started are kept.', { title: 'Unpublish' })) {
                    act(t.id, () => checklistsApi.unpublish(t.id));
                  }
                }}>Unpublish</button>
            ) : (
              <button className="btn btn-primary" disabled={busyId === t.id}
                onClick={() => act(t.id, () => checklistsApi.publish(t.id))}>Publish</button>
            )}
            <button className="btn btn-ghost" disabled={busyId === t.id}
              onClick={async () => {
                if (await confirm(`Delete "${t.name}"? Checklists already run from it are kept.`, { title: 'Delete template', danger: true, confirmLabel: 'Delete' })) {
                  act(t.id, () => checklistsApi.deleteTemplate(t.id));
                }
              }}>Delete</button>
          </>
        )}
      </div>
      {t.is_system && (
        <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
          {t.items.map((i) => i.label).slice(0, 4).join(' · ')}{t.items.length > 4 ? ' …' : ''}
        </div>
      )}
      {editing === t.id && (
        <div style={{ marginTop: 12, padding: 12, background: 'var(--s2)', borderRadius: 6 }}>
          <TemplateEditor initial={t} onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await list.refetch(); }} />
        </div>
      )}
    </div>
    </div>
  );

  return (
    <div style={{ padding: 20, maxWidth: 1000 }}>
      <div style={{ fontFamily: 'var(--fh)', fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
        Checklist templates
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
        Toolbox talks, plant pre-starts and internal QA checks your crews run in the App. Publish a template to send it to
        devices. Statutory hold-point inspections are separate and stay on the Quality tab.
      </div>

      {(list.error || actErr) && <div style={{ marginBottom: 12 }}><PortalError message={list.error || actErr} /></div>}

      <PortalCard title="Your templates">
        {editing === 'new' ? (
          <div style={{ padding: 12, background: 'var(--s2)', borderRadius: 6, marginBottom: 8 }}>
            <TemplateEditor onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await list.refetch(); }} />
          </div>
        ) : (
          <button className="btn btn-primary" style={{ marginBottom: 8 }} onClick={() => setEditing('new')}>+ New template</button>
        )}
        {list.loading && !list.data ? <PortalEmpty message="Loading…" />
          : own.length === 0 ? <PortalEmpty message="No templates of your own yet. Start one, or duplicate a system template below." />
          : own.map(renderRow)}
      </PortalCard>

      <div style={{ height: 16 }} />

      <PortalCard title="System templates">
        {system.length === 0 ? <PortalEmpty message="None." /> : system.map(renderRow)}
      </PortalCard>
    </div>
  );
}
