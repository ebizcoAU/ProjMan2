// /projects/new — "Add a Project" wizard (docs/mocked/portal/project_list.html
// Screen 2), replacing the flat inline create form on /projects. Three steps —
// Customer, Project Brief, Land & Site Info — matching the mockup's own step
// labels and field-grid layout exactly.
//
// What's real vs. captured-only, checked against the schema before wiring:
// `customers` has name/phone/email/address/notes — no `client_tier` or
// "how did they find us" column. `projects` has name/site_address/lot_plan/
// start_date — no dwelling_type, budget range, requirements, site area, or
// zoning column, and `documents.entity_type` has no `project`/`customer` value
// (xprojman-21's closed list, extended only for `task` so far). Fields with no
// backing column still render — same "capture the UI before the schema exists"
// convention already used for xprojman-29's task-detail placeholders — but are
// clearly marked "not saved yet" rather than silently dropped, and never sent
// to the API. `code` and `unit_count` are real, required-by-the-route fields
// the mockup's wizard never asks for; auto-generated here (S1.3 default:
// single dwelling, `unit_count=1`) so the user never has to think about them.
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PortalError } from '@/components/portal/PortalError';
import { customersApi, projectsApi } from '@/lib/api';

const STEPS = [
  { n: 1, label: 'Customer' },
  { n: 2, label: 'Project Brief' },
  { n: 3, label: 'Land & Site Info' },
];

function slugCode(name) {
  const initials = (name || 'P').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'P';
  return `${initials}-${Date.now().toString().slice(-6)}`;
}

function Field({ label, full, children, hint }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : undefined, marginBottom: 4 }}>
      <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const inputStyle = {
  width: '100%', background: 'var(--s3)', border: '2px solid var(--b1)', borderRadius: 8,
  padding: '9px 12px', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit',
};

