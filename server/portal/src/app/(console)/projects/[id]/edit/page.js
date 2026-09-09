// /projects/:id/edit — owner report 2026-09-07: the Project List had Cancel/Delete
// but no way to correct a project after creation (customer name, project brief,
// land info). Fields here match exactly what the New Project wizard
// (`/projects/new`) already established as real vs. not-yet-backed by a column —
// checked against `ProjectService.PROJECT_FIELDS` (server/api/src/services/
// ProjectService.js) rather than re-guessing: `customer_id, name, site_address,
// lot_plan, start_date, due_date, contract_value, contract_type` are genuinely
// PATCHable. Dwelling type / budget range / requirements ("Project Brief" in the
// wizard's own step labels) still have no backing column anywhere — flagged here,
// not silently dropped, same posture the wizard already uses.
//
// Owner follow-up 2026-09-07, both built via xprojman-40 (migration v040):
// (1) Project Description — checked the full history first (no
// `projects.description` column ever existed; the closest thing, a
// `project_briefs` table, was proposed then retracted same-day per
// docs/processmap.md, never migrated) — now a real column, PATCHable here and
// on the New Project wizard's "Requirements / brief notes" field.
// (2) the fixed maxWidth:720 left most of a wide screen blank — restructured to
// two columns, the freed right column showing a server-mediated Google Static
// Map (`GET /projects/:id/site-map`, SiteMapService) of the site. The endpoint
// 503s `SITE_MAP_NOT_CONFIGURED` until the owner provisions a Google Maps API
// key — the panel below shows that plainly rather than a fake map image.
//
// Owner follow-up 2026-09-07 #2 — field PARITY with /projects/new, both
// directions: (a) Add had client_tier/source/dwelling_type/budget/site_area/
// zoning_code nowhere in Edit — now present here too, same "not saved yet"
// hints, same fields (still no backing column — this doesn't add any). (b) Edit
// had due_date/contract_value/contract_type nowhere in Add — Add gained a 4th
// step so both screens present the identical field set. Restructured to
// clickable tabs (owner: "use the multi tabs like in Add Project") instead of
// one long scrolling form — unlike Add's linear wizard, any tab is reachable
// any time, since there's no "step order" to enforce once a project exists.
// One remaining asymmetry, flagged not silently fixed: Add's "Land documents"
// upload has nowhere to go here — `documents.entity_type` has no `project`
// value (only inspection_item/defect/certificate/site_diary/delivery/task,
// confirmed against DocumentService.ENTITY_TYPES), so a real project-level
// document tab needs its own schema ask before it can exist in either screen.
//
// Owner follow-up 2026-09-07 #3 (xprojman-41 §3/§6/§9, built server-side as
// §10, migration v041) — "Formalize Brief" / "Re-issue Brief PDF": the live
// fields above are an editable working record staff can change any time; a
// snapshot is a durable, dated, both-parties-readable PDF of them at one
// point in time — an append-only history (`project_brief_snapshots`), one
// row per click here or per approved `variations` row (that half fires
// server-side, nothing to wire here). The customer-facing ACK half stays
// blocked on xprojman-41 §1 (no customer identity exists yet to ack with) —
// `acknowledged_by`/`acknowledged_at` simply won't populate until then.
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PortalCard } from '@/components/portal/PortalCard';
import { PortalEmpty } from '@/components/portal/PortalEmpty';
import { PortalError } from '@/components/portal/PortalError';
import { usePortalData } from '@/components/portal/usePortalData';
import { projectsApi, customersApi } from '@/lib/api';
import { useTopbarOverride } from '@/components/portal/chrome';
import { usePortalDialog } from '@/components/portal/PortalDialog';

const inputStyle = {
  width: '100%', background: 'var(--s3)', border: '2px solid var(--b1)', borderRadius: 8,
  padding: '9px 12px', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit',
};

function Field({ label, full, children, hint }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : undefined, marginBottom: 4 }}>
      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const dateOnly = (v) => (v ? String(v).slice(0, 10) : '');

