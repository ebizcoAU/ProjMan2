// /profiles/:id/full — gated full profile (spec §5.2). Login required. Project-by-
// project evidence, licence detail, Engage. Financial detail on any given project
// entry only appears when the SUBJECT (not the viewer) has separately opted into
// disclosure — the backend already strips `amount` otherwise, so this page just
// renders whatever `detail` comes back, no client-side redaction logic needed.
'use client';

import { useEffect, useState } from 'react';
import VtHeader from '@/components/VtHeader';
import api, { isLoggedIn } from '@/lib/api';
import { isShortlisted, toggleShortlist } from '@/lib/shortlist';

const SOURCE_LABEL = {
  task_complete: 'Task completed & verified',
  inspection: 'Inspection',
  diary_entry: 'Site diary sign-off',
  stage_complete: 'Stage completed',
  invoice_matched: 'Invoice matched to job',
};

export default function FullProfilePage({ params }) {
  const { id } = params;
  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ok | unauth | notfound
  const [engageState, setEngageState] = useState('idle'); // idle | busy | done | error
  const [engageMessage, setEngageMessage] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) { setStatus('unauth'); return; }
    setSaved(isShortlisted(id));
    api.profiles.full(id)
      .then(({ data }) => { setProfile(data.data); setStatus('ok'); })
      .catch((err) => setStatus(err.response?.status === 404 ? 'notfound' : 'unauth'))
      ;
  }, [id]);

  const engage = async () => {
    setEngageState('busy');
    try {
      const { data } = await api.profiles.engage(id);
      setEngageState('done');
      setEngageMessage(data.data?.alreadyIntroduced
        ? "You're already introduced to this contact — find them in your ProjMan App contact book."
        : 'Introduction sent — this contact now appears in your ProjMan App contact book. A Job Award can be issued from Portal once you have a project for them.');
    } catch (err) {
      setEngageState('error');
      setEngageMessage(err.response?.data?.message || 'Could not send an Engage request.');
    }
  };

  if (status === 'loading') {
    return <div><VtHeader /><div style={{ padding: 40, color: 'var(--muted)' }}>Loading…</div></div>;
  }
  if (status === 'unauth') {
    return (
      <div>
        <VtHeader />
        <div style={{ maxWidth: 520, margin: '60px auto', textAlign: 'center' }}>
          <div className="card">
            <p style={{ marginBottom: 16, color: 'var(--dim)' }}>Full profiles are visible to logged-in B2B users.</p>
            <a href={`/login?next=${encodeURIComponent(`/profiles/${id}/full`)}`} className="btn btn-primary">Log in with ProjMan</a>
          </div>
        </div>
      </div>
    );
  }
  if (status === 'notfound') {
    return <div><VtHeader /><div style={{ padding: 40, color: 'var(--muted)' }}>No published VeriTrade profile for this identity.</div></div>;
  }

  return (
    <div>
      <VtHeader />
      <div style={{ maxWidth: 780, margin: '0 auto', padding: '40px 20px' }}>
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 28 }}>{profile.full_name}</h1>
              {profile.trade_classification && <div style={{ color: 'var(--dim)', fontSize: 16, marginTop: 4 }}>{profile.trade_classification}</div>}
              {profile.service_region && <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 2 }}>{profile.service_region}</div>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setSaved(toggleShortlist(id).includes(id))}>
                {saved ? '★ Saved' : '☆ Save'}
              </button>
              <button className="btn btn-primary" onClick={engage} disabled={engageState === 'busy' || engageState === 'done'}>
                {engageState === 'done' ? 'Engaged' : engageState === 'busy' ? 'Sending…' : 'Engage'}
              </button>
            </div>
          </div>
          {engageMessage && (
            <div style={{
              marginTop: 14, padding: '10px 12px', borderRadius: 8, fontSize: 14,
              background: engageState === 'error' ? 'var(--rdim)' : 'var(--gdim)',
              color: engageState === 'error' ? 'var(--red)' : 'var(--green)',
            }}>{engageMessage}</div>
          )}

          <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--b1)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Licence</div>
            <div style={{ fontSize: 14, color: 'var(--dim)' }}>
              {profile.licence?.number ? `${profile.licence.number} · ` : ''}
              {profile.licence?.state || '—'} · status: {profile.licence?.status || 'unverified'}
            </div>
          </div>
        </div>

        <h2 style={{ fontFamily: 'var(--fh)', fontWeight: 700, fontSize: 20, marginBottom: 12 }}>Project evidence</h2>
        {(profile.projects || []).length === 0 ? (
          <div className="card" style={{ color: 'var(--muted)' }}>No evidence recorded yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {profile.projects.map((p, i) => (
              <div key={i} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{SOURCE_LABEL[p.type] || p.type}</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                    {new Date(p.date).toLocaleDateString('en-AU')}
                    {p.detail?.amount != null ? ` · $${Number(p.detail.amount).toLocaleString('en-AU')}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
