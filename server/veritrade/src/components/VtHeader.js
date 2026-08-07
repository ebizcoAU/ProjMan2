'use client';

import { useEffect, useState } from 'react';
import { isLoggedIn, clearSession, getSavedUser } from '@/lib/api';

export default function VtHeader() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    setLoggedIn(isLoggedIn());
    setUser(getSavedUser());
  }, []);

  return (
    <header style={{
      borderBottom: '1px solid var(--b1)', background: 'var(--s1)',
      position: 'sticky', top: 0, zIndex: 10,
    }}>
      <div style={{
        maxWidth: 1080, margin: '0 auto', padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8, background: 'var(--brand)',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 15,
          }}>VT</div>
          <span style={{ fontFamily: 'var(--fh)', fontWeight: 800, fontSize: 19, color: 'var(--text)' }}>
            VeriTrade
          </span>
        </a>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 15, fontWeight: 600 }}>
          <a href="/profiles" style={{ color: 'var(--dim)' }}>Search</a>
          {loggedIn ? (
            <>
              <a href="/shortlist" style={{ color: 'var(--dim)' }}>Shortlist</a>
              <a href="/settings" style={{ color: 'var(--dim)' }}>Settings</a>
              <span style={{ color: 'var(--muted)', fontSize: 14 }}>{user?.full_name || 'Signed in'}</span>
              <button
                className="btn btn-ghost"
                onClick={() => { clearSession(); window.location.href = '/'; }}
              >Log out</button>
            </>
          ) : (
            <a href="/login" className="btn btn-primary">Log in with ProjMan</a>
          )}
        </nav>
      </div>
    </header>
  );
}