const TABS = [
  { n: 1, label: 'Customer' },
  { n: 2, label: 'Project Brief' },
  { n: 3, label: 'Land & Site Info' },
  { n: 4, label: 'Contract' },
];

// Same numbered-pill visual as the New Project wizard's step indicator, but
// clickable — editing an existing project has no linear order to enforce.
function TabPills({ active, onSelect }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
      {TABS.map((t, i) => (
        <div key={t.n} style={{ display: 'flex', alignItems: 'center', flex: i < TABS.length - 1 ? 1 : undefined }}>
          <button type="button" onClick={() => onSelect(t.n)}
            style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--fm)', fontSize: 12, fontWeight: 700,
              background: t.n === active ? 'var(--brand)' : 'var(--s3)',
              border: `1.5px solid ${t.n === active ? 'var(--brand)' : 'var(--b2)'}`,
              color: t.n === active ? '#fff' : 'var(--muted)',
            }}>
              {t.n}
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: t.n === active ? 'var(--text)' : 'var(--muted)' }}>{t.label}</span>
          </button>
          {i < TABS.length - 1 && <div style={{ flex: 1, height: 2, margin: '0 10px', minWidth: 24, background: 'var(--b1)' }} />}
        </div>
      ))}
    </div>
  );
}

// Site map (xprojman-40 §2) — a server-mediated Google Static Map, zoom 16, of
// the project's SAVED `site_address` (the endpoint reads the DB row, not an
// unsent form value, so this only reflects the address after a Save). Bytes
// only ever transit the server; the Google Maps key never reaches the browser.
// `SITE_MAP_NOT_CONFIGURED` (503, no key provisioned yet) and `NO_SITE_ADDRESS`
// (404) are real, expected states — shown plainly, never a fake map image.
function SiteMapPanel({ projectId, siteAddress, refreshKey }) {
  const [state, setState] = useState({ loading: true, url: null, message: null });

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    setState({ loading: true, url: null, message: null });
    projectsApi.siteMap(projectId).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setState({ loading: false, url: objectUrl, message: null });
    }).catch((err) => {
      if (cancelled) return;
      const message = err.code === 'SITE_MAP_NOT_CONFIGURED'
        ? 'Google Maps isn’t configured on the server yet.'
        : err.code === 'NO_SITE_ADDRESS'
        ? 'Add a site address (Land & Site Info) and save to show a map here.'
        : err.message || 'Could not load the site map.';
      setState({ loading: false, url: null, message });
    });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [projectId, refreshKey]);

  return (
    <PortalCard title="Site map">
      {state.url ? (
        <img src={state.url} alt={`Map of ${siteAddress || 'site'}`}
          style={{ width: '100%', borderRadius: 8, display: 'block' }} />
      ) : (
        <div style={{
          aspectRatio: '4 / 3', borderRadius: 8, background: 'var(--s3)', border: '1px dashed var(--b2)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: 20, textAlign: 'center',
        }}>
          <span style={{ fontSize: 26 }}>🗺️</span>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {state.loading ? 'Loading map…' : state.message}
          </div>
        </div>
      )}
    </PortalCard>
  );
}

