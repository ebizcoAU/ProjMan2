// /shortlist — saved candidates, login required (spec §10). Backed by a per-browser
// localStorage list (lib/shortlist.js — no server table for this in v1); each saved
// id is resolved against the PUBLIC teaser endpoint for display, same data a search
// result row would show.
'use client';

import { useEffect, useState } from 'react';
import VtHeader from '@/components/VtHeader';
import VtProfileCard from '@/components/VtProfileCard';
import api, { isLoggedIn } from '@/lib/api';
import { getShortlist, toggleShortlist } from '@/lib/shortlist';

export default function ShortlistPage() {
  const [authed, setAuthed] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ok = isLoggedIn();
    setAuthed(ok);
    if (!ok) { setLoading(false); return; }
    const ids = getShortlist();
    Promise.all(ids.map((id) => api.profiles.teaser(id).then(({ data }) => data.data).catch(() => null)))
      .then((rows) => setProfiles(rows.filter(Boolean)))
      .finally(() => setLoading(false));
  }, []);

  const remove = (id) => {
    toggleShortlist(id);
    setProfiles((prev) => prev.filter((p) => p.user_id !== id));
  };

  return (
    <div>
      <VtHeader />
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 20px' }}>
        <h1 style={{ fontFamily: 'var(--fh)', fontWeight: 700, fontSize: 26, marginBottom: 20 }}>Your shortlist</h1>
        {authed === false ? (
          <div className="card" style={{ color: 'var(--muted)' }}>
            <a href="/login?next=/shortlist" className="btn btn-primary">Log in with ProjMan</a>
          </div>
        ) : loading ? (
          <div style={{ color: 'var(--muted)' }}>Loading…</div>
        ) : profiles.length === 0 ? (
          <div className="card" style={{ color: 'var(--muted)' }}>
            Nothing saved yet — use ☆ Save on a full profile to add candidates here.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {profiles.map((p) => (
              <div key={p.user_id} style={{ position: 'relative' }}>
                <VtProfileCard profile={p} />
                <button
                  className="btn btn-ghost"
                  onClick={(e) => { e.preventDefault(); remove(p.user_id); }}
                  style={{ position: 'absolute', top: 12, right: 12, padding: '4px 10px', fontSize: 12, background: 'var(--s1)' }}
                >Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
