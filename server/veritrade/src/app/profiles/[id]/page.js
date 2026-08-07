// /profiles/:id — public teaser profile (spec §5.1). Public, indexable. Deliberately
// thin: name, trade, years active, licence badge, headline metric, and a single CTA
// into the gated full profile. No project-by-project detail here by construction —
// the teaser endpoint itself never returns it.
'use client';

import { useEffect, useState } from 'react';
import { isLoggedIn } from '@/lib/api';
import VtHeader from '@/components/VtHeader';
import api from '@/lib/api';

export default function TeaserProfilePage({ params }) {
  const { id } = params;
  const [profile, setProfile] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.profiles.teaser(id)
      .then(({ data }) => setProfile(data.data))
      .catch((err) => { if (err.response?.status === 404) setNotFound(true); })
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div>
      <VtHeader />
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>
        {loading ? (
          <div style={{ color: 'var(--muted)' }}>Loading…</div>
        ) : notFound ? (
          <div className="card" style={{ color: 'var(--muted)' }}>
            No published VeriTrade profile for this identity.
          </div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h1 style={{ fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 28 }}>{profile.full_name}</h1>
                  {profile.trade_classification && (
                    <div style={{ color: 'var(--dim)', fontSize: 16, marginTop: 4 }}>{profile.trade_classification}</div>
                  )}
                  {profile.years_active != null && (
                    <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>{profile.years_active} years active on ProjMan</div>
                  )}
                </div>
                {profile.licence?.status === 'verified' ? (
                  <span className="badge badge-verified">Licence verified{profile.licence.state ? ` · ${profile.licence.state}` : ''}</span>
                ) : profile.licence?.status === 'not_available' ? (
                  <span className="badge badge-pending">Licence check not yet available{profile.licence.state ? ` in ${profile.licence.state}` : ''}</span>
                ) : (
                  <span className="badge badge-unverified">Licence unverified</span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 24, marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--b1)' }}>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--fh)', color: 'var(--brand)' }}>
                    {profile.headline?.verified_projects ?? 0}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>Verified projects</div>
                </div>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--fh)', color: 'var(--text)' }}>
                    {profile.headline?.unresolved_disputes ?? 0}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>Unresolved disputes</div>
                </div>
              </div>
            </div>

            <a
              href={isLoggedIn() ? `/profiles/${id}/full` : `/login?next=${encodeURIComponent(`/profiles/${id}/full`)}`}
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '13px 16px', fontSize: 16 }}
            >
              View full profile
            </a>
            <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', marginTop: 10 }}>
              Project-by-project evidence, licence detail and Engage are available to logged-in B2B users.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