export default function NewProjectPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [customer, setCustomer] = useState({ full_name: '', client_tier: 'individual', phone: '', email: '', source: 'Referral' });
  const [brief, setBrief] = useState({ project_name: '', dwelling_type: 'Single storey', budget_from: '', budget_to: '', requirements: '' });
  const [land, setLand] = useState({ site_address: '', lot_plan: '', site_area: '', zoning_code: '', estimated_start: '' });

  const setC = (k) => (e) => setCustomer((c) => ({ ...c, [k]: e.target.value }));
  const setB = (k) => (e) => setBrief((b) => ({ ...b, [k]: e.target.value }));
  const setL = (k) => (e) => setLand((l) => ({ ...l, [k]: e.target.value }));

  const next = () => setStep((s) => Math.min(3, s + 1));
  const back = () => setStep((s) => Math.max(1, s - 1));

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      let customerId;
      if (customer.full_name.trim()) {
        const { data } = await customersApi.create({
          name: customer.full_name, phone: customer.phone || undefined, email: customer.email || undefined,
        });
        customerId = data?.data?.id;
      }
      const { data } = await projectsApi.create({
        code: slugCode(brief.project_name),
        name: brief.project_name || 'Untitled project',
        site_address: land.site_address || undefined,
        lot_plan: land.lot_plan || undefined,
        start_date: land.estimated_start || undefined,
        customer_id: customerId,
        unit_count: 1,
      });
      const id = data?.data?.id;
      // /projects fetches its list client-side (usePortalData, mount-once effect) — the
      // App Router's client-side Router Cache can otherwise hand back a stale, already-
      // rendered copy of that page (missing the project just created) if the user
      // navigates back to it within the cache window. refresh() drops that cached entry
      // so the next visit does a real fetch.
      router.refresh();
      router.push(id ? `/projects/${id}` : '/projects');
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Could not create the project');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 720 }}>
      <div style={{ fontFamily: 'var(--fm)', fontSize: 12, fontWeight: 600, color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>
        New project intake
      </div>
      <h1 style={{ fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 25, color: 'var(--text)', margin: 0 }}>Add a Project</h1>
      <div style={{ fontSize: 13.5, color: 'var(--dim)', maxWidth: '62ch', marginTop: 3, marginBottom: 18 }}>
        Three short steps — customer, brief, land — before this becomes a live Stage-1 project.
      </div>

      {/* ── Step indicator ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
        {STEPS.map((s, i) => (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : undefined }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--fm)', fontSize: 12, fontWeight: 700,
                background: s.n < step ? 'var(--gdim)' : s.n === step ? 'var(--brand)' : 'var(--s3)',
                border: `1.5px solid ${s.n < step ? 'var(--green)' : s.n === step ? 'var(--brand)' : 'var(--b2)'}`,
                color: s.n < step ? 'var(--green)' : s.n === step ? '#fff' : 'var(--muted)',
              }}>
                {s.n < step ? '✓' : s.n}
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: s.n === step ? 'var(--text)' : s.n < step ? 'var(--dim)' : 'var(--muted)' }}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <div style={{ flex: 1, height: 2, margin: '0 10px', minWidth: 24, background: s.n < step ? 'var(--green)' : 'var(--b1)' }} />}
          </div>
        ))}
      </div>

      <div style={{ background: 'var(--s1)', border: '2px solid var(--b1)', borderRadius: 12, padding: 16 }}>
        {step === 1 && (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Customer info</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
              <Field label="Full name"><input style={inputStyle} placeholder="e.g. David & Louise Turner" value={customer.full_name} onChange={setC('full_name')} /></Field>
              <Field label="Client tier" hint="Not yet saved — no client_tier column on customers today.">
                <select style={inputStyle} value={customer.client_tier} onChange={setC('client_tier')}>
                  <option value="individual">Individual client</option>
                  <option value="development">Development / portfolio</option>
                </select>
              </Field>
              <Field label="Phone"><input style={inputStyle} placeholder="04xx xxx xxx" value={customer.phone} onChange={setC('phone')} /></Field>
              <Field label="Email"><input style={inputStyle} type="email" placeholder="name@email.com" value={customer.email} onChange={setC('email')} /></Field>
              <Field label="How did they find us?" full hint="Not yet saved — no backing field today.">
                <select style={inputStyle} value={customer.source} onChange={setC('source')}>
                  <option>Referral</option><option>Website enquiry</option><option>Display home</option><option>Repeat client</option>
                </select>
              </Field>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Project brief</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
              <Field label="Project name"><input style={inputStyle} placeholder="e.g. Lakeview Estate — Lot 14" value={brief.project_name} onChange={setB('project_name')} /></Field>
              <Field label="Dwelling type" hint="Not yet saved — no dwelling_type column on projects today.">
                <select style={inputStyle} value={brief.dwelling_type} onChange={setB('dwelling_type')}>
                  <option>Single storey</option><option>Double storey</option><option>Duplex</option><option>Multi-unit</option>
                </select>
              </Field>
              <Field label="Indicative budget — from" hint="Not yet saved."><input style={inputStyle} placeholder="$450,000" value={brief.budget_from} onChange={setB('budget_from')} /></Field>
              <Field label="Indicative budget — to" hint="Not yet saved."><input style={inputStyle} placeholder="$520,000" value={brief.budget_to} onChange={setB('budget_to')} /></Field>
              <Field label="Requirements / brief notes" full hint="Captured here for now, not yet saved — no home for it on the project record today.">
                <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }} placeholder="4 bed, 2 bath, north-facing living, single garage + workshop…" value={brief.requirements} onChange={setB('requirements')} />
              </Field>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Land & site info</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
              <Field label="Site address" full><input style={inputStyle} placeholder="14 Kestrel Rise, Baldivis WA 6171" value={land.site_address} onChange={setL('site_address')} /></Field>
              <Field label="Lot / Plan"><input style={inputStyle} placeholder="Lot 14 / DP411287" value={land.lot_plan} onChange={setL('lot_plan')} /></Field>
              <Field label="Site area (m²)" hint="Not yet saved."><input style={inputStyle} placeholder="612" value={land.site_area} onChange={setL('site_area')} /></Field>
              <Field label="Zoning code" hint="Not yet saved."><input style={inputStyle} placeholder="R20" value={land.zoning_code} onChange={setL('zoning_code')} /></Field>
              <Field label="Estimated start"><input style={inputStyle} type="date" value={land.estimated_start} onChange={setL('estimated_start')} /></Field>
              <Field label="Land documents" full hint="Available from the project's own page once it's created — documents need a real project to attach to.">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 6 }}>
                  {[['📄', 'Land title'], ['🗺️', 'Contour / survey'], ['📋', 'Site plan']].map(([icon, label]) => (
                    <div key={label} style={{ border: '2px dashed var(--b2)', borderRadius: 10, padding: '16px 10px', textAlign: 'center', color: 'var(--muted)', fontSize: 12.5, background: 'var(--s2)' }}>
                      <span style={{ fontSize: 22, display: 'block', marginBottom: 6 }}>{icon}</span>{label}
                    </div>
                  ))}
                </div>
              </Field>
            </div>
          </>
        )}

        {error && <div style={{ marginTop: 14 }}><PortalError message={error} /></div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--b2)' }}>
          <button className="btn btn-ghost" onClick={back} disabled={step === 1}>← Back</button>
          {step < 3 ? (
            <button className="btn btn-primary" onClick={next}>Continue →</button>
          ) : (
            <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create Project →'}</button>
          )}
        </div>
      </div>
    </div>
  );
}
