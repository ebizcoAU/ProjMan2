// A single teaser-level result row — used on the landing page's featured strip and
// the /profiles search results. Never renders anything beyond what the public
// teaser/search endpoints return (spec §5.1): name, trade, licence badge, headline.

function LicenceBadge({ licence }) {
  if (!licence) return null;
  if (licence.status === 'verified') {
    return <span className="badge badge-verified">Licence verified{licence.state ? ` · ${licence.state}` : ''}</span>;
  }
  if (licence.status === 'not_available') {
    return <span className="badge badge-pending">Licence check not yet available{licence.state ? ` in ${licence.state}` : ''}</span>;
  }
  return <span className="badge badge-unverified">Licence unverified</span>;
}

export default function VtProfileCard({ profile }) {
  const headline = profile.headline || {};
  return (
    <a href={`/profiles/${profile.user_id}`} className="card" style={{
      display: 'flex', flexDirection: 'column', gap: 10, transition: 'border-color .15s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ fontFamily: 'var(--fh)', fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>
            {profile.full_name}
          </div>
          {profile.trade_classification && (
            <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 2 }}>{profile.trade_classification}</div>
          )}
        </div>
        <LicenceBadge licence={profile.licence} />
      </div>
      <div style={{ fontSize: 14, color: 'var(--dim)' }}>
        {headline.verified_projects ?? 0} verified project{headline.verified_projects === 1 ? '' : 's'}
        {typeof headline.unresolved_disputes === 'number' ? ` · ${headline.unresolved_disputes} unresolved disputes` : ''}
      </div>
    </a>
  );
}
