// /settings — profile owner's opt-in controls (spec §8): publish on/off, financial
// disclosure on/off, self-declared trade/region/licence fields. Publish is refused
// server-side with NO_EVIDENCE (422) when the caller has zero verified projects —
// surfaced here as a disabled toggle with an explanation, not a generic error.
'use client';

import { useEffect, useState } from 'react';
import VtHeader from '@/components/VtHeader';
import api, { isLoggedIn } from '@/lib/api';

export default function SettingsPage() {
  const [authed, setAuthed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    published: false, trade_classification: '', service_region: '',
    licence_number: '', licence_state: '', disclose_financials: false, verified_projects: 0,
  });

  useEffect(() => {
    const ok = isLoggedIn();
    setAuthed(ok);
    if (!ok) { setLoading(false); return; }
    api.profiles.mySettings()
      .then(({ data }) => {
        const s = data.data;
        setForm({
          published: !!s.veritrade_published,
          trade_classification: s.trade_classification || '',
          service_region: s.service_region || '',
          licence_number: s.licence_number || '',
          licence_state: s.licence_state || '',
          disclose_financials: !!s.veritrade_disclose_financials,
          verified_projects: s.verified_projects || 0,
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError(null); setSaved(false);
    try {
      await api.profiles.settings({
        published: form.published,
        trade_classification: form.trade_classification,
        service_region: form.service_region,
        licence_number: form.licence_number,
        licence_state: form.licence_state,
        disclose_financials: form.disclose_financials,
      });
      setSaved(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save — please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (authed === false) {
    return (
      <div>
        <VtHeader />
        <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center' }}>
          <div className="card">
            <a href="/login?next=/settings" className="btn btn-primary">Log in with ProjMan</a>
          </div>
        </div>
      </div>
    );
  }
  if (loading) {
    return <div><VtHeader /><div style={{ padding: 40, color: 'var(--muted)' }}>Loading…</div></div>;
  }

  const canPublish = form.verified_projects > 0;

  return (
    <div>
      <VtHeader />
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '32px 20px' }}>
        <h1 style={{ fontFamily: 'var(--fh)', fontWeight: 700, fontSize: 26, marginBottom: 20 }}>VeriTrade settings</h1>

        <form onSubmit={save} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600 }}>
              <input type="checkbox" checked={form.published} onChange={set('published')} disabled={!canPublish && !form.published} />
              Publish my profile to VeriTrade
            </label>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4, marginLeft: 26 }}>
              {canPublish
                ? 'Opt-in, revocable, immediate — turning this off removes your profile from VeriTrade right away.'
                : `Requires at least one verified project (you currently have ${form.verified_projects}).`}
            </div>
          </div>

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600 }}>
              <input type="checkbox" checked={form.disclose_financials} onChange={set('disclose_financials')} />
              Show invoice/PO amounts on my project evidence
            </label>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4, marginLeft: 26 }}>
              Off by default — narrower than the general publish toggle above.
            </div>
          </div>

          <div>
            <label style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Trade / classification</label>
            <input className="input" value={form.trade_classification} onChange={set('trade_classification')} placeholder="e.g. Electrician" />
          </div>

          <div>
            <label style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Service region</label>
            <input className="input" value={form.service_region} onChange={set('service_region')} placeholder="e.g. Perth Metro" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Licence number</label>
              <input className="input" value={form.licence_number} onChange={set('licence_number')} />
            </div>
            <div>
              <label style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>State</label>
              <input className="input" value={form.licence_state} onChange={set('licence_state')} placeholder="WA" />
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -10 }}>
            State-by-state licence verification isn&rsquo;t live yet — your badge will show as
            &ldquo;not yet available&rdquo; rather than a false verification.
          </div>

          {error && <div style={{ color: 'var(--red)', fontSize: 14 }}>{error}</div>}
          {saved && <div style={{ color: 'var(--green)', fontSize: 14 }}>Saved.</div>}

          <button className="btn btn-primary" type="submit" disabled={saving} style={{ justifyContent: 'center' }}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </form>
      </div>
    </div>
  );
}