// Project Brief snapshots (xprojman-41 §3/§9, ProjectBriefService, migration
// v041) — an append-only, dated PDF history. "Formalize Brief" fires the
// initial intake snapshot; once one exists the same button becomes "Re-issue"
// (so it never reads as a no-op) — a variation-approval snapshot happens
// server-side, nothing to trigger here, it just shows up in the list.
// `acknowledged_at` will stay empty for every row until xprojman-41 §1
// (customer App access) exists for someone to ack with — shown plainly as
// "Not yet acknowledged" rather than hidden.
function BriefSnapshotsCard({ projectId }) {
  const { confirm, alert } = usePortalDialog();
  const snapshotsData = usePortalData(() => projectsApi.listBriefSnapshots(projectId), [projectId]);
  const snapshots = snapshotsData.data?.data?.snapshots || [];
  const hasIntake = snapshots.some((s) => !s.variation_id);
  const [busy, setBusy] = useState(false);
  const [viewBusyId, setViewBusyId] = useState(null);
  const [err, setErr] = useState(null);

  const formalize = async () => {
    const ok = await confirm(
      hasIntake
        ? 'Generate a new, dated PDF of the current Project Brief? Past snapshots are kept — this adds another.'
        : 'Generate the initial Project Brief PDF from the current fields? This becomes the dated starting-point record.',
      { title: hasIntake ? 'Re-issue Brief PDF' : 'Formalize Brief', confirmLabel: hasIntake ? 'Re-issue' : 'Formalize' }
    );
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      await projectsApi.createBriefSnapshot(projectId);
      await snapshotsData.refetch();
    } catch (e) {
      setErr(e?.response?.data?.message || e.message || 'Could not generate the PDF');
    } finally {
      setBusy(false);
    }
  };

  const view = async (snapshot) => {
    setViewBusyId(snapshot.id); setErr(null);
    try {
      const blob = await projectsApi.fetchBriefSnapshot(projectId, snapshot.id);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      await alert(e.message || 'Could not open the PDF', { title: 'Could not open' });
    } finally {
      setViewBusyId(null);
    }
  };

  return (
    <PortalCard title="Project Brief snapshots">
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        A dated, read-only PDF of the fields on this page — the form above
        can keep changing, each snapshot below is fixed at the moment it
        was made.
      </div>
      {snapshots.length === 0 ? <PortalEmpty message="No snapshots yet." /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
          {snapshots.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--s4)' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                {s.variation_id ? `Variation ${s.variation_number || ''}` : 'Initial brief'}
                <span style={{ color: 'var(--muted)' }}> — {new Date(s.generated_at).toLocaleString('en-AU')}{s.generated_by_name ? ` by ${s.generated_by_name}` : ''}</span>
              </span>
              <span className={`badge ${s.acknowledged_at ? 'badge-active' : 'badge-muted'}`} style={{ fontSize: 9.5, flexShrink: 0 }}>
                {s.acknowledged_at ? 'Acknowledged' : 'Not yet acknowledged'}
              </span>
              <button type="button" className="btn btn-ghost" style={{ padding: '3px 9px', fontSize: 11, flexShrink: 0 }}
                disabled={viewBusyId === s.id} onClick={() => view(s)}>
                {viewBusyId === s.id ? 'Opening…' : 'View'}
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="btn btn-primary" style={{ padding: '6px 14px', fontSize: 12.5 }}
        disabled={busy} onClick={formalize}>
        {busy ? 'Generating…' : hasIntake ? 'Re-issue Brief PDF' : 'Formalize Brief'}
      </button>
      {err && <div style={{ marginTop: 10 }}><PortalError message={err} /></div>}
    </PortalCard>
  );
}

