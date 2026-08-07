// / — landing page. Public, indexable (spec §5.1/§11). Search bar + a "featured"
// strip. There is no dedicated "featured" endpoint — the search endpoint already
// orders by verified_projects DESC with no filters, so an unfiltered call doubles
// as a reasonable "most-verified professionals first" featured list without new
// backend surface.
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import VtHeader from '@/components/VtHeader';
import VtProfileCard from '@/components/VtProfileCard';
import api from '@/lib/api';

export default function LandingPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [featured, setFeatured] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.profiles.search({}).then(({ data }) => setFeatured((data.data?.results || []).slice(0, 6)))
      .catch(() => setFeatured([]))
      .finally(() => setLoading(false));
  }, []);

  const submit = (e) => {
    e.preventDefault();
    router.push(`/profiles${q ? `?trade=${encodeURIComponent(q)}` : ''}`);
  };

  return (
    <div>
      <VtHeader />
      <div style={{
        background: 'linear-gradient(180deg, var(--brand) 0%, #1e3a8a 100%)',
        color: '#fff', padding: '64px 20px 56px',
      }}>
        <div style={{ maxWidth: 780, margin: '0 auto', textAlign: 'center' }}>
          <h1 style={{ fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 40, lineHeight: 1.15, marginBottom: 14 }}>
            Australia&rsquo;s B2B network for the trade industry
          </h1>
          <p style={{ fontSize: 18, opacity: .92, marginBottom: 30, lineHeight: 1.5 }}>
            Every project on a VeriTrade profile is anchored to a licence, backed by geotagged
            site evidence, and signed off by the people who supervised the work — proof, not reviews.
          </p>
          <form onSubmit={submit} style={{ display: 'flex', gap: 8, maxWidth: 520, margin: '0 auto' }}>
            <input
              className="input" placeholder="Search by trade — e.g. Electrician, Carpenter"
              value={q} onChange={(e) => setQ(e.target.value)}
              style={{ background: '#fff', color: 'var(--text)', border: 'none' }}
            />
            <button className="btn" type="submit" style={{ background: '#fff', color: 'var(--brand)', fontWeight: 700 }}>
              Search
            </button>
          </form>
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 48 }}>
          {[
            ['Financial/contractual', "POs and invoices matched to a specific job — can't be invented in five minutes"],
            ['Statutory/inspection', 'Certificates and sign-offs from licensed third parties, not the platform'],
            ['Supervisory sign-off', 'Geofenced, timestamped sign-off from the Site Supervisor or Foreperson on site'],
            ['Licence/credential', "Live cross-check against state licensing databases — can't be faked"],
          ].map(([title, body]) => (
            <div key={title} className="card">
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: 'var(--brand)' }}>{title}</div>
              <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>{body}</div>
            </div>
          ))}
        </div>

        <h2 style={{ fontFamily: 'var(--fh)', fontWeight: 700, fontSize: 22, marginBottom: 16 }}>
          Featured verified professionals
        </h2>
        {loading ? (
          <div style={{ color: 'var(--muted)' }}>Loading…</div>
        ) : featured.length === 0 ? (
          <div className="card" style={{ color: 'var(--muted)' }}>
            No published profiles yet — be the first to publish your Verified Work History.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {featured.map((p) => <VtProfileCard key={p.user_id} profile={p} />)}
          </div>
        )}
      </div>
    </div>
  );
}
