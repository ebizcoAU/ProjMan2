// /profiles — search results. Public, indexable (spec §5.1). Filters: trade,
// region, licence status, verified project count (spec §10). "years active" is not
// a search filter server-side (VeriTradeService.search doesn't expose it) — the
// years-active figure only exists on the individual profile read, not in the
// search projection, so it's left off the filter row rather than faked client-side.
'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import VtHeader from '@/components/VtHeader';
import VtProfileCard from '@/components/VtProfileCard';
import api from '@/lib/api';

function SearchResults() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [trade, setTrade] = useState(searchParams.get('trade') || '');
  const [region, setRegion] = useState(searchParams.get('region') || '');
  const [licenceState, setLicenceState] = useState(searchParams.get('licence_state') || '');
  const [minProjects, setMinProjects] = useState(searchParams.get('min_verified_projects') || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.profiles.search({
      trade: searchParams.get('trade'), region: searchParams.get('region'),
      licence_state: searchParams.get('licence_state'), min_verified_projects: searchParams.get('min_verified_projects'),
    }).then(({ data }) => setResults(data.data?.results || []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [searchParams]);

  const applyFilters = (e) => {
    e.preventDefault();
    const qs = new URLSearchParams();
    if (trade) qs.set('trade', trade);
    if (region) qs.set('region', region);
    if (licenceState) qs.set('licence_state', licenceState);
    if (minProjects) qs.set('min_verified_projects', minProjects);
    router.push(`/profiles?${qs.toString()}`);
  };

  return (
    <div>
      <VtHeader />
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 20px' }}>
        <h1 style={{ fontFamily: 'var(--fh)', fontWeight: 700, fontSize: 26, marginBottom: 20 }}>
          Search verified professionals
        </h1>
        <form onSubmit={applyFilters} className="card" style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) auto', gap: 10, marginBottom: 24, alignItems: 'end',
        }}>
          <div>
            <label style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>Trade</label>
            <input className="input" value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="e.g. Electrician" />
          </div>
          <div>
            <label style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>Region</label>
            <input className="input" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. Perth Metro" />
          </div>
          <div>
            <label style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>Licence state</label>
            <input className="input" value={licenceState} onChange={(e) => setLicenceState(e.target.value)} placeholder="e.g. WA" />
          </div>
          <div>
            <label style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>Min. verified projects</label>
            <input className="input" type="number" min="0" value={minProjects} onChange={(e) => setMinProjects(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit">Filter</button>
        </form>

        {loading ? (
          <div style={{ color: 'var(--muted)' }}>Searching…</div>
        ) : results.length === 0 ? (
          <div className="card" style={{ color: 'var(--muted)' }}>No published profiles match these filters.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {results.map((p) => <VtProfileCard key={p.user_id} profile={p} />)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProfilesPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: 'var(--muted)' }}>Loading…</div>}>
      <SearchResults />
    </Suspense>
  );
}