export default function EditProjectPage() {
  const { id } = useParams();
  const router = useRouter();
  const project = usePortalData(() => projectsApi.detail(id), [id]);
  const customersData = usePortalData(() => customersApi.list());
  const proj = project.data?.data?.project;
  const customers = customersData.data?.data?.customers || [];

  useTopbarOverride({
    title: proj ? `Edit — ${proj.code}  ${proj.name}` : null,
    subtitle: proj ? 'Correct customer, brief, and land/site details' : null,
    backHref: `/projects/${id}`,
  });

  const [tab, setTab] = useState(1);
  const [form, setForm] = useState(null);
  const [customerForm, setCustomerForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [mapRefresh, setMapRefresh] = useState(0);

  // Seed the form once, from the loaded project — never overwrite a user's in-progress edits.
  // client_tier/source/dwelling_type/budget_from/budget_to/site_area/zoning_code have no
  // backing column (same as on /projects/new) — they always start blank, there is
  // nothing saved to restore them from.
  useEffect(() => {
    if (proj && !form) {
      setForm({
        name: proj.name || '',
        description: proj.description || '',
        customer_id: proj.customer_id || '',
        client_tier: 'individual',
        source: 'Referral',
        dwelling_type: 'Single storey',
        budget_from: '',
        budget_to: '',
        site_address: proj.site_address || '',
        lot_plan: proj.lot_plan || '',
        site_area: '',
        zoning_code: '',
        start_date: dateOnly(proj.start_date),
        due_date: dateOnly(proj.due_date),
        contract_value: proj.contract_value ?? '',
        contract_type: proj.contract_type || '',
      });
    }
  }, [proj, form]);

  // Customer sub-form tracks whichever customer_id is currently selected in `form`
  // (starts as the project's own linked customer; swapping the dropdown below re-seeds it).
  useEffect(() => {
    if (!form?.customer_id || !customers.length) { setCustomerForm(null); return; }
    const c = customers.find((c) => c.id === form.customer_id);
    if (c) setCustomerForm({ name: c.name || '', phone: c.phone || '', email: c.email || '' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.customer_id, customers.length]);

  if (project.loading || !form) return <div style={{ padding: 20 }}><PortalEmpty message="Loading…" /></div>;
  if (project.error) return <div style={{ padding: 20 }}><PortalError message={project.error} /></div>;
  if (!proj) return <div style={{ padding: 20 }}><PortalError message="Project not found" /></div>;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setCust = (k) => (e) => setCustomerForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null); setMsg(null);
    try {
      const body = {};
      if (form.name !== (proj.name || '')) body.name = form.name;
      if (form.description !== (proj.description || '')) body.description = form.description || null;
      if (form.customer_id !== (proj.customer_id || '')) body.customer_id = form.customer_id || null;
      if (form.site_address !== (proj.site_address || '')) body.site_address = form.site_address;
      if (form.lot_plan !== (proj.lot_plan || '')) body.lot_plan = form.lot_plan;
      if (form.start_date !== dateOnly(proj.start_date)) body.start_date = form.start_date || null;
      if (form.due_date !== dateOnly(proj.due_date)) body.due_date = form.due_date || null;
      if (String(form.contract_value) !== String(proj.contract_value ?? '')) {
        body.contract_value = form.contract_value === '' ? null : parseFloat(form.contract_value);
      }
      if (form.contract_type !== (proj.contract_type || '')) body.contract_type = form.contract_type || null;

      let custBody = {};
      const origCustomer = customers.find((c) => c.id === form.customer_id);
      if (customerForm && origCustomer) {
        if (customerForm.name !== (origCustomer.name || '')) custBody.name = customerForm.name;
        if (customerForm.phone !== (origCustomer.phone || '')) custBody.phone = customerForm.phone;
        if (customerForm.email !== (origCustomer.email || '')) custBody.email = customerForm.email;
      }

      if (Object.keys(body).length === 0 && Object.keys(custBody).length === 0) {
        setMsg('No changes.'); setBusy(false); return;
      }
      if (Object.keys(body).length) await projectsApi.patch(id, body);
      if (Object.keys(custBody).length) await customersApi.patch(form.customer_id, custBody);

      setMsg('Saved.');
      if ('site_address' in body) setMapRefresh((n) => n + 1);
      await Promise.all([project.refetch(), customersData.refetch()]);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 1180 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 20, alignItems: 'start' }}>
        <form onSubmit={save}>
          <TabPills active={tab} onSelect={setTab} />

          <div style={{ background: 'var(--s1)', border: '2px solid var(--b1)', borderRadius: 12, padding: 16 }}>
            {tab === 1 && (
              <>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Customer</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                  <Field label="Customer" full>
                    <select style={inputStyle} value={form.customer_id} onChange={set('customer_id')}>
                      <option value="">— none linked —</option>
                      {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                  {form.customer_id && customerForm && (
                    <>
                      <Field label="Full name"><input style={inputStyle} value={customerForm.name} onChange={setCust('name')} /></Field>
                      <Field label="Phone"><input style={inputStyle} value={customerForm.phone} onChange={setCust('phone')} /></Field>
                      <Field label="Email" full><input style={inputStyle} type="email" value={customerForm.email} onChange={setCust('email')} /></Field>
                    </>
                  )}
                  <Field label="Client tier" hint="Not yet saved — no client_tier column on customers today.">
                    <select style={inputStyle} value={form.client_tier} onChange={set('client_tier')}>
                      <option value="individual">Individual client</option>
                      <option value="development">Development / portfolio</option>
                    </select>
                  </Field>
                  <Field label="How did they find us?" hint="Not yet saved — no backing field today.">
                    <select style={inputStyle} value={form.source} onChange={set('source')}>
                      <option>Referral</option><option>Website enquiry</option><option>Display home</option><option>Repeat client</option>
                    </select>
                  </Field>
                </div>
              </>
            )}

            {tab === 2 && (
              <>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Project brief</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                  <Field label="Project name" full><input style={inputStyle} value={form.name} onChange={set('name')} required /></Field>
                  <Field label="Dwelling type" hint="Not yet saved — no dwelling_type column on projects today.">
                    <select style={inputStyle} value={form.dwelling_type} onChange={set('dwelling_type')}>
                      <option>Single storey</option><option>Double storey</option><option>Duplex</option><option>Multi-unit</option>
                    </select>
                  </Field>
                  <div />
                  <Field label="Indicative budget — from" hint="Not yet saved."><input style={inputStyle} placeholder="$450,000" value={form.budget_from} onChange={set('budget_from')} /></Field>
                  <Field label="Indicative budget — to" hint="Not yet saved."><input style={inputStyle} placeholder="$520,000" value={form.budget_to} onChange={set('budget_to')} /></Field>
                  <Field label="Description / requirements" full>
                    <textarea style={{ ...inputStyle, resize: 'vertical' }} rows={4} value={form.description} onChange={set('description')} />
                  </Field>
                </div>
              </>
            )}

            {tab === 3 && (
              <>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Land & site info</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                  <Field label="Site address" full><input style={inputStyle} value={form.site_address} onChange={set('site_address')} /></Field>
                  <Field label="Lot / plan"><input style={inputStyle} value={form.lot_plan} onChange={set('lot_plan')} /></Field>
                  <Field label="Site area (m²)" hint="Not yet saved."><input style={inputStyle} value={form.site_area} onChange={set('site_area')} /></Field>
                  <Field label="Zoning code" hint="Not yet saved."><input style={inputStyle} value={form.zoning_code} onChange={set('zoning_code')} /></Field>
                  <Field label="Start date"><input style={inputStyle} type="date" value={form.start_date} onChange={set('start_date')} /></Field>
                  <Field label="Due date"><input style={inputStyle} type="date" value={form.due_date} onChange={set('due_date')} /></Field>
                </div>
              </>
            )}

            {tab === 4 && (
              <>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Contract</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                  <Field label="Contract value (AUD)">
                    <input style={inputStyle} type="number" step="0.01" min="0" value={form.contract_value} onChange={set('contract_value')} />
                  </Field>
                  <Field label="Contract type">
                    <select style={inputStyle} value={form.contract_type} onChange={set('contract_type')}>
                      <option value="">—</option>
                      <option value="fixed_price">Fixed price</option>
                      <option value="cost_plus">Cost plus</option>
                    </select>
                  </Field>
                </div>
              </>
            )}

            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, paddingTop: 16, borderTop: '1px solid var(--b2)' }}>
              <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
              <button type="button" className="btn btn-ghost" onClick={() => router.push(`/projects/${id}`)}>Cancel</button>
              {msg && <span style={{ color: 'var(--green)', fontSize: 14 }}>{msg}</span>}
            </div>
            {error && <div style={{ marginTop: 10 }}><PortalError message={error} /></div>}
          </div>
        </form>

        <div style={{ position: 'sticky', top: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SiteMapPanel projectId={id} siteAddress={proj.site_address} refreshKey={mapRefresh} />
          <BriefSnapshotsCard projectId={id} />
        </div>
      </div>
    </div>
  );
}
